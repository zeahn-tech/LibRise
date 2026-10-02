import React, { useEffect, useState } from 'react';
import {
  Bell,
  X,
  CheckCheck,
  Briefcase,
  Calendar,
  MessageSquare,
  Building,
  CreditCard,
  Wallet,
  ShieldCheck,
  Sparkles,
  ExternalLink,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { AppNotification, NotificationCategory } from '../../types';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab?: (tab: string) => void;
  notifications: AppNotification[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onMarkAsRead: (id: string) => Promise<void> | void;
  onMarkAllAsRead: () => Promise<void> | void;
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'new_message', label: 'Messages' },
  { id: 'application_update', label: 'Applications' },
  { id: 'interview_invitation', label: 'Interviews' },
  { id: 'job_recommendation', label: 'Job Matches' },
  { id: 'business_inquiry', label: 'M&A Deals' },
  { id: 'verification_event', label: 'Verification' },
  { id: 'payment_event', label: 'Payments' },
  { id: 'subscription_event', label: 'Subscriptions' }
];

/** Where a notification's actionUrl should take the user inside the app. */
const tabForActionUrl = (url?: string): string | null => {
  if (!url) return null;
  if (url.includes('messages')) return 'messages';
  if (url.includes('candidate')) return 'candidate';
  if (url.includes('recruiter')) return 'recruiter';
  if (url.includes('businesses')) return 'businesses';
  if (url.includes('billing')) return 'billing';
  if (url.includes('verification')) return 'verification';
  if (url.includes('opportunities')) return 'opportunities';
  return null;
};

/** "Just now", "5m ago", "3h ago", "2d ago", else a short date. */
export const formatNotificationTime = (iso: string, now: number = Date.now()): string => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const getCategoryIcon = (category: NotificationCategory) => {
  switch (category) {
    case 'new_message':
      return <MessageSquare className="w-4 h-4 text-blue-600" />;
    case 'application_update':
      return <Briefcase className="w-4 h-4 text-[#4F772D]" />;
    case 'interview_invitation':
      return <Calendar className="w-4 h-4 text-purple-600" />;
    case 'job_recommendation':
      return <Sparkles className="w-4 h-4 text-[#BC6C25]" />;
    case 'business_inquiry':
      return <Building className="w-4 h-4 text-amber-600" />;
    case 'payment_event':
      return <Wallet className="w-4 h-4 text-emerald-700" />;
    case 'subscription_event':
      return <CreditCard className="w-4 h-4 text-emerald-600" />;
    case 'verification_event':
      return <ShieldCheck className="w-4 h-4 text-sky-600" />;
    default:
      return <Bell className="w-4 h-4 text-stone-500" />;
  }
};

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
  notifications,
  loading,
  error,
  onRetry,
  onMarkAsRead,
  onMarkAllAsRead
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Always reopen on "All" so a new item in another category is never hidden.
  useEffect(() => {
    if (isOpen) setSelectedCategory('all');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const filtered = notifications.filter((n) => selectedCategory === 'all' || n.category === selectedCategory);

  const handleOpen = async (notif: AppNotification) => {
    if (!notif.isRead) await onMarkAsRead(notif.id);
    const tab = tabForActionUrl(notif.actionUrl);
    if (tab && onNavigateTab) {
      onClose();
      onNavigateTab(tab);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md max-h-[100dvh] sm:max-h-[85vh] h-full sm:h-auto shadow-2xl flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#E8E4D9] flex items-center justify-between gap-2 bg-[#F9F8F6] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-2 bg-[#ECF3E9] text-[#283618] rounded-xl relative shrink-0">
              <Bell className="w-5 h-5 text-[#4F772D]" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 bg-[#BC6C25] text-white rounded-full text-[9px] font-black flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#283618] font-display">Notifications</h2>
              <p className="text-xs text-stone-500 truncate">
                {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {unreadCount > 0 && (
              <button
                onClick={() => onMarkAllAsRead()}
                className="text-[11px] font-bold text-[#4F772D] hover:underline flex items-center gap-1 cursor-pointer min-h-11 px-2"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close notifications"
              className="p-1.5 min-w-11 min-h-11 flex items-center justify-center text-stone-400 hover:text-stone-600 rounded-xl hover:bg-stone-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Category Filters */}
        <div className="p-3 border-b border-[#E8E4D9] flex gap-1.5 overflow-x-auto text-[11px] font-semibold bg-white shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((cat) => {
            const count = notifications.filter((n) => !n.isRead && (cat.id === 'all' || n.category === cat.id)).length;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1 ${
                  selectedCategory === cat.id
                    ? 'bg-[#283618] text-white font-bold'
                    : 'bg-[#F9F8F6] text-stone-600 hover:bg-stone-100 border border-[#E8E4D9]'
                }`}
              >
                {cat.label}
                {count > 0 && (
                  <span
                    className={`min-w-4 h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center ${
                      selectedCategory === cat.id ? 'bg-white/25 text-white' : 'bg-[#BC6C25] text-white'
                    }`}
                  >
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {error && notifications.length === 0 ? (
            <div className="p-10 text-center text-xs space-y-3">
              <AlertCircle className="w-8 h-8 mx-auto text-[#BC6C25]" />
              <p className="text-stone-600">{error}</p>
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-4 min-h-11 bg-[#283618] text-white rounded-xl font-bold cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </button>
            </div>
          ) : loading && notifications.length === 0 ? (
            <div className="p-8 text-center text-stone-400 text-xs">Loading notifications...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-stone-400 text-xs space-y-2">
              <Bell className="w-8 h-8 mx-auto text-stone-300" />
              <p>
                {notifications.length === 0
                  ? 'No notifications yet. Updates about your applications, messages and deals will appear here.'
                  : 'No notifications in this category.'}
              </p>
            </div>
          ) : (
            filtered.map((notif) => (
              <button
                type="button"
                key={notif.id}
                onClick={() => handleOpen(notif)}
                className={`w-full text-left p-3.5 rounded-2xl transition-all cursor-pointer flex items-start gap-3 border ${
                  notif.isRead
                    ? 'bg-white border-transparent hover:bg-[#F9F8F6]'
                    : 'bg-[#FEFAE0]/40 border-[#E8E4D9] font-medium'
                }`}
              >
                <div className="p-2 bg-white rounded-xl border border-[#E8E4D9] shadow-2xs shrink-0 mt-0.5 relative">
                  {getCategoryIcon(notif.category)}
                  {!notif.isRead && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#BC6C25] rounded-full border-2 border-white" />
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className={`text-xs font-bold break-words ${notif.isRead ? 'text-stone-700' : 'text-[#283618]'}`}>
                      {notif.title}
                    </h3>
                    <span className="text-[10px] text-stone-400 shrink-0 whitespace-nowrap">
                      {formatNotificationTime(notif.createdAt)}
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-600 leading-relaxed break-words">{notif.message}</p>

                  {tabForActionUrl(notif.actionUrl) && (
                    <span className="text-[10px] font-bold text-[#4F772D] flex items-center gap-0.5 pt-0.5">
                      View details <ExternalLink className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
