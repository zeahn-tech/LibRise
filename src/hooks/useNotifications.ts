import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNotification } from '../types';
import { notificationService } from '../services/notificationService';
import { onNotificationsChanged } from '../lib/notificationEvents';
import { useToast } from '../context/ToastContext';

const POLL_MS = 30_000;

/**
 * Single source of truth for the signed-in user's in-app notifications.
 * The bell badge and the panel both read from this, so they can never disagree.
 *
 * Stays fresh via: realtime push (when enabled), a 30s poll while the tab is
 * visible, refresh on tab focus, and an instant refresh whenever this tab
 * creates or dismisses a notification.
 */
export function useNotifications(userId?: string, options: { announce?: boolean } = {}) {
  const { showToast } = useToast();
  const announceRef = useRef(options.announce !== false);
  announceRef.current = options.announce !== false;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenIds = useRef<Set<string> | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const seq = ++requestSeq.current;
    const res = await notificationService.getUserNotifications(userId);
    if (seq !== requestSeq.current) return; // a newer request superseded this one
    if (res.error || !res.data) {
      setError(res.error?.message || 'Could not load notifications.');
      setLoading(false);
      return;
    }
    const list = res.data;

    // Announce arrivals that happened while the app was open (not on first load).
    if (seenIds.current && announceRef.current) {
      const fresh = list.filter((n) => !n.isRead && !seenIds.current!.has(n.id));
      if (fresh.length === 1) showToast(fresh[0].title, 'info');
      else if (fresh.length > 1) showToast(`${fresh.length} new notifications`, 'info');
    }
    seenIds.current = new Set(list.map((n) => n.id));

    setNotifications(list);
    setError(null);
    setLoading(false);
  }, [userId, showToast]);

  // (Re)load when the signed-in user changes; clear everything on sign-out.
  useEffect(() => {
    requestSeq.current++;
    seenIds.current = null;
    setNotifications([]);
    setError(null);
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh();
  }, [userId, refresh]);

  // Keep fresh: poll, focus, same-tab events, realtime.
  useEffect(() => {
    if (!userId) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const offLocal = onNotificationsChanged(refresh);
    const offRealtime = notificationService.subscribeToUser(userId, refresh);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      offLocal();
      offRealtime();
    };
  }, [userId, refresh]);

  const markAsRead = useCallback(
    async (id: string) => {
      const target = notifications.find((n) => n.id === id);
      if (!target || target.isRead) return;
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      const res = await notificationService.markAsRead(id);
      if (res.error) {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: false } : n)));
        showToast('Could not mark notification as read. Please try again.', 'error');
      }
    },
    [notifications, showToast]
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    const before = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    const res = await notificationService.markAllAsRead(userId);
    if (res.error) {
      setNotifications(before);
      showToast('Could not mark notifications as read. Please try again.', 'error');
    }
  }, [userId, notifications, showToast]);

  const unreadCount = notifications.reduce((n, x) => n + (x.isRead ? 0 : 1), 0);

  return { notifications, unreadCount, loading, error, refresh, markAsRead, markAllAsRead };
}
