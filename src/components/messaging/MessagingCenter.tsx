import React, { useCallback, useEffect, useState, useRef } from 'react';
import { validateUploadedFile, verifyFileSignature } from '../../core/security/fileValidator';
import {
  MessageSquare,
  Send,
  Paperclip,
  ShieldAlert,
  Ban,
  CheckCheck,
  Search,
  Filter,
  X,
  FileText,
  Loader2,
  UserCheck,
  AlertCircle,
  Building,
  Briefcase,
  Store,
  Plus
} from 'lucide-react';
import { Conversation, DirectMessage, MessageAttachment, ConversationCategory, MessageReport, UserRole } from '../../types';
import { messagingService } from '../../services/messagingService';
import { authService } from '../../services/authService';
import { AttachmentLightbox, AttachmentTile, formatFileSize, isImageAttachment } from './AttachmentViews';

interface PendingFile {
  id: string;
  file: File;
  cleanName: string;
  previewUrl?: string;
}

const MAX_FILES_PER_MESSAGE = 5;
const MAX_MESSAGE_LENGTH = 5000;

interface MessagingCenterProps {
  initialConversationId?: string;
}

export const MessagingCenter: React.FC<MessagingCenterProps> = ({ initialConversationId }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState('');
  const [previewAtt, setPreviewAtt] = useState<MessageAttachment | null>(null);
  const sendingRef = useRef(false);
  const pendingFilesRef = useRef<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // New Message Modal
  const [showNewMsgModal, setShowNewMsgModal] = useState(false);
  const [newMsgRecipientEmail, setNewMsgRecipientEmail] = useState('');
  const [newMsgCategory, setNewMsgCategory] = useState<ConversationCategory>('general');
  const [newMsgTitle, setNewMsgTitle] = useState('');
  const [newMsgBody, setNewMsgBody] = useState('');
  const [newMsgError, setNewMsgError] = useState('');
  const [startingConversation, setStartingConversation] = useState(false);

  // Report Modal
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<MessageReport['reason']>('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const session = authService.getSession();
  const currentUser = session.user;

  useEffect(() => {
    if (currentUser) {
      loadConversations();
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (activeConvId && currentUser) {
      loadMessages(activeConvId);
    }
  }, [activeConvId, currentUser?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Keep the open thread fresh (new replies, refreshed signed attachment URLs) without a full reload.
  useEffect(() => {
    if (!activeConvId || !currentUser) return;
    const convId = activeConvId;
    const userId = currentUser.id;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || sendingRef.current) return;
      const res = await messagingService.getMessages(convId, userId);
      if (!res.data) return;
      const fresh = res.data;
      setMessages((prev) => (prev.length === fresh.length && prev[prev.length - 1]?.id === fresh[fresh.length - 1]?.id && prev.every((m, i) => m.isRead === fresh[i].isRead) ? prev : fresh));
    }, 15000);
    return () => window.clearInterval(timer);
  }, [activeConvId, currentUser?.id]);

  // Release image preview object URLs when the component goes away.
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);
  useEffect(() => {
    return () => pendingFilesRef.current.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
  }, []);

  const loadConversations = async () => {
    if (!currentUser) return;
    setLoading(true);
    const res = await messagingService.getUserConversations(currentUser.id);
    if (res.data) {
      setConversations(res.data);
      if (!activeConvId && res.data.length > 0) {
        setActiveConvId(res.data[0].id);
      }
    }
    setLoading(false);
  };

  const loadMessages = async (convId: string) => {
    if (!currentUser) return;
    const res = await messagingService.getMessages(convId, currentUser.id);
    if (res.data) {
      setMessages(res.data);
      // Refresh conversation list to update unread status
      const updatedConvs = await messagingService.getUserConversations(currentUser.id);
      if (updatedConvs.data) setConversations(updatedConvs.data);
    }
  };

  const clearPendingFiles = useCallback(() => {
    setPendingFiles((prev) => {
      prev.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
      return [];
    });
  }, []);

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => {
      prev.filter((f) => f.id === id).forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    // Hard guard against double-submits (double click, Enter + click, slow network).
    if (sendingRef.current) return;
    const text = messageInput.trim();
    if (!text && pendingFiles.length === 0) return;
    if (!activeConvId || !currentUser) return;

    const conv = conversations.find((c) => c.id === activeConvId);
    const recipient = conv?.participants.find((p) => p.userId !== currentUser.id);
    if (!conv || !recipient) {
      setComposerError('This conversation is no longer available. Please reopen it from the list.');
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setComposerError('');
    try {
      const res = await messagingService.sendMessage({
        conversationId: activeConvId,
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        senderRole: currentUser.primaryRole as UserRole,
        recipientId: recipient.userId,
        body: text,
        files: pendingFiles.map((f) => f.file)
      });

      if (res.error || !res.data) {
        // Keep the draft and files so nothing is lost; tell the user exactly what happened.
        setComposerError(res.error?.message || 'Message could not be sent. Please try again.');
        return;
      }

      const sent = res.data;
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setMessageInput('');
      clearPendingFiles();
      const updated = await messagingService.getUserConversations(currentUser.id);
      if (updated.data) setConversations(updated.data);
    } catch (error: unknown) {
      setComposerError(error instanceof Error ? error.message : 'Failed to send message.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = input.files ? Array.from(input.files) : [];
    // Reset so picking the same file again still fires onChange.
    input.value = '';
    if (files.length === 0) return;

    setComposerError('');
    const accepted: PendingFile[] = [];
    const problems: string[] = [];

    for (const file of files) {
      if (pendingFiles.length + accepted.length >= MAX_FILES_PER_MESSAGE) {
        problems.push(`You can attach up to ${MAX_FILES_PER_MESSAGE} files per message.`);
        break;
      }
      const category = file.type.startsWith('image/') ? 'image' : 'document';
      const validation = validateUploadedFile(file, category);
      if (!validation.valid) {
        problems.push(`${file.name}: ${validation.error || 'Attachment validation failed.'}`);
        continue;
      }
      const ext = validation.cleanFileName.split('.').pop() || '';
      const signatureError = await verifyFileSignature(file, ext);
      if (signatureError) {
        problems.push(`${file.name}: ${signatureError}`);
        continue;
      }
      accepted.push({
        id: `pf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        file,
        cleanName: validation.cleanFileName,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      });
    }

    if (accepted.length > 0) setPendingFiles((prev) => [...prev, ...accepted]);
    if (problems.length > 0) setComposerError(problems.join(' '));
  };

  const handleBlockUser = async () => {
    if (!activeConv || !currentUser) return;
    const partner = activeConv.participants.find((p) => p.userId !== currentUser.id);
    if (!partner) return;

    if (confirm(`Are you sure you want to block ${partner.name}? You will no longer receive messages from this user.`)) {
      await messagingService.blockUser(currentUser.id, partner.userId, 'User block from messaging center');
      await loadConversations();
      if (activeConvId) await loadMessages(activeConvId);
    }
  };

  const handleUnblockUser = async () => {
    if (!activeConv || !currentUser) return;
    const partner = activeConv.participants.find((p) => p.userId !== currentUser.id);
    if (!partner) return;

    await messagingService.unblockUser(currentUser.id, partner.userId);
    await loadConversations();
    if (activeConvId) await loadMessages(activeConvId);
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !currentUser) return;
    const partner = activeConv.participants.find((p) => p.userId !== currentUser.id);
    if (!partner) return;

    await messagingService.reportConversation({
      conversationId: activeConv.id,
      reporterUserId: currentUser.id,
      reportedUserId: partner.userId,
      reason: reportReason,
      details: reportDetails
    });

    setReportSubmitted(true);
    setTimeout(() => {
      setShowReportModal(false);
      setReportSubmitted(false);
      setReportDetails('');
    }, 1500);
  };

  const handleStartNewConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (startingConversation) return;
    setNewMsgError('');
    if (!currentUser) return;
    setStartingConversation(true);
    try {

    const targetUserRes = await messagingService.findUserByEmail(newMsgRecipientEmail.trim());
    const targetUser = targetUserRes.data;
    if (targetUserRes.error) {
      setNewMsgError(targetUserRes.error.message);
      return;
    }
    if (!targetUser) {
      setNewMsgError('User not found. Please check the email address.');
      return;
    }

    if (targetUser.id === currentUser.id) {
      setNewMsgError('You cannot start a message thread with yourself.');
      return;
    }

    try {
      const res = await messagingService.startConversation({
        category: newMsgCategory,
        title: newMsgTitle || `Direct Message with ${targetUser.fullName}`,
        participants: [
          {
            userId: currentUser.id,
            name: currentUser.fullName,
            email: currentUser.email,
            role: currentUser.primaryRole as UserRole
          },
          {
            userId: targetUser.id,
            name: targetUser.fullName,
            email: newMsgRecipientEmail.trim(),
            role: targetUser.primaryRole as UserRole
          }
        ],
        contextType: 'general',
        initialMessage: newMsgBody,
        senderUserId: currentUser.id
      });

      if (res.error || !res.data) {
        setNewMsgError(res.error?.message || 'Failed to start conversation.');
      } else {
        setShowNewMsgModal(false);
        setNewMsgRecipientEmail('');
        setNewMsgTitle('');
        setNewMsgBody('');
        await loadConversations();
        setActiveConvId(res.data.id);
      }
    } catch (err: any) {
      setNewMsgError(err.message || 'Failed to start conversation.');
    }
    } finally {
      setStartingConversation(false);
    }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const activePartner = activeConv?.participants.find((p) => p.userId !== currentUser?.id);

  const filteredConversations = conversations.filter((c) => {
    const matchesCat = filterCategory === 'all' || c.category === filterCategory;
    const matchesSearch =
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.participants.some((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  if (!currentUser) {
    return (
      <div className="bg-white p-12 rounded-[32px] border border-[#E8E4D9] text-center space-y-4">
        <MessageSquare className="w-12 h-12 text-[#606C38] mx-auto" />
        <h3 className="text-xl font-bold text-[#283618]">Platform Messaging Access</h3>
        <p className="text-stone-500 max-w-md mx-auto text-sm">
          Please sign in to access candidate-recruiter messaging, buyer-seller inquiries, and organization communications.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-6 rounded-[32px] border border-[#E8E4D9] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-2 bg-[#ECF3E9] text-[#283618] rounded-xl">
              <MessageSquare className="w-5 h-5 text-[#4F772D]" />
            </span>
            <h1 className="text-2xl font-bold font-display text-[#283618]">Secure Platform Messaging</h1>
          </div>
          <p className="text-stone-500 text-sm">
            Encrypted candidate communications, recruiter notes, and M&A buyer-seller data room inquiries.
          </p>
        </div>

        <button
          onClick={() => setShowNewMsgModal(true)}
          className="px-4 py-2.5 bg-[#283618] hover:bg-[#132A13] text-white rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-xs shrink-0"
        >
          <Plus className="w-4 h-4 text-[#A3B18A]" />
          <span>New Message Inquiry</span>
        </button>
      </div>

      {/* Main Messaging Layout */}
      <div className="bg-white rounded-[32px] border border-[#E8E4D9] overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[600px]">
        {/* Left Sidebar: Conversation List */}
        <div className="md:col-span-4 min-w-0 border-r border-[#E8E4D9] flex flex-col bg-[#F9F8F6]">
          {/* Search & Category Filter */}
          <div className="p-4 border-b border-[#E8E4D9] space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations or contacts..."
                className="w-full text-xs pl-9 pr-3 py-2 bg-white rounded-xl border border-[#E8E4D9] outline-none"
              />
            </div>

            <div className="flex gap-1 overflow-x-auto pb-1 text-[11px] font-semibold">
              {[
                { id: 'all', label: 'All' },
                { id: 'candidate_recruiter', label: 'Jobs & Recruiting' },
                { id: 'buyer_seller', label: 'M&A Deals' },
                { id: 'organization', label: 'Organizations' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterCategory(tab.id)}
                  className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
                    filterCategory === tab.id
                      ? 'bg-[#283618] text-white font-bold'
                      : 'bg-white text-stone-600 hover:bg-stone-100 border border-[#E8E4D9]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversations Scroll View */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#E8E4D9]">
            {filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-stone-400 text-xs">
                No active conversations found.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const partner = conv.participants.find((p) => p.userId !== currentUser.id);
                const unread = conv.unreadCountByUserId?.[currentUser.id] || 0;
                const isSelected = conv.id === activeConvId;

                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      if (conv.id !== activeConvId) {
                        setMessages([]);
                        setComposerError('');
                        clearPendingFiles();
                      }
                      setActiveConvId(conv.id);
                    }}
                    className={`w-full p-4 text-left transition-colors flex items-start gap-3 cursor-pointer ${
                      isSelected ? 'bg-white font-medium border-l-4 border-l-[#4F772D]' : 'hover:bg-white/60'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-[#ECF3E9] text-[#283618] font-bold flex items-center justify-center shrink-0 border border-[#A3B18A]/30">
                      {partner?.name?.charAt(0) || 'U'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <span className="text-xs font-bold text-[#283618] truncate">
                          {partner?.name || 'User'}
                        </span>
                        <span className="text-[10px] text-stone-400 shrink-0">
                          {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                        </span>
                      </div>

                      <p className="text-[11px] font-semibold text-[#606C38] truncate mb-1">
                        {conv.title}
                      </p>

                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-stone-500 truncate max-w-[180px]">
                          {conv.lastMessage}
                        </p>
                        {unread > 0 && (
                          <span className="px-1.5 py-0.5 bg-[#BC6C25] text-white rounded-full text-[9px] font-bold">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Active Thread */}
        <div className="md:col-span-8 min-w-0 flex flex-col h-full bg-white">
          {activeConv ? (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-[#E8E4D9] flex items-center justify-between bg-[#F9F8F6]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#283618] text-white font-bold flex items-center justify-center text-sm shadow-xs">
                    {activePartner?.name?.charAt(0) || 'U'}
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[#283618] flex items-center gap-2">
                      <span>{activePartner?.name}</span>
                      {activePartner?.role && (
                        <span className="px-2 py-0.5 bg-[#FEFAE0] text-[#BC6C25] rounded-full text-[10px] font-bold uppercase tracking-wider border border-[#E8E4D9]">
                          {activePartner.role.replace('_', ' ')}
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-[#606C38] font-medium">{activeConv.title}</p>
                  </div>
                </div>

                {/* Header Controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowReportModal(true)}
                    className="p-2 text-stone-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    title="Report Message or Conduct"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    <span className="hidden sm:inline">Report</span>
                  </button>

                  {activeConv.isBlocked ? (
                    <button
                      onClick={handleUnblockUser}
                      className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-green-600" />
                      <span>Unblock</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleBlockUser}
                      className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      title="Block User"
                    >
                      <Ban className="w-4 h-4" />
                      <span className="hidden sm:inline">Block</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Blocked Warning Banner */}
              {activeConv.isBlocked && (
                <div className="bg-red-50 p-3 text-red-800 text-xs font-medium flex items-center gap-2 border-b border-red-200">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>
                    Messaging has been blocked with this contact. You can unblock to resume conversation.
                  </span>
                </div>
              )}

              {/* Thread Message Scroll */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 min-h-[380px] bg-[#FAF9F5]/40">
                {messages.map((msg) => {
                  const isMine = msg.senderId === currentUser.id;

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                    >
                      <div className="text-[10px] text-stone-400 mb-1 px-1">
                        {isMine ? 'You' : activeConv.participants.find((p) => p.userId === msg.senderId)?.name || msg.senderName || 'User'} • {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>

                      <div
                        className={`p-3.5 rounded-2xl max-w-md text-xs shadow-xs space-y-2 ${
                          isMine
                            ? 'bg-[#283618] text-white rounded-br-none'
                            : 'bg-white text-[#283618] border border-[#E8E4D9] rounded-bl-none'
                        }`}
                      >
                        {msg.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.body}</p>}

                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className={`space-y-2 ${msg.body ? 'pt-2 border-t border-white/20' : ''}`}>
                            {msg.attachments.map((att) => (
                              <AttachmentTile key={att.id} attachment={att} isMine={isMine} onPreview={setPreviewAtt} />
                            ))}
                          </div>
                        )}
                      </div>

                      {isMine && (
                        <div className="text-[9px] text-stone-400 mt-0.5 flex items-center gap-1">
                          <CheckCheck className={`w-3 h-3 ${msg.isRead ? 'text-[#4F772D]' : 'text-stone-300'}`} />
                          <span>{msg.isRead ? 'Read' : 'Delivered'}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer */}
              {!activeConv.isBlocked && (
                <form onSubmit={handleSendMessage} className="p-3 border-t border-[#E8E4D9] bg-white space-y-2 min-w-0 w-full">
                  {composerError && (
                    <div role="alert" className="p-2.5 bg-red-50 text-red-800 text-xs rounded-xl font-medium flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-px" />
                      <span className="flex-1">{composerError}</span>
                      <button type="button" onClick={() => setComposerError('')} aria-label="Dismiss error" className="text-red-400 hover:text-red-700">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {pendingFiles.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto py-1">
                      {pendingFiles.map((pf) =>
                        pf.previewUrl ? (
                          <div key={pf.id} className="relative shrink-0">
                            <img src={pf.previewUrl} alt={pf.cleanName} className="w-16 h-16 rounded-xl object-cover border border-[#A3B18A]/40" />
                            <button
                              type="button"
                              onClick={() => removePendingFile(pf.id)}
                              disabled={sending}
                              aria-label={`Remove ${pf.cleanName}`}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-700 text-white flex items-center justify-center hover:bg-red-600 disabled:opacity-40"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div
                            key={pf.id}
                            className="px-2.5 py-2 bg-[#ECF3E9] text-[#283618] rounded-xl text-xs flex items-center gap-2 border border-[#A3B18A]/30 shrink-0"
                          >
                            <FileText className="w-4 h-4 text-[#4F772D]" />
                            <div className="min-w-0">
                              <p className="truncate max-w-[140px] font-semibold">{pf.cleanName}</p>
                              <p className="text-[10px] text-stone-500">{formatFileSize(pf.file.size)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removePendingFile(pf.id)}
                              disabled={sending}
                              aria-label={`Remove ${pf.cleanName}`}
                              className="text-stone-400 hover:text-red-600 disabled:opacity-40"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 w-full min-w-0">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || pendingFiles.length >= MAX_FILES_PER_MESSAGE}
                      className="shrink-0 p-2 min-w-11 min-h-11 flex items-center justify-center text-stone-400 hover:text-[#283618] hover:bg-[#F9F8F6] rounded-xl cursor-pointer transition-colors disabled:opacity-40"
                      title="Attach image, PDF or Word file"
                      aria-label="Attach file"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.doc,.docx"
                      onChange={handleFileUpload}
                      className="hidden"
                      tabIndex={-1}
                    />

                    <input
                      type="text"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      maxLength={MAX_MESSAGE_LENGTH}
                      readOnly={sending}
                      placeholder="Type a message…"
                      aria-label="Message"
                      className="flex-1 min-w-0 w-full text-base sm:text-sm p-3 bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#A3B18A]"
                    />

                    <button
                      type="submit"
                      disabled={sending || (!messageInput.trim() && pendingFiles.length === 0)}
                      aria-label={sending ? 'Sending message' : 'Send message'}
                      className="shrink-0 min-w-12 min-h-12 px-3 flex items-center justify-center gap-1.5 bg-[#4F772D] hover:bg-[#283618] disabled:bg-stone-300 disabled:text-stone-500 text-white text-sm font-bold rounded-xl shadow-sm cursor-pointer transition-colors"
                    >
                      {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                      <span className="hidden sm:inline">{sending ? 'Sending' : 'Send'}</span>
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-stone-400">
              <MessageSquare className="w-12 h-12 text-[#A3B18A] mb-2" />
              <p className="text-sm font-semibold text-[#283618]">Select a conversation to start messaging</p>
            </div>
          )}
        </div>
      </div>

      {previewAtt && isImageAttachment(previewAtt) && (
        <AttachmentLightbox attachment={previewAtt} onClose={() => setPreviewAtt(null)} />
      )}

      {/* Modal: New Message Inquiry */}
      {showNewMsgModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="max-h-[90dvh] overflow-y-auto overscroll-contain bg-white rounded-[32px] border border-[#E8E4D9] max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-[#283618] font-display">New Platform Inquiry</h3>
              <button onClick={() => setShowNewMsgModal(false)} className="text-stone-400 hover:text-stone-600 min-w-11 min-h-11 flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>

            {newMsgError && (
              <div className="p-3 bg-red-50 text-red-800 text-xs rounded-xl font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{newMsgError}</span>
              </div>
            )}

            <form onSubmit={handleStartNewConversation} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-[#283618] block mb-1">Recipient User Email</label>
                <input
                  type="email"
                  required
                  value={newMsgRecipientEmail}
                  onChange={(e) => setNewMsgRecipientEmail(e.target.value)}
                  placeholder="e.g. name@organization.com"
                  className="w-full text-xs p-3 bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#283618] block mb-1">Inquiry Category</label>
                <select
                  value={newMsgCategory}
                  onChange={(e) => setNewMsgCategory(e.target.value as ConversationCategory)}
                  className="w-full text-xs p-3 bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none"
                >
                  <option value="candidate_recruiter">Candidate & Recruiter Recruitment</option>
                  <option value="buyer_seller">M&A Buyer & Seller Business Inquiry</option>
                  <option value="organization">Organization & Institutional Procurement</option>
                  <option value="general">General Direct Messaging</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-[#283618] block mb-1">Subject / Thread Title</label>
                <input
                  type="text"
                  required
                  value={newMsgTitle}
                  onChange={(e) => setNewMsgTitle(e.target.value)}
                  placeholder="e.g. Interview Scheduling Inquiry / M&A Financial Disclosures"
                  className="w-full text-xs p-3 bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#283618] block mb-1">Initial Message Body</label>
                <textarea
                  rows={4}
                  required
                  value={newMsgBody}
                  onChange={(e) => setNewMsgBody(e.target.value)}
                  placeholder="Write your initial inquiry message..."
                  className="w-full text-xs p-3 bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewMsgModal(false)}
                  className="px-4 py-2 bg-stone-100 text-stone-600 rounded-xl text-xs font-bold hover:bg-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={startingConversation}
                  className="px-5 py-2 bg-[#283618] text-white rounded-xl text-xs font-bold hover:bg-[#132A13] disabled:opacity-50"
                >
                  {startingConversation ? 'Starting…' : 'Start Conversation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Report Conversation */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="max-h-[90dvh] overflow-y-auto overscroll-contain bg-white rounded-[32px] border border-[#E8E4D9] max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-[#283618] font-display flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <span>Report Communication Issue</span>
              </h3>
              <button onClick={() => setShowReportModal(false)} className="text-stone-400 hover:text-stone-600 min-w-11 min-h-11 flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportSubmitted ? (
              <div className="p-4 bg-green-50 text-green-800 text-xs rounded-xl font-bold text-center">
                Report submitted successfully to platform trust & safety officers.
              </div>
            ) : (
              <form onSubmit={handleReportSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-[#283618] block mb-1">Violation Category</label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value as MessageReport['reason'])}
                    className="w-full text-xs p-2.5 bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none"
                  >
                    <option value="spam">Spam / Unsolicited Marketing</option>
                    <option value="harassment">Harassment or Offensive Behavior</option>
                    <option value="fraud_scam">Fraud / Scam / Fake Opportunity</option>
                    <option value="inappropriate_content">Inappropriate Content</option>
                    <option value="other">Other Violation</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-[#283618] block mb-1">Details & Evidence</label>
                  <textarea
                    rows={3}
                    required
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Describe the issue for trust and safety review..."
                    className="w-full text-xs p-2.5 bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none resize-none"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="px-3.5 py-2 bg-stone-100 text-stone-600 rounded-xl text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700"
                  >
                    Submit Report
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
