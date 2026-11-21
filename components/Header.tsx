/**
 * Header: the top bar of the application shell.
 *
 * Full width so the brand lines up with the sidebar rail. A hairline underneath carries a short lit
 * segment (the brand light) under the logo; a compact label names the current area. Notifications
 * (with live socket updates), theme switching and the account menu work exactly as before.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import { useSocket } from '@/hooks/useSocket';
import { isNavHrefDisabled } from '@/lib/config/features';
import { notificationDestination } from '@/lib/class-notifications';
import { InlineLoader } from '@/components/loading';
import BrandLogo from '@/components/BrandLogo';
import ThemeToggle from '@/components/ThemeToggle';
import { surfaceFor } from '@/lib/design-surface';

interface Notification {
  _id: string;
  type: string;
  title: string;
  message: string;
  roleTarget?: string;
  userId?: string;
  roomId?: string;
  taskId?: string;
  read: boolean;
  createdAt: Date | string;
  metadata?: Record<string, any>;
}

const AREA_LABEL: Record<string, string> = {
  learn: 'Academy',
  practice: 'Practice · simulated',
  admin: 'Workspace',
};

const staffLink = 'rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-tint hover:text-ink';
const staffSoon = 'cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-ink-subtle';

function timeAgo(value: Date | string) {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} d ago` : new Date(value).toLocaleDateString();
}

export default function Header() {
  const { user, logout, isAuthenticated } = useAuth();
  const { socket, connected } = useSocket();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasSetupSocketListener = useRef(false);
  const area = AREA_LABEL[surfaceFor(router.pathname)];

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    // Redirect to login page after logout
    router.push('/login');
  };

  // Fetch notifications on mount and when user changes
  useEffect(() => {
    if (isAuthenticated && user) {
      fetchNotifications();
    }
  }, [isAuthenticated, user]);

  // Setup Socket.io listener for real-time notifications (only once)
  useEffect(() => {
    if (!socket || !connected || hasSetupSocketListener.current) return;

    // Phase 14: a socket event is only a hint. The list and the unread count always come from
    // GET /api/notifications (the database is the record), so a duplicate or missed event can
    // neither double-count nor lose anything. A reconnect refetches to catch up on missed events.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchNotifications(); }, 300);
    };

    socket.on('notification', refresh);
    socket.on('notification:new', refresh);
    socket.on('connect', refresh);
    hasSetupSocketListener.current = true;

    return () => {
      if (timer) clearTimeout(timer);
      socket.off('notification', refresh);
      socket.off('notification:new', refresh);
      socket.off('connect', refresh);
      hasSetupSocketListener.current = false;
    };
  }, [socket, connected]);

  const fetchNotifications = async () => {
    if (!isAuthenticated || !user) return;
    try {
      setLoadingNotifications(true);
      const response = await apiClient.get<{
        notifications: Notification[];
        unreadCount: number;
        total: number;
      }>('/notifications?limit=20');
      setNotifications(response.notifications || []);
      setUnreadCount(response.unreadCount || 0);
    } catch (error) {
      console.error('Failed to fetch notifications:');
    } finally {
      setLoadingNotifications(false);
    }
  };

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await apiClient.put('/notifications', { notificationId });
      setNotifications((prev) => prev.map((n) => (n._id === notificationId ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiClient.post('/notifications/mark-all-read');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:');
    }
  };

  // Close dropdowns when clicking outside, or with Escape.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) setNotificationsOpen(false);
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  return (
    <header className="glass-bar sticky top-0 z-50 text-ink">
      {/* The brand light along the bottom hairline, under the logo. */}
      <span aria-hidden className="pointer-events-none absolute -bottom-px left-0 h-px w-72 bg-[linear-gradient(90deg,transparent,rgba(255,112,18,0.85)_45%,transparent)]" />
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/"
            aria-label="FX Orbit Academy home"
            className="flex shrink-0 items-center rounded-md transition-opacity duration-200 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <BrandLogo priority className="h-8 lg:h-9" />
          </Link>
          {isAuthenticated && area && (
            <span className="hidden items-center gap-2 border-l border-line pl-4 text-xs font-medium text-ink-subtle md:inline-flex">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary-500 shadow-[0_0_8px_rgba(255,112,18,0.8)]" />
              {area}
            </span>
          )}
        </div>

        {/* Staff shortcuts on tablets (the sidebar is a drawer there). */}
        {user?.role !== 'student' && isAuthenticated && (
          <nav className="hidden items-center gap-1 md:flex lg:hidden" aria-label="Staff">
            {user?.role === 'instructor' && (
              <>
                <Link href="/instructor/dashboard" className={staffLink}>Instructor</Link>
                <Link href="/progress" className={staffLink}>Progress</Link>
                {isNavHrefDisabled('/certificates') ? (
                  <span className={staffSoon} title="Coming soon">Certificates <span className="ml-1 text-[10px] opacity-80">Soon</span></span>
                ) : (
                  <Link href="/certificates" className={staffLink}>Certificates</Link>
                )}
                {isNavHrefDisabled('/community') ? (
                  <span className={staffSoon} title="Coming soon">Community <span className="ml-1 text-[10px] opacity-80">Soon</span></span>
                ) : (
                  <Link href="/community" className={staffLink}>Community</Link>
                )}
              </>
            )}
            {user?.role === 'admin' && (
              <>
                <Link href="/admin" className={staffLink}>Admin</Link>
                <Link href="/progress" className={staffLink}>Progress</Link>
                {isNavHrefDisabled('/certificates') ? (
                  <span className={staffSoon} title="Coming soon">Certificates <span className="ml-1 text-[10px] opacity-80">Soon</span></span>
                ) : (
                  <Link href="/certificates" className={staffLink}>Certificates</Link>
                )}
              </>
            )}
          </nav>
        )}

        <div className="flex items-center gap-1 sm:gap-2">
          {isAuthenticated && (
            <div className="relative" ref={notificationsRef}>
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className={`icon-btn relative ${notificationsOpen ? 'bg-tint text-ink' : ''}`}
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                aria-expanded={notificationsOpen}
                aria-haspopup="true"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold leading-none text-neutral-950 ring-2 ring-[var(--fo-shell)]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 z-50 mt-2 flex max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] max-w-[24rem] origin-top-right animate-fade-in-fast flex-col overflow-hidden rounded-panel glass-panel sm:w-96">
                  <div className="flex flex-shrink-0 items-center justify-between border-b border-line px-4 py-3">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">Notifications</h3>
                      <p className="text-2xs text-ink-subtle">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={handleMarkAllAsRead} className="btn btn-ghost btn-sm text-primary-600 dark:text-primary-400">
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {loadingNotifications ? (
                      <div className="space-y-3 px-4 py-4">
                        <InlineLoader label="Loading notifications" />
                        <div className="orbit-skeleton h-10 rounded-lg" />
                        <div className="orbit-skeleton h-10 rounded-lg" />
                        <div className="orbit-skeleton h-10 rounded-lg" />
                      </div>
                    ) : notifications.length > 0 ? (
                      <ul className="divide-y divide-[var(--fo-line)]">
                        {notifications.map((notification) => (
                          <li key={notification._id}>
                            <button
                              type="button"
                              onClick={() => {
                                if (!notification.read) handleMarkAsRead(notification._id);
                                const destination = notificationDestination(notification);
                                if (destination) router.push(destination);
                              }}
                              className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-tint ${!notification.read ? 'bg-[color-mix(in_srgb,var(--fo-brand)_6%,transparent)]' : ''}`}
                            >
                              <span
                                aria-hidden
                                className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${!notification.read ? 'bg-primary-500 shadow-[0_0_8px_rgba(255,112,18,0.7)]' : 'bg-[var(--fo-line-strong)]'}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block break-words text-sm font-medium text-ink">{notification.title}</span>
                                <span className="mt-0.5 line-clamp-2 block break-words text-xs text-ink-muted">{notification.message}</span>
                                <span className="mt-1 block text-2xs text-ink-subtle">{timeAgo(notification.createdAt)}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="px-6 py-10 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-subtle">
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-ink">No notifications yet</p>
                        <p className="mt-1 text-xs text-ink-subtle">Class updates and replies will appear here.</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-[var(--fo-line)] px-4 py-2.5 text-xs font-semibold">
                    <Link href="/notifications" className="text-primary-600 hover:underline dark:text-primary-400" onClick={() => setNotificationsOpen(false)}>All notifications</Link>
                    <Link href="/settings/communication" className="text-ink-muted hover:text-ink" onClick={() => setNotificationsOpen(false)}>Notification settings</Link>
                  </div>
                </div>
              )}
            </div>
          )}

          <ThemeToggle className="h-10 w-10 rounded-xl text-ink-muted hover:bg-tint hover:text-ink" />

          {isAuthenticated ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={`flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-tint ${menuOpen ? 'bg-tint' : ''}`}
                aria-label="Account menu"
                aria-expanded={menuOpen}
                aria-haspopup="true"
              >
                <span className="rounded-full bg-[conic-gradient(from_200deg,#ff7012,#ffab6b,#c24e00,#ff7012)] p-[1.5px]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-neutral-950 ring-2 ring-[var(--fo-shell)]">
                    {user?.name?.charAt(0).toUpperCase()}
                  </span>
                </span>
                <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink lg:block">{user?.name}</span>
                <svg className={`hidden h-4 w-4 text-ink-subtle transition-transform sm:block ${menuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 z-50 mt-2 w-60 origin-top-right animate-fade-in-fast overflow-hidden rounded-panel glass-panel py-1.5">
                  <div className="border-b border-line px-4 pb-3 pt-2">
                    <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-subtle">{user?.email}</p>
                    {user?.role && <span className="chip chip-brand mt-2">{user.role === 'superadmin' ? 'Super admin' : user.role}</span>}
                  </div>
                  <Link
                    href="/dashboard"
                    className="mx-1.5 mt-1.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted transition-colors hover:bg-tint hover:text-ink"
                    onClick={() => setMenuOpen(false)}
                  >
                    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                    Dashboard
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="mx-1.5 mb-0.5 flex w-[calc(100%-0.75rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
                  >
                    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
