/**
 * messagingService.ts
 *
 * Phase 3, Service 6 of the dbClient -> Supabase migration
 * (see docs/PRODUCTION_CERTIFICATION_REPORT.md, "Database Status", and
 * docs/PHASE3_SERVICE6_VERIFICATION.md for the live proof).
 *
 * Unlike every prior service, messaging had NO backing Supabase tables
 * at all before this migration -- conversations/direct_messages/
 * user_blocks were entirely local-only in dbClient.ts. See
 * supabase/migrations/20260910200000_messaging_service_backend.sql for
 * the new schema (a normalized conversation_participants join table,
 * not a jsonb array, so "am I allowed to see this" is a real indexed RLS
 * check) and 20260910210000_messaging_participant_profiles.sql for why
 * a narrow RPC (not a wider `users` policy) is how a participant sees
 * who they're talking to.
 *
 * Two invariants now live in Postgres, not here:
 *   - Starting a conversation only ever succeeds if the caller is among
 *     its participants (create_conversation_with_participants RPC).
 *   - A message cannot be sent if either party has blocked the other --
 *     enforced by a BEFORE INSERT trigger, not a client-side check the
 *     old dbClient.ts implementation relied on (it only marked the
 *     conversation `isBlocked` after the fact for the UI to read).
 * This service does not re-check either; it lets Postgres decide and
 * surfaces a denial as a normal ApiResponse error.
 *
 * reportConversation() delegates to trustSafetyService.submitReport(),
 * which writes to Service 8's content_reports table (report_type =
 * 'message') -- that table was already designed to cover message
 * reports, so no new schema was needed here.
 */

import {
  Conversation,
  ConversationCategory,
  ConversationParticipant,
  DirectMessage,
  MessageAttachment,
  MessageReport,
  UserBlock,
  UserRole
} from '../types';
import { getSupabaseClient } from '../lib/supabaseClient';
import { apiClient, ApiResponse } from './apiClient';
import { authService } from './authService';
import { notificationService } from './notificationService';
import { fireAndForget } from '../lib/fireAndForget';
import { trustSafetyService } from './trustSafetyService';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../core/errors/AppError';
import { toDbError } from './dbErrors';
import { validateUploadedFile, verifyFileSignature } from '../core/security/fileValidator';

export const MESSAGE_ATTACHMENT_BUCKET = 'message-attachments';
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

interface ConversationRow {
  id: string;
  category: string;
  title: string;
  context_id: string | null;
  context_type: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  is_blocked: boolean;
  blocked_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ParticipantRowJoin {
  conversation_id: string;
  user_id: string;
  unread_count: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  attachments: MessageAttachment[] | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

function client() {
  const c = getSupabaseClient();
  if (!c) {
    throw new ForbiddenError('Supabase is not configured; messagingService requires a live backend.');
  }
  return c;
}

function translateError(error: { code?: string; message: string }): never {
  if (error.code === '42501') {
    throw new ForbiddenError(error.message || 'You do not have permission to perform this action.');
  }
  throw toDbError('messagingService', error);
}

async function hydrateParticipants(conversationId: string): Promise<ConversationParticipant[]> {
  const [{ data: rows }, { data: profiles, error: profilesError }] = await Promise.all([
    client().from('conversation_participants').select('*').eq('conversation_id', conversationId),
    client().rpc('get_conversation_participant_profiles', { p_conversation_id: conversationId })
  ]);
  if (profilesError) throw new Error(profilesError.message);

  const profileMap = new Map<string, { full_name: string; avatar_url: string | null; primary_role: string | null }>(
    (profiles || []).map((p: any) => [p.user_id, p])
  );
  return ((rows as ParticipantRowJoin[]) || []).map((r) => {
    const profile = profileMap.get(r.user_id);
    return {
      userId: r.user_id,
      name: profile?.full_name || 'Unknown User',
      email: '',
      role: (profile?.primary_role as UserRole) || undefined,
      avatar: profile?.avatar_url || undefined
    };
  });
}

async function rowToConversation(row: ConversationRow): Promise<Conversation> {
  const participants = await hydrateParticipants(row.id);
  const { data: participantRows } = await client()
    .from('conversation_participants')
    .select('user_id, unread_count')
    .eq('conversation_id', row.id);
  const unreadCountByUserId: Record<string, number> = {};
  ((participantRows as ParticipantRowJoin[]) || []).forEach((p) => {
    unreadCountByUserId[p.user_id] = p.unread_count;
  });

  return {
    id: row.id,
    category: row.category as ConversationCategory,
    title: row.title,
    participants,
    contextId: row.context_id ?? undefined,
    contextType: (row.context_type as Conversation['contextType']) ?? undefined,
    lastMessage: row.last_message ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    lastSenderId: row.last_sender_id ?? undefined,
    unreadCountByUserId,
    isBlocked: row.is_blocked,
    blockedByUserId: row.blocked_by_user_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToMessage(row: MessageRow): DirectMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: '',
    recipientId: row.recipient_id,
    body: row.body,
    attachments: row.attachments || [],
    isRead: row.is_read,
    readAt: row.read_at ?? undefined,
    createdAt: row.created_at
  };
}

/** Signed URLs for every storage-backed attachment in one round-trip; legacy inline data URLs pass through. */
async function resolveAttachmentUrls(messages: DirectMessage[]): Promise<DirectMessage[]> {
  const paths = Array.from(
    new Set(messages.flatMap((m) => (m.attachments || []).map((a) => a.path).filter((p): p is string => !!p)))
  );
  if (paths.length === 0) return messages;

  const { data, error } = await client().storage.from(MESSAGE_ATTACHMENT_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return messages; // attachments render as unavailable; the thread itself still loads
  const urlByPath = new Map<string, string>();
  data.forEach((d) => {
    if (d.path && d.signedUrl) urlByPath.set(d.path, d.signedUrl);
  });
  return messages.map((m) => ({
    ...m,
    attachments: (m.attachments || []).map((a) => (a.path ? { ...a, urlOrBase64: urlByPath.get(a.path) || '' } : a))
  }));
}

function safeObjectName(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
}

export const messagingService = {
  async getUserConversations(userId: string): Promise<ApiResponse<Conversation[]>> {
    return apiClient.execute(async () => {
      const { data, error } = await client()
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId);
      if (error) throw toDbError('messagingService', error);
      const ids = ((data as { conversation_id: string }[]) || []).map((r) => r.conversation_id);
      if (ids.length === 0) return [];

      const { data: convRows, error: convError } = await client()
        .from('conversations')
        .select('*')
        .in('id', ids)
        .order('updated_at', { ascending: false });
      if (convError) throw new Error(convError.message);
      return Promise.all((convRows as ConversationRow[]).map(rowToConversation));
    });
  },

  async getConversation(conversationId: string): Promise<ApiResponse<Conversation | null>> {
    return apiClient.execute(async () => {
      const { data, error } = await client().from('conversations').select('*').eq('id', conversationId).maybeSingle();
      if (error) throw toDbError('messagingService', error);
      return data ? rowToConversation(data as ConversationRow) : null;
    });
  },

  async getMessages(conversationId: string, userId: string): Promise<ApiResponse<DirectMessage[]>> {
    return apiClient.execute(async () => {
      await this.markAsRead(conversationId, userId);

      const { data, error } = await client()
        .from('direct_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (error) throw toDbError('messagingService', error);
      return resolveAttachmentUrls((data as MessageRow[]).map(rowToMessage));
    });
  },

  async startConversation(data: {
    category: ConversationCategory;
    title: string;
    participants: ConversationParticipant[];
    contextId?: string;
    contextType?: 'opportunity' | 'application' | 'business_listing' | 'general';
    initialMessage?: string;
    senderUserId: string;
  }): Promise<ApiResponse<Conversation>> {
    return apiClient.execute(async () => {
      const session = authService.getSession();
      if (!session.user) throw new UnauthorizedError('Sign in required to start a conversation.');

      // Reuse an existing conversation for the same context + participants,
      // matching dbClient.ts's old dedup behavior.
      if (data.contextId) {
        const { data: existingByContext } = await client()
          .from('conversations')
          .select('*')
          .eq('context_id', data.contextId);
        for (const row of (existingByContext as ConversationRow[]) || []) {
          const { data: existingParticipants } = await client()
            .from('conversation_participants')
            .select('user_id')
            .eq('conversation_id', row.id);
          const existingIds = ((existingParticipants as { user_id: string }[]) || []).map((p) => p.user_id);
          const newIds = data.participants.map((p) => p.userId);
          if (newIds.every((id) => existingIds.includes(id))) {
            if (data.initialMessage) {
              const sent = await this.sendMessage({
                conversationId: row.id,
                senderId: data.senderUserId,
                senderName: data.participants.find((p) => p.userId === data.senderUserId)?.name || '',
                recipientId: data.participants.find((p) => p.userId !== data.senderUserId)?.userId || '',
                body: data.initialMessage
              });
              if (sent.error) throw new Error(sent.error.message);
            }
            return rowToConversation(row);
          }
        }
      }

      const id = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const { data: created, error } = await client().rpc('create_conversation_with_participants', {
        p_id: id,
        p_category: data.category,
        p_title: data.title,
        p_context_id: data.contextId ?? null,
        p_context_type: data.contextType ?? null,
        p_participant_ids: data.participants.map((p) => p.userId)
      });
      if (error) translateError(error);

      if (data.initialMessage) {
        const sender = data.participants.find((p) => p.userId === data.senderUserId);
        const recipient = data.participants.find((p) => p.userId !== data.senderUserId);
        if (sender && recipient) {
          const sent = await this.sendMessage({
            conversationId: (created as ConversationRow).id,
            senderId: sender.userId,
            senderName: sender.name,
            senderRole: sender.role,
            recipientId: recipient.userId,
            body: data.initialMessage
          });
          if (sent.error) throw new Error(`Conversation created, but the first message failed: ${sent.error.message}`);
        }
      }

      return rowToConversation(created as ConversationRow);
    });
  },

  async sendMessage(data: {
    conversationId: string;
    senderId: string;
    senderName: string;
    senderAvatar?: string;
    senderRole?: UserRole;
    recipientId: string;
    body: string;
    /** Real files picked by the user; uploaded to private Storage and referenced by path. */
    files?: File[];
    /** Pre-built attachment metadata (e.g. legacy inline attachments). */
    attachments?: MessageAttachment[];
  }): Promise<ApiResponse<DirectMessage>> {
    return apiClient.execute(async () => {
      const body = (data.body || '').trim();
      const files = data.files || [];
      const extra = data.attachments || [];
      if (!body && files.length === 0 && extra.length === 0) {
        throw new ValidationError('Write a message or attach a file before sending.');
      }
      if (files.length + extra.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        throw new ValidationError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
      }

      const id = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      const uploadedPaths: string[] = [];
      const attachments: MessageAttachment[] = [...extra];

      try {
        for (const file of files) {
          const category = file.type.startsWith('image/') ? 'image' : 'document';
          const validation = validateUploadedFile(file, category);
          if (!validation.valid) throw new ValidationError(validation.error || 'Attachment validation failed.');
          const ext = validation.cleanFileName.split('.').pop() || '';
          const sigError = await verifyFileSignature(file, ext);
          if (sigError) throw new ValidationError(`${validation.cleanFileName}: ${sigError}`);

          const attId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
          const path = `${data.conversationId}/${id}/${attId}-${safeObjectName(validation.cleanFileName)}`;
          const { error: uploadError } = await client()
            .storage.from(MESSAGE_ATTACHMENT_BUCKET)
            .upload(path, file, { contentType: validation.fileType, upsert: false, cacheControl: '3600' });
          if (uploadError) {
            if (/bucket not found/i.test(uploadError.message)) {
              throw new Error('Attachment storage is not set up yet. Please contact support.');
            }
            throw new Error(`Could not upload ${validation.cleanFileName}: ${uploadError.message}`);
          }
          uploadedPaths.push(path);
          attachments.push({
            id: attId,
            fileName: validation.cleanFileName,
            fileType: validation.fileType,
            fileSize: file.size,
            path,
            urlOrBase64: ''
          });
        }

        const { data: created, error } = await client()
          .from('direct_messages')
          .insert({
            id,
            conversation_id: data.conversationId,
            sender_id: data.senderId,
            recipient_id: data.recipientId,
            body,
            attachments
          })
          .select('*')
          .maybeSingle();
        // The blocking trigger and participant-membership RLS both raise
        // 42501 here -- surfaced as ForbiddenError either way, no
        // client-side re-check of either invariant.
        if (error) translateError(error);
        if (!created) throw new Error('The message could not be saved. Please try again.');

        // last_message / unread_count are maintained atomically by the
        // trg_on_direct_message_inserted trigger (RLS stops the sender from
        // updating the recipient's participant row from the client).
        try {
          const { data: conv } = await client().from('conversations').select('title').eq('id', data.conversationId).maybeSingle();
          fireAndForget(
            notificationService.notifyNewMessage({
              recipientUserId: data.recipientId,
              senderName: data.senderName,
              conversationTitle: (conv as { title: string } | null)?.title || 'Platform Message',
              conversationId: data.conversationId
            }),
            'notify new message'
          );
        } catch {
          // Non-critical.
        }

        const [message] = await resolveAttachmentUrls([rowToMessage(created as MessageRow)]);
        return message;
      } catch (err) {
        // Don't leave orphaned files behind when the message itself failed.
        if (uploadedPaths.length > 0) {
          await client().storage.from(MESSAGE_ATTACHMENT_BUCKET).remove(uploadedPaths).catch(() => undefined);
        }
        throw err;
      }
    });
  },

  async markAsRead(conversationId: string, userId: string): Promise<ApiResponse<void>> {
    return apiClient.execute(async () => {
      await client()
        .from('direct_messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('recipient_id', userId)
        .eq('is_read', false);
      await client()
        .from('conversation_participants')
        .update({ unread_count: 0 })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
    });
  },

  async blockUser(blockingUserId: string, blockedUserId: string, reason?: string): Promise<ApiResponse<UserBlock>> {
    return apiClient.execute(async () => {
      const id = `block-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const { data, error } = await client()
        .from('user_blocks')
        .insert({ id, blocking_user_id: blockingUserId, blocked_user_id: blockedUserId, reason: reason ?? null })
        .select('*')
        .maybeSingle();
      if (error) translateError(error);
      const row = data as { id: string; blocking_user_id: string; blocked_user_id: string; reason: string | null; created_at: string };
      return {
        id: row.id,
        blockingUserId: row.blocking_user_id,
        blockedUserId: row.blocked_user_id,
        reason: row.reason ?? undefined,
        createdAt: row.created_at
      };
    });
  },

  async unblockUser(blockingUserId: string, blockedUserId: string): Promise<ApiResponse<void>> {
    return apiClient.execute(async () => {
      const { error } = await client()
        .from('user_blocks')
        .delete()
        .eq('blocking_user_id', blockingUserId)
        .eq('blocked_user_id', blockedUserId);
      if (error) translateError(error);
    });
  },

  /**
   * Resolves an exact email to a minimal user profile (id/name/role) via
   * find_user_by_email() -- `users` RLS is self-only, so this is the only
   * way to start a new conversation by email. See
   * supabase/migrations/20260912110000_find_user_by_email.sql.
   */
  async findUserByEmail(email: string): Promise<ApiResponse<{ id: string; fullName: string; primaryRole?: string } | null>> {
    return apiClient.execute(async () => {
      const { data, error } = await client().rpc('find_user_by_email', { p_email: email });
      if (error) throw toDbError('messagingService', error);
      const rows = (data as { user_id: string; full_name: string; primary_role: string | null }[]) || [];
      if (rows.length === 0) return null;
      return { id: rows[0].user_id, fullName: rows[0].full_name, primaryRole: rows[0].primary_role ?? undefined };
    });
  },

  async getBlockedUsers(userId: string): Promise<ApiResponse<UserBlock[]>> {
    return apiClient.execute(async () => {
      const { data, error } = await client().from('user_blocks').select('*').eq('blocking_user_id', userId);
      if (error) throw toDbError('messagingService', error);
      return ((data as any[]) || []).map((row) => ({
        id: row.id,
        blockingUserId: row.blocking_user_id,
        blockedUserId: row.blocked_user_id,
        reason: row.reason ?? undefined,
        createdAt: row.created_at
      }));
    });
  },

  // ---------------------------------------------------------------------
  // Message/conversation reporting is folded into Service 8's
  // content_reports table (report_type = 'message') -- that table was
  // already designed to cover it, so no new schema was needed. See
  // supabase/migrations/20260912090000_deferred_features_backend.sql's
  // header comment and docs/PHASE3_SERVICE6_VERIFICATION.md.
  // ---------------------------------------------------------------------
  async reportConversation(data: {
    conversationId: string;
    messageId?: string;
    reporterUserId: string;
    reportedUserId: string;
    reason: MessageReport['reason'];
    details: string;
  }): Promise<ApiResponse<MessageReport>> {
    return apiClient.execute(async () => {
      // ContentReportReason has no 'fraud_scam' value; 'scam_fee_charging'
      // is the closest existing category. Everything else maps 1:1.
      const reasonMap: Record<MessageReport['reason'], import('../types').ContentReportReason> = {
        spam: 'spam',
        harassment: 'harassment',
        fraud_scam: 'scam_fee_charging',
        inappropriate_content: 'inappropriate_content',
        other: 'other'
      };

      const report = await trustSafetyService.submitReport({
        reportType: 'message',
        targetId: data.reportedUserId,
        targetTitleOrName: data.messageId
          ? `Message ${data.messageId} in conversation ${data.conversationId}`
          : `Conversation ${data.conversationId}`,
        reason: reasonMap[data.reason],
        details: data.details
      });

      return {
        id: report.id,
        conversationId: data.conversationId,
        messageId: data.messageId,
        reporterUserId: report.reporterUserId,
        reportedUserId: data.reportedUserId,
        reason: data.reason,
        details: report.details,
        status: report.status === 'dismissed' ? 'dismissed' : report.status === 'actioned' ? 'resolved' : 'pending',
        createdAt: report.createdAt
      };
    });
  }
};
