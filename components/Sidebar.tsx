/**
 * Sidebar Component - Redesigned
 * Collapsible sidebar with role-based navigation, responsive design, and smooth transitions
 * 
 * Features:
 * - Role-based navigation (Student, Instructor, Admin, Super Admin)
 * - Collapsible/expandable for mobile and desktop
 * - Profile section with photo
 * - Active page highlighting
 * - Smooth transitions and hover effects
 * - Responsive: hamburger menu on mobile
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/hooks/useAuth';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface SidebarProps {
  courseId?: string;
  lessons?: Array<{ id: string; title: string; order: number }>;
  currentLessonId?: string;
}

// Icon Components (Heroicons-style SVG icons)
const DashboardIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const CoursesIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);

const ProgressIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const CertificatesIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
  </svg>
);

const ProfileIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);


const UsersIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const AnalyticsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const ApprovalsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// const LeaderboardIcon = ({ className }: { className?: string }) => ( // Reserved for future use
//   <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
//     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
//   </svg>
// );

const CommunityIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const ConsultationIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const AIAssistantIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const MenuIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// const ChevronDownIcon = ({ className }: { className?: string }) => ( // Reserved for future use
//   <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
//     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
//   </svg>
// );

export default function Sidebar({ }: SidebarProps) {
  // courseId, lessons, currentLessonId parameters reserved for future use
  const router = useRouter();
  const { user, logout } = useAuth();
  const [profileData, setProfileData] = useState<any>(null);
  const [isOpen, setIsOpen] = useState(false); // Mobile menu state
  const [isCollapsed, setIsCollapsed] = useState(false); // Desktop collapse state
  // const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['main'])); // Reserved for future use

  // Role-based navigation items
  // Student navigation
  const studentNavItems = [
    { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
    { href: '/courses', label: 'My Courses', icon: CoursesIcon },
    { href: '/progress', label: 'Progress', icon: ProgressIcon },
    { href: '/student-dashboard', label: 'Trading Dashboard', icon: CoursesIcon },
    { href: '/ai-assistant', label: 'AI Assistant', icon: AIAssistantIcon },
    { href: '/leaderboard', label: 'Leaderboard', icon: AnalyticsIcon },
    { href: '/certificates', label: 'Certificates', icon: CertificatesIcon },
    { href: '/community', label: 'Community', icon: CommunityIcon },
    { href: '/consultations', label: 'Expert Consultation', icon: ConsultationIcon },
    { href: '/profile', label: 'Profile', icon: ProfileIcon },
  ];

  // Instructor navigation
  // Lessons & Quizzes removed from sidebar - they remain in Dashboard only
  // Dashboard and Course Management are separate navigation items
  // Course Management uses section parameter to focus on course management area
  const instructorNavItems = [
    { href: '/instructor/dashboard', label: 'Dashboard', icon: DashboardIcon },
    { href: '/instructor/dashboard?section=courses', label: 'Course Management', icon: CoursesIcon },
    { href: '/instructor/demo-tasks', label: 'Demo Tasks', icon: CoursesIcon },
    { href: '/progress', label: 'Progress', icon: ProgressIcon },
    { href: '/certificates', label: 'Certificates', icon: CertificatesIcon },
    { href: '/community', label: 'Community', icon: CommunityIcon },
    { href: '/consultations/expert', label: 'Expert Consultation', icon: ConsultationIcon },
    { href: '/profile', label: 'Profile', icon: ProfileIcon },
  ];

  // Admin navigation
  const adminNavItems = [
    { href: '/admin', label: 'Dashboard', icon: DashboardIcon },
    { href: '/admin', label: 'Users', icon: UsersIcon, tab: 'users' },
    { href: '/admin', label: 'Courses', icon: CoursesIcon, tab: 'courses' },
    { href: '/admin', label: 'Certificates', icon: CertificatesIcon, tab: 'certificates' },
    { href: '/admin', label: 'Analytics', icon: AnalyticsIcon, tab: 'analytics' },
    { href: '/community', label: 'Community', icon: CommunityIcon },
    { href: '/consultations/expert', label: 'Expert Consultation', icon: ConsultationIcon },
    { href: '/profile', label: 'Profile', icon: ProfileIcon },
  ];

  // Super Admin navigation (includes approvals)
  const superAdminNavItems = [
    { href: '/admin', label: 'Dashboard', icon: DashboardIcon },
    { href: '/admin', label: 'Pending Approvals', icon: ApprovalsIcon, tab: 'approvals' },
    { href: '/admin', label: 'Users', icon: UsersIcon, tab: 'users' },
    { href: '/admin', label: 'Courses', icon: CoursesIcon, tab: 'courses' },
    { href: '/admin', label: 'Certificates', icon: CertificatesIcon, tab: 'certificates' },
    { href: '/admin', label: 'Analytics', icon: AnalyticsIcon, tab: 'analytics' },
    { href: '/community', label: 'Community', icon: CommunityIcon },
    { href: '/consultations/expert', label: 'Expert Consultation', icon: ConsultationIcon },
    { href: '/consultations/admin', label: 'Consultation Admin', icon: ConsultationIcon },
    { href: '/profile', label: 'Profile', icon: ProfileIcon },
  ];

  // Get navigation items based on user role
  const getNavItems = () => {
    if (!user) return [];
    if (user.role === 'superadmin') return superAdminNavItems;
    if (user.role === 'admin') return adminNavItems;
    if (user.role === 'instructor') return instructorNavItems;
    return studentNavItems; // Default to student
  };

  useEffect(() => {
    if (user) {
      loadProfileData();
    }
  }, [user]);

  // FIX: Refresh profile data periodically to update profile photo live
  useEffect(() => {
    if (user) {
      // Refresh profile data every 5 seconds to catch profile photo updates
      const interval = setInterval(() => {
        loadProfileData();
      }, 5000);
      
      // Also refresh when window gains focus (user returns to tab)
      const handleFocus = () => {
        loadProfileData();
      };
      window.addEventListener('focus', handleFocus);
      
      return () => {
        clearInterval(interval);
        window.removeEventListener('focus', handleFocus);
      };
    }
  }, [user]);

  // Close mobile menu when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [router.pathname]);

  // Auto-collapse on mobile by default
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadProfileData = async () => {
    try {
      const data = await apiClient.get('/auth/me');
      setProfileData(data);
    } catch (error) {
      console.error('Failed to load profile data:', error);
    }
  };

  // const toggleSection = (section: string) => { // Reserved for future use
  //   setExpandedSections((prev) => {
  //     const newSet = new Set(prev);
  //     if (newSet.has(section)) {
  //       newSet.delete(section);
  //     } else {
  //       newSet.add(section);
  //     }
  //     return newSet;
  //   });
  // };

  const navItems = getNavItems();
  const profilePhoto = profileData?.profilePhoto;
  const displayName = profileData?.studentDetails?.fullName || user?.name || 'User';
  const displayEmail = user?.email || '';
  // Use learningLevel if set, otherwise fall back to tradingLevel from onboarding
  const tradingLevel = profileData?.learningLevel || profileData?.studentDetails?.tradingLevel;

  // Check if a route is active (handles query params for admin tabs and instructor dashboard sections)
  const isActiveRoute = (href: string, tab?: string) => {
    if (router.pathname === href) {
      // For admin page, check if tab matches
      if (href === '/admin' && tab) {
        return router.query.tab === tab;
      }
      // For admin page without tab, check if no tab is active (default tab)
      if (href === '/admin' && !tab && !router.query.tab) {
        return true;
      }
      // For instructor dashboard, section parameter is handled in the map function below
      // This function just checks pathname match
      if (href !== '/admin') {
        return true;
      }
    }
    return router.pathname.startsWith(href + '/') && href !== '/admin';
  };

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-[3.5rem] left-2 sm:left-4 z-50 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        aria-label="Toggle sidebar"
      >
        {isOpen ? <CloseIcon className="w-5 h-5 sm:w-6 sm:h-6" /> : <MenuIcon className="w-5 h-5 sm:w-6 sm:h-6" />}
      </button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-40
          h-screen lg:h-auto lg:self-start
          w-64 sm:w-72 lg:w-72
          ${user?.role === 'student' ? 'bg-gradient-to-b from-indigo-600 via-purple-600 to-blue-700' : 'bg-white dark:bg-gray-800'}
          shadow-xl lg:shadow-md
          ${user?.role === 'student' ? 'border-r border-purple-500/30' : 'border-r border-gray-200 dark:border-gray-700'}
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${isCollapsed ? 'lg:w-20' : 'lg:w-72'}
          flex flex-col
          overflow-y-auto lg:overflow-visible
          lg:flex-shrink-0
        `}
      >
        {/* Sidebar Header */}
        <div className={`p-3 sm:p-4 lg:p-6 ${user?.role === 'student' ? 'border-b border-purple-500/30' : 'border-b border-gray-200 dark:border-gray-700'} flex-shrink-0`}>
          {/* Collapse Toggle (Desktop only) */}
          <div className="hidden lg:flex justify-end mb-4">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={`p-2 rounded-lg ${user?.role === 'student' ? 'text-white/80 hover:bg-white/10' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'} transition-colors`}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg
                className={`w-5 h-5 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Profile Section */}
          {user && (
            <Link
              href="/profile"
              className={`flex items-center space-x-2 sm:space-x-3 p-2 sm:p-3 rounded-xl transition-all group ${user?.role === 'student' ? 'hover:bg-white/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
            >
              <div className="relative flex-shrink-0">
                {/* FIX: Profile picture placeholder with live update - uses profilePhoto from profileData */}
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center ring-2 ${user?.role === 'student' ? 'ring-white/30 group-hover:ring-white/50' : 'ring-primary-200 dark:ring-primary-800 group-hover:ring-primary-400'} transition-all shadow-md`}>
                  {profilePhoto ? (
                    <img
                      src={profilePhoto}
                      alt={displayName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // FIX: Fallback to avatar initial if image fails to load
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          const fallback = document.createElement('span');
                          fallback.className = 'text-white text-base sm:text-lg font-bold';
                          fallback.textContent = displayName.charAt(0).toUpperCase();
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                  ) : (
                    <span className="text-white text-base sm:text-lg font-bold">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                {/* FIX: Live update indicator - green dot shows user is online */}
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-800 shadow-sm"></div>
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className={`text-xs sm:text-sm font-semibold truncate ${user?.role === 'student' ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
                    {displayName}
                  </p>
                  <p className={`text-xs truncate ${user?.role === 'student' ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                    {displayEmail}
                  </p>
                  {tradingLevel && (
                    <p className={`text-xs mt-1 capitalize font-medium ${user?.role === 'student' ? 'text-white/90' : 'text-primary-600 dark:text-primary-400'}`}>
                      {tradingLevel}
                    </p>
                  )}
                </div>
              )}
            </Link>
          )}
        </div>

        {/* Navigation */}
        <nav className={`p-3 sm:p-4 lg:p-6 ${user?.role === 'student' ? 'space-y-2 sm:space-y-3' : 'space-y-2'}`}>
          {navItems.map((item) => {
            const Icon = item.icon;
            // Extract base href (without query params) for route matching
            const baseHref = item.href.split('?')[0];
            // Check if this item has a section parameter
            const hasSection = item.href.includes('section=');
            const sectionParam = hasSection ? item.href.split('section=')[1]?.split('&')[0] : null;
            
            // Determine if this nav item is active
            let isActive = false;
            if (baseHref === '/instructor/dashboard') {
              // For instructor dashboard items
              if (hasSection && sectionParam === 'courses') {
                // Course Management is active when section=courses
                isActive = router.query.section === 'courses';
              } else if (!hasSection) {
                // Dashboard is active when no section parameter
                isActive = !router.query.section;
              }
            } else {
              // For other pages, use standard route matching
              isActive = isActiveRoute(baseHref, (item as any).tab);
            }
            
            const href = (item as any).tab ? `${baseHref}?tab=${(item as any).tab}` : item.href;
            
            // For students, use rectangular boxes with blue styling
            if (user?.role === 'student') {
              return (
                <Link
                  key={`${item.href}-${(item as any).tab || ''}`}
                  href={href}
                  className={`
                    flex items-center space-x-3 px-4 py-3 rounded-lg
                    transition-all duration-200
                    group shadow-md
                    ${isActive
                      ? 'bg-white/20 text-white shadow-lg scale-[1.02] backdrop-blur-sm'
                      : 'bg-white/10 text-white hover:bg-white/15 hover:shadow-lg backdrop-blur-sm'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                  `}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0 text-white" />
                  {!isCollapsed && (
                    <span className={`font-medium ${isActive ? 'font-semibold' : ''}`}>
                      {item.label}
                    </span>
                  )}
                  {isActive && !isCollapsed && (
                    <div className="ml-auto w-2 h-2 bg-white rounded-full"></div>
                  )}
                </Link>
              );
            }
            
            // For other roles, use original styling
            return (
              <Link
                key={`${item.href}-${(item as any).tab || ''}`}
                href={href}
                className={`
                  flex items-center space-x-3 px-4 py-3 rounded-xl
                  transition-all duration-200
                  group
                  ${isActive
                    ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 scale-[1.02]'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-primary-600 dark:hover:text-primary-400'
                  }
                  ${isCollapsed ? 'justify-center' : ''}
                `}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : 'text-current'}`} />
                {!isCollapsed && (
                  <span className={`font-medium ${isActive ? 'font-semibold' : ''}`}>
                    {item.label}
                  </span>
                )}
                {isActive && !isCollapsed && (
                  <div className="ml-auto w-2 h-2 bg-white rounded-full"></div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer with Logout Button */}
        <div className={`${user?.role === 'student' ? 'border-t border-purple-500/30' : 'border-t border-gray-200 dark:border-gray-700'} flex-shrink-0`}>
          {!isCollapsed ? (
            <div className="p-3 sm:p-4 lg:p-6">
              <p className={`text-xs text-center mb-3 ${user?.role === 'student' ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                ForexOrbit Academy
              </p>
              {/* Logout Button */}
              <button
                onClick={() => {
                  logout();
                  router.push('/login');
                }}
                className={`w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg transition-all duration-200 ${
                  user?.role === 'student'
                    ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                    : 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="font-medium text-sm">Logout</span>
              </button>
            </div>
          ) : (
            /* Collapsed Logout Button */
            <div className="p-2 flex justify-center">
              <button
                onClick={() => {
                  logout();
                  router.push('/login');
                }}
                className={`p-2 rounded-lg transition-all duration-200 ${
                  user?.role === 'student'
                    ? 'text-white/80 hover:bg-white/10'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="Logout"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
