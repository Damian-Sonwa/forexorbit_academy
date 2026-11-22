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
import { isNavHrefDisabled } from '@/lib/config/features';

interface SidebarProps {
  courseId?: string;
  lessons?: Array<{ id: string; title: string; order: number }>;
  currentLessonId?: string;
}

// Icon Components (Heroicons-style SVG icons)
const DashboardIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const CoursesIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);

const ProgressIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const CertificatesIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
  </svg>
);

const PaymentsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h18M7 15h2m4 0h4M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
  </svg>
);

const ProfileIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);


const UsersIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const AnalyticsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const ApprovalsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// const LeaderboardIcon = ({ className }: { className?: string }) => ( // Reserved for future use
//   <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
//     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
//   </svg>
// );

const CommunityIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const ConsultationIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const AIAssistantIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const MenuIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// const ChevronDownIcon = ({ className }: { className?: string }) => ( // Reserved for future use
//   <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
//     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 9l-7 7-7-7" />
//   </svg>
// );

export default function Sidebar({ }: SidebarProps) {
  // courseId, lessons, currentLessonId parameters reserved for future use
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false); // Mobile menu state
  const [isCollapsed, setIsCollapsed] = useState(false); // Desktop collapse state
  // const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['main'])); // Reserved for future use

  // Role-based navigation items
  // Student navigation
  const studentNavItems = [
    { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon, group: 'Learn' },
    { href: '/courses', label: 'My Courses', icon: CoursesIcon, group: 'Learn' },
    { href: '/progress', label: 'Progress', icon: ProgressIcon, group: 'Learn' },
    { href: '/student-dashboard', label: 'Practice desk', icon: CoursesIcon, group: 'Practice' },
    { href: '/ai-assistant', label: 'AI Assistant', icon: AIAssistantIcon, group: 'Practice' },
    { href: '/leaderboard', label: 'Leaderboard', icon: AnalyticsIcon, group: 'Community' },
    { href: '/certificates', label: 'Certificates', icon: CertificatesIcon, group: 'Community' },
    { href: '/community', label: 'Community', icon: CommunityIcon, group: 'Community' },
    { href: '/announcements', label: 'Announcements', icon: CommunityIcon, group: 'Community' },
    { href: '/consultations', label: 'Expert Consultation', icon: ConsultationIcon, group: 'Community' },
    { href: '/payments', label: 'Payments', icon: PaymentsIcon, group: 'Account' },
    { href: '/profile', label: 'Profile', icon: ProfileIcon, group: 'Account' },
    { href: '/settings/communication', label: 'Notification settings', icon: ProfileIcon, group: 'Account' },
  ];

  // Instructor navigation
  // Lessons & Quizzes removed from sidebar - they remain in Dashboard only
  // Dashboard and Course Management are separate navigation items
  // Course Management uses section parameter to focus on course management area
  // Phase 12: the teaching portal (overview, students, grading, activity) is listed here too.
  const instructorNavItems = [
    { href: '/instructor/overview', label: 'Teaching overview', icon: AnalyticsIcon },
    { href: '/instructor/dashboard', label: 'Dashboard', icon: DashboardIcon },
    { href: '/instructor/dashboard?section=courses', label: 'Course Management', icon: CoursesIcon },
    { href: '/instructor/students', label: 'Students', icon: UsersIcon },
    { href: '/instructor/grading', label: 'Grading', icon: ApprovalsIcon },
    { href: '/instructor/activity', label: 'Teaching activity', icon: ProgressIcon },
    { href: '/instructor/practical-tasks', label: 'Practical tasks', icon: CoursesIcon },
    { href: '/instructor/demo-tasks', label: 'Demo Tasks', icon: CoursesIcon },
    { href: '/announcements', label: 'Announcements', icon: CommunityIcon },
    { href: '/community/moderation', label: 'Moderation', icon: ApprovalsIcon },
    { href: '/progress', label: 'Progress', icon: ProgressIcon },
    { href: '/certificates', label: 'Certificates', icon: CertificatesIcon },
    { href: '/community', label: 'Community', icon: CommunityIcon },
    { href: '/consultations/expert', label: 'Consultation availability', icon: ConsultationIcon },
    { href: '/profile', label: 'Profile', icon: ProfileIcon },
  ];

  // Admin navigation
  // Phase 13: the platform operations portal (overview, users, courses, enrollments, reports).
  const adminNavItems = [
    { href: '/admin/overview', label: 'Platform operations', icon: AnalyticsIcon },
    { href: '/admin', label: 'Dashboard', icon: DashboardIcon },
    { href: '/admin', label: 'Users', icon: UsersIcon, tab: 'users' },
    { href: '/admin', label: 'Courses', icon: CoursesIcon, tab: 'courses' },
    { href: '/admin', label: 'Certificates', icon: CertificatesIcon, tab: 'certificates' },
    { href: '/admin', label: 'Analytics', icon: AnalyticsIcon, tab: 'analytics' },
    { href: '/admin', label: 'Instructors', icon: UsersIcon, tab: 'instructors' },
    { href: '/admin', label: 'Upcoming classes', icon: ProgressIcon, tab: 'classes' },
    { href: '/admin', label: 'Consultation requests', icon: ConsultationIcon, tab: 'consultations' },
    { href: '/community', label: 'Community', icon: CommunityIcon },
    { href: '/announcements', label: 'Announcements', icon: CommunityIcon },
    { href: '/community/moderation', label: 'Moderation', icon: ApprovalsIcon },
    { href: '/admin/communication', label: 'Communication ops', icon: AnalyticsIcon },
    { href: '/consultations/expert', label: 'Consultation availability', icon: ConsultationIcon },
    { href: '/profile', label: 'Profile', icon: ProfileIcon },
  ];

  // Super Admin navigation (includes approvals)
  const superAdminNavItems = [
    { href: '/admin/overview', label: 'Platform operations', icon: AnalyticsIcon },
    { href: '/admin', label: 'Dashboard', icon: DashboardIcon },
    { href: '/admin', label: 'Pending Approvals', icon: ApprovalsIcon, tab: 'approvals' },
    { href: '/admin', label: 'Users', icon: UsersIcon, tab: 'users' },
    { href: '/admin', label: 'Courses', icon: CoursesIcon, tab: 'courses' },
    { href: '/admin', label: 'Certificates', icon: CertificatesIcon, tab: 'certificates' },
    { href: '/admin', label: 'Analytics', icon: AnalyticsIcon, tab: 'analytics' },
    { href: '/admin', label: 'Instructors', icon: UsersIcon, tab: 'instructors' },
    { href: '/admin', label: 'Upcoming classes', icon: ProgressIcon, tab: 'classes' },
    { href: '/admin', label: 'Consultation requests', icon: ConsultationIcon, tab: 'consultations' },
    { href: '/admin/purchases', label: 'Course Purchases', icon: CertificatesIcon },
    { href: '/admin/course-access', label: 'Course Access', icon: UsersIcon },
    { href: '/community', label: 'Community', icon: CommunityIcon },
    { href: '/announcements', label: 'Announcements', icon: CommunityIcon },
    { href: '/community/moderation', label: 'Moderation', icon: ApprovalsIcon },
    { href: '/admin/communication', label: 'Communication ops', icon: AnalyticsIcon },
    { href: '/consultations/expert', label: 'Consultation availability', icon: ConsultationIcon },
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
  // Profile fields come from the shared auth context (one /auth/me read per session, refreshed
  // on tab focus and after profile changes) rather than a per-page fetch and 5-second polling.
  const profilePhoto = user?.profilePhoto;
  const displayName = user?.studentDetails?.fullName || user?.name || 'User';
  const displayEmail = user?.email || '';
  // Use learningLevel if set, otherwise fall back to tradingLevel from onboarding
  const tradingLevel = user?.learningLevel || user?.studentDetails?.tradingLevel;

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

  if (!user) return null;

  const signOut = () => {
    void logout();
    router.push('/login');
  };

  return (
    <>
      {/* Mobile: drawer toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed left-3 top-[4.6rem] z-50 inline-flex items-center gap-2 rounded-full border border-line bg-[color-mix(in_srgb,var(--fo-surface-2)_92%,transparent)] py-1.5 pl-2.5 pr-3.5 text-sm font-semibold text-ink shadow-lift backdrop-blur-xl transition-colors hover:border-line-strong sm:left-4 lg:hidden"
        aria-label={isOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={isOpen}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-tint text-primary-600 dark:text-primary-400">
          {isOpen ? <CloseIcon className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
        </span>
        <span>Menu</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-40 animate-fade-in-fast glass-scrim lg:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`
          fixed left-0 top-0 z-40 flex h-[100dvh] flex-col
          w-[17.5rem] border-r border-line
          bg-[color-mix(in_srgb,var(--fo-shell)_96%,transparent)] backdrop-blur-xl
          transition-[transform,width] duration-300 ease-orbit
          lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:flex-shrink-0 lg:self-start lg:bg-transparent lg:backdrop-blur-0
          ${isOpen ? 'translate-x-0 shadow-lift' : '-translate-x-full lg:translate-x-0'}
          ${isCollapsed ? 'lg:w-[4.75rem]' : 'lg:w-[17.5rem]'}
        `}
        aria-label="Main navigation"
      >
        {/* Profile and collapse */}
        <div className={`flex flex-shrink-0 items-center gap-2 border-b border-line px-3 pb-4 pt-5 ${isCollapsed ? 'lg:flex-col lg:px-2' : ''}`}>
          <Link
            href="/profile"
            className={`group flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-tint ${isCollapsed ? 'lg:justify-center lg:p-1' : ''}`}
            title={isCollapsed ? displayName : undefined}
          >
            <span className="flex-shrink-0 rounded-full bg-[conic-gradient(from_200deg,#ff7012,#ffab6b,#c24e00,#ff7012)] p-[1.5px]">
              <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary-500 ring-2 ring-[var(--fo-shell)]">
                {profilePhoto ? (
                  <img
                    src={profilePhoto}
                    alt={displayName}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      // Falls back to the initial if the photo fails to load.
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent) {
                        const fallback = document.createElement('span');
                        fallback.className = 'text-neutral-950 text-base font-bold';
                        fallback.textContent = displayName.charAt(0).toUpperCase();
                        parent.appendChild(fallback);
                      }
                    }}
                  />
                ) : (
                  <span className="text-base font-bold text-neutral-950">{displayName.charAt(0).toUpperCase()}</span>
                )}
              </span>
            </span>
            {!isCollapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{displayName}</span>
                <span className="block truncate text-xs text-ink-subtle">{displayEmail}</span>
                {tradingLevel && <span className="chip chip-brand mt-1.5">{tradingLevel}</span>}
              </span>
            )}
          </Link>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="icon-btn hidden h-8 w-8 flex-shrink-0 lg:inline-flex"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className={`h-4 w-4 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Navigation, along the orbit track */}
        <nav className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Sections">
          {!isCollapsed && <span aria-hidden className="pointer-events-none absolute bottom-6 left-[1.6rem] top-6 w-px bg-[linear-gradient(180deg,transparent,var(--fo-line-strong)_8%,var(--fo-line-strong)_92%,transparent)]" />}
          <ul className="relative space-y-0.5">
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const baseHref = item.href.split('?')[0];
              const hasSection = item.href.includes('section=');
              const sectionParam = hasSection ? item.href.split('section=')[1]?.split('&')[0] : null;

              let isActive = false;
              if (baseHref === '/instructor/dashboard') {
                if (hasSection && sectionParam === 'courses') {
                  isActive = router.query.section === 'courses';
                } else if (!hasSection) {
                  isActive = !router.query.section;
                }
              } else {
                isActive = isActiveRoute(baseHref, (item as any).tab);
              }

              const href = (item as any).tab ? `${baseHref}?tab=${(item as any).tab}` : item.href;
              const navDisabled = isNavHrefDisabled(item.href);
              const group = (item as { group?: string }).group;
              const previousGroup = index > 0 ? (navItems[index - 1] as { group?: string }).group : undefined;
              const key = `${item.href}-${(item as any).tab || ''}`;

              return (
                <li key={key}>
                  {!isCollapsed && group && group !== previousGroup && (
                    <p className={`relative pl-9 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-ink-subtle ${index === 0 ? 'pb-1.5 pt-0.5' : 'pb-1.5 pt-5'}`}>
                      {group}
                    </p>
                  )}
                  {navDisabled ? (
                    <div
                      className={`flex cursor-not-allowed select-none items-center gap-3 rounded-xl py-2 pl-[2.6rem] pr-3 text-sm text-ink-subtle opacity-60 ${isCollapsed ? 'lg:justify-center lg:pl-3' : ''}`}
                      aria-disabled
                      title={isCollapsed ? `${item.label} — Coming soon` : undefined}
                    >
                      <Icon className="h-[18px] w-[18px] flex-shrink-0" />
                      {!isCollapsed && (
                        <>
                          <span className="font-medium">{item.label}</span>
                          <span className="ml-auto rounded-full border border-line px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider">Soon</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <Link
                      href={href}
                      className={`group relative flex items-center gap-3 rounded-xl py-2 pl-[2.6rem] pr-3 text-sm transition-colors duration-200
                        ${isActive ? 'bg-tint font-semibold text-ink' : 'font-medium text-ink-muted hover:bg-[color-mix(in_srgb,var(--fo-text)_5%,transparent)] hover:text-ink'}
                        ${isCollapsed ? 'lg:justify-center lg:pl-3' : ''}`}
                      title={isCollapsed ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      {/* The node on the orbit track: lit for the current page. */}
                      {!isCollapsed && (
                        <span
                          aria-hidden
                          className={`absolute left-[0.95rem] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-all duration-300 ease-orbit
                            ${isActive ? 'scale-100 bg-primary-500 shadow-[0_0_0_3px_var(--fo-shell),0_0_10px_2px_rgba(255,112,18,0.65)]' : 'scale-75 bg-[var(--fo-line-strong)] shadow-[0_0_0_3px_var(--fo-shell)] group-hover:scale-90 group-hover:bg-primary-500/60'}`}
                        />
                      )}
                      <Icon className={`h-[18px] w-[18px] flex-shrink-0 transition-colors ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-current'}`} />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex-shrink-0 border-t border-line p-3">
          <button
            onClick={signOut}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300 ${isCollapsed ? 'lg:justify-center' : ''}`}
            title={isCollapsed ? 'Sign out' : undefined}
            aria-label="Sign out"
          >
            <svg className="h-[18px] w-[18px] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!isCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
