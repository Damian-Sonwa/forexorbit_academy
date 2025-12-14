/**
 * Header Component
 * Main navigation header with user menu
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';

export default function Header() {
  const { user, logout, isAuthenticated } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    // Redirect to login page after logout
    router.push('/login');
  };

  // FIX: Load profile photo for header avatar
  useEffect(() => {
    if (isAuthenticated && user) {
      loadProfilePhoto();
    }
  }, [isAuthenticated, user]);

  // FIX: Refresh profile photo periodically to update live
  useEffect(() => {
    if (isAuthenticated && user) {
      const interval = setInterval(() => {
        loadProfilePhoto();
      }, 5000);
      
      const handleFocus = () => {
        loadProfilePhoto();
      };
      window.addEventListener('focus', handleFocus);
      
      return () => {
        clearInterval(interval);
        window.removeEventListener('focus', handleFocus);
      };
    }
  }, [isAuthenticated, user]);

  const loadProfilePhoto = async () => {
    try {
      const data = await apiClient.get<any>('/auth/me');
      if (data.profilePhoto) {
        setProfilePhoto(data.profilePhoto);
      }
    } catch (error) {
      // Ignore errors - profile photo is optional
    }
  };

  // Fetch notifications
  useEffect(() => {
    if (isAuthenticated && user) {
      fetchNotifications();
      // Poll for new notifications every 30 seconds
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, user]);

  const fetchNotifications = async () => {
    try {
      // For now, use a placeholder - can be replaced with actual API endpoint
      // const data = await apiClient.get('/notifications');
      // setNotifications(data);
      // setUnreadCount(data.filter((n: any) => !n.read).length);
      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
      if (languageRef.current && !languageRef.current.contains(event.target as Node)) {
        setLanguageOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const languages = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'pt', name: 'Português', flag: '🇵🇹' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  ];

  const handleLanguageChange = (langCode: string) => {
    setSelectedLanguage(langCode);
    setLanguageOpen(false);
    // Language change logic can be implemented here
  };

  return (
    // FIX: Replace dark navy header with modern gradient - indigo to purple to blue
    <header className="bg-gradient-to-r from-slate-900 via-indigo-900 to-purple-900 text-gray-300 shadow-md dark:shadow-gray-900/50 sticky top-0 z-50 border-b border-indigo-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14 py-2">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2 group">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-lg flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
              <span className="text-white font-bold text-sm sm:text-base">FA</span>
            </div>
            <span className="text-lg sm:text-xl font-display font-bold">
              <span className="bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">ForexOrbit</span>
              <span className="text-white ml-1 hidden sm:inline">Academy</span>
            </span>
          </Link>

          {/* Navigation - Hidden for students, shown for other roles */}
          {user?.role !== 'student' && (
            <nav className="hidden md:flex items-center space-x-1">
              {isAuthenticated && (
                <>
                  {user?.role === 'instructor' && (
                    <>
                      <Link href="/instructor/dashboard" className="px-4 py-2 text-gray-300 hover:text-primary-400 hover:bg-gray-800/50 rounded-lg font-medium transition-all">
                        Instructor
                      </Link>
                      <Link href="/progress" className="px-4 py-2 text-gray-300 hover:text-primary-400 hover:bg-gray-800/50 rounded-lg font-medium transition-all">
                        Progress
                      </Link>
                      <Link href="/certificates" className="px-4 py-2 text-gray-300 hover:text-primary-400 hover:bg-gray-800/50 rounded-lg font-medium transition-all">
                        Certificates
                      </Link>
                      <Link href="/community" className="px-4 py-2 text-gray-300 hover:text-primary-400 hover:bg-gray-800/50 rounded-lg font-medium transition-all">
                        Community
                      </Link>
                    </>
                  )}
                  {user?.role === 'admin' && (
                    <>
                      <Link href="/admin" className="px-4 py-2 text-gray-300 hover:text-primary-400 hover:bg-gray-800/50 rounded-lg font-medium transition-all">
                        Admin
                      </Link>
                      <Link href="/progress" className="px-4 py-2 text-gray-300 hover:text-primary-400 hover:bg-gray-800/50 rounded-lg font-medium transition-all">
                        Progress
                      </Link>
                      <Link href="/certificates" className="px-4 py-2 text-gray-300 hover:text-primary-400 hover:bg-gray-800/50 rounded-lg font-medium transition-all">
                        Certificates
                      </Link>
                    </>
                  )}
                </>
              )}
            </nav>
          )}

          {/* Right Side Actions */}
          <div className="flex items-center space-x-4">
            {/* Notifications - Only for authenticated users */}
            {isAuthenticated && (
              <div className="relative" ref={notificationsRef}>
                <button
                  onClick={() => setNotificationsOpen(!notificationsOpen)}
                  className="relative p-1.5 rounded-lg transition-colors hover:bg-indigo-800/50 text-gray-300"
                  aria-label="Notifications"
                >
                  <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">Notifications</h3>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length > 0 ? (
                        notifications.map((notification) => (
                          <div
                            key={notification._id || notification.id}
                            className={`px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                              !notification.read ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                            }`}
                          >
                            <p className="text-sm text-gray-900 dark:text-white font-medium">{notification.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{notification.message}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                              {new Date(notification.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-8 text-center">
                          <p className="text-sm text-gray-500 dark:text-gray-400">No notifications</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Language Selection - Only for authenticated users */}
            {isAuthenticated && (
              <div className="relative" ref={languageRef}>
                <button
                  onClick={() => setLanguageOpen(!languageOpen)}
                  className="flex items-center space-x-1.5 px-2 py-1 rounded-lg transition-colors hover:bg-indigo-800/50 text-gray-300"
                  aria-label="Language"
                >
                  <span className="text-lg">
                    {languages.find((l) => l.code === selectedLanguage)?.flag || '🌐'}
                  </span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {languageOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 overflow-hidden z-50">
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => handleLanguageChange(lang.code)}
                        className={`w-full flex items-center space-x-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left ${
                          selectedLanguage === lang.code ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                        }`}
                      >
                        <span className="text-xl">{lang.flag}</span>
                        <span className="text-sm text-gray-900 dark:text-white">{lang.name}</span>
                        {selectedLanguage === lang.code && (
                          <svg className="w-4 h-4 text-primary-600 dark:text-primary-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
                  className="p-1.5 rounded-lg transition-colors hover:bg-indigo-800/50 text-gray-300"
              aria-label="Toggle dark mode"
            >
              {isDark ? (
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            
            {isAuthenticated ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center space-x-2 px-2 py-1 rounded-lg transition-colors hover:bg-indigo-800/50"
                >
                  {/* FIX: Use profile photo in header if available, with fallback to avatar initial */}
                  <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-xs sm:text-sm shadow-md">
                    {profilePhoto ? (
                      <img
                        src={profilePhoto}
                        alt={user?.name || 'User'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback to avatar initial if image fails
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            const fallback = document.createElement('span');
                            fallback.className = 'text-white font-bold text-xs sm:text-sm';
                            fallback.textContent = user?.name?.charAt(0).toUpperCase() || 'U';
                            parent.appendChild(fallback);
                          }
                        }}
                      />
                    ) : (
                      <span>{user?.name?.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="hidden lg:block text-gray-300 text-sm">{user?.name}</span>
                  <svg className="w-4 h-4 text-gray-400 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-48 sm:w-56 bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{user?.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{user?.email}</p>
                    </div>
                    <Link
                      href="/dashboard"
                      className="flex items-center px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-gray-700 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                      onClick={() => setMenuOpen(false)}
                    >
                      <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      Dashboard
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="flex items-center w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link href="/login" className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors">
                  Login
                </Link>
                <Link href="/signup" className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

