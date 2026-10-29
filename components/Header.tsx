/**
 * Header Component
 * Main navigation header with user menu
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
  const hasSetupSocketListener = useRef(false);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
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

    const handleNotification = (notification: Notification) => {
      console.log('New notification received:', notification);
      // Add notification to the list
      setNotifications((prev) => {
        // Check if notification already exists (prevent duplicates)
        const exists = prev.some((n) => n._id === notification._id);
        if (exists) return prev;
        // Add to beginning of list
        return [notification, ...prev];
      });
      // Update unread count
      setUnreadCount((prev) => prev + 1);
    };

    socket.on('notification', handleNotification);
    hasSetupSocketListener.current = true;

    return () => {
      socket.off('notification', handleNotification);
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
      }>('/notifications?limit=50');
      
      setNotifications(response.notifications || []);
      setUnreadCount(response.unreadCount || 0);
    } catch (error) {
      console.error('Failed to fetch notifications:');
      // Don't show error to user, just log it
    } finally {
      setLoadingNotifications(false);
    }
  };

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await apiClient.put('/notifications', { notificationId });
      // Update local state
      setNotifications((prev) =>
        prev.map((n) => (n._id === notificationId ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiClient.post('/notifications/mark-all-read');
      // Update local state
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:');
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="bg-white/90 text-neutral-900 dark:bg-[#07080c]/90 dark:text-white sticky top-0 z-50 border-b border-neutral-200/80 dark:border-white/10 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14 py-2">
          {/* Logo */}
          <Link
            href="/"
            aria-label="FX Orbit Academy home"
            className="flex shrink-0 items-center rounded-md transition-opacity duration-200 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
          >
            <BrandLogo priority className="h-8 lg:h-9" />
          </Link>

          {/* Navigation - Hidden for students, shown for other roles */}
          {user?.role !== 'student' && (
            <nav className="hidden md:flex lg:hidden items-center space-x-1" aria-label="Staff">
              {isAuthenticated && (
                <>
                  {user?.role === 'instructor' && (
                    <>
                      <Link href="/instructor/dashboard" className="px-4 py-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-white/10 rounded-lg font-medium transition-all">
                        Instructor
                      </Link>
                      <Link href="/progress" className="px-4 py-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-white/10 rounded-lg font-medium transition-all">
                        Progress
                      </Link>
                      {isNavHrefDisabled('/certificates') ? (
                        <span className="px-4 py-2 text-neutral-400 cursor-not-allowed rounded-lg font-medium" title="Coming soon">
                          Certificates <span className="text-[10px] ml-1 opacity-80">Soon</span>
                        </span>
                      ) : (
                        <Link href="/certificates" className="px-4 py-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-white/10 rounded-lg font-medium transition-all">
                          Certificates
                        </Link>
                      )}
                      {isNavHrefDisabled('/community') ? (
                        <span className="px-4 py-2 text-neutral-400 cursor-not-allowed rounded-lg font-medium" title="Coming soon">
                          Community <span className="text-[10px] ml-1 opacity-80">Soon</span>
                        </span>
                      ) : (
                        <Link href="/community" className="px-4 py-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-white/10 rounded-lg font-medium transition-all">
                          Community
                        </Link>
                      )}
                    </>
                  )}
                  {user?.role === 'admin' && (
                    <>
                      <Link href="/admin" className="px-4 py-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-white/10 rounded-lg font-medium transition-all">
                        Admin
                      </Link>
                      <Link href="/progress" className="px-4 py-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-white/10 rounded-lg font-medium transition-all">
                        Progress
                      </Link>
                      {isNavHrefDisabled('/certificates') ? (
                        <span className="px-4 py-2 text-neutral-400 cursor-not-allowed rounded-lg font-medium" title="Coming soon">
                          Certificates <span className="text-[10px] ml-1 opacity-80">Soon</span>
                        </span>
                      ) : (
                        <Link href="/certificates" className="px-4 py-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:text-white dark:hover:bg-white/10 rounded-lg font-medium transition-all">
                          Certificates
                        </Link>
                      )}
                    </>
                  )}
                </>
              )}
            </nav>
          )}

          {/* Right Side Actions */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            {/* Notifications - Only for authenticated users */}
            {isAuthenticated && (
              <div className="relative" ref={notificationsRef}>
                <button
                  onClick={() => setNotificationsOpen(!notificationsOpen)}
                  className="relative p-1.5 sm:p-2 rounded-lg transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-600 dark:text-neutral-300"
                  aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                  aria-expanded={notificationsOpen}
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-primary-600 text-white text-[10px] sm:text-xs font-bold rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute right-0 mt-2 w-[calc(100vw-3rem)] sm:w-80 md:w-96 max-w-[90vw] sm:max-w-sm bg-white dark:bg-[#101214] rounded-xl shadow-xl border border-gray-200 dark:border-white/10 overflow-hidden z-50 max-h-[calc(100vh-6rem)] flex flex-col">
                    {/* Header */}
                    <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] flex items-center justify-between flex-shrink-0">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">Notifications</h3>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllAsRead}
                          className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium px-2 py-1 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    
                    {/* Notifications List - Scrollable */}
                    <div className="overflow-y-auto flex-1 min-h-0">
                      {loadingNotifications ? (
                        <div className="space-y-3 px-4 py-4">
                          <InlineLoader label="Loading notifications" />
                          <div className="orbit-skeleton h-10 rounded-lg" />
                          <div className="orbit-skeleton h-10 rounded-lg" />
                          <div className="orbit-skeleton h-10 rounded-lg" />
                        </div>
                      ) : notifications.length > 0 ? (
                        notifications.map((notification) => (
                          <div
                            key={notification._id}
                            onClick={() => {
                              if (!notification.read) handleMarkAsRead(notification._id);
                              const destination = notificationDestination(notification);
                              if (destination) router.push(destination);
                            }}
                            className={`px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer border-l-2 ${
                              !notification.read 
                                ? 'bg-primary-50 dark:bg-primary-950/40 border-primary-500' 
                                : 'border-transparent'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0 pr-1">
                                <p className="text-xs sm:text-sm text-gray-900 dark:text-white font-medium break-words">{notification.title}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 break-words">{notification.message}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                                  {new Date(notification.createdAt).toLocaleString()}
                                </p>
                              </div>
                              {!notification.read && (
                                <div className="w-2 h-2 bg-primary-500 rounded-full flex-shrink-0 mt-1"></div>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 sm:px-4 py-6 sm:py-8 text-center">
                          <svg className="w-10 h-10 sm:w-12 sm:h-12 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">No notifications</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <ThemeToggle className="text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10" />

            {isAuthenticated ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center space-x-2 px-2 py-1 rounded-lg transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
                  aria-label="Account menu"
                  aria-expanded={menuOpen}
                >
                  <div className="w-8 h-8 sm:w-9 sm:h-9 bg-primary-500 rounded-full flex items-center justify-center text-neutral-950 font-bold text-xs sm:text-sm">
                    {user?.name?.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden lg:block text-neutral-700 dark:text-neutral-300 text-sm">{user?.name}</span>
                  <svg className="w-4 h-4 text-gray-400 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-48 sm:w-56 bg-white dark:bg-[#101214] rounded-xl sm:rounded-2xl shadow-xl border border-gray-200 dark:border-white/10 py-2 overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03]">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{user?.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{user?.email}</p>
                    </div>
                    <Link
                      href="/dashboard"
                      className="flex items-center px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-white/5 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                      onClick={() => setMenuOpen(false)}
                    >
                      <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      Dashboard
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="flex items-center w-full text-left px-4 py-3 text-sm text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                    >
                      <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link href="/login" className="btn btn-ghost px-3 sm:px-4">
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-primary px-3 sm:px-4">
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

