/**
 * Instructor portal frame (Phase 12): the app header and sidebar, the teaching-area navigation and
 * the page heading. The route guard here is only for the experience (redirecting students and
 * signed-out visitors); every portal API enforces the role, the account status and the course
 * scope on the server.
 */

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';

export const PORTAL_NAV: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: '/instructor/overview', label: 'Overview', match: (p) => p === '/instructor/overview' },
  { href: '/instructor/dashboard?section=courses', label: 'Courses', match: (p) => p === '/instructor/dashboard' || p.startsWith('/instructor/courses') || p === '/instructor/lessons' || p === '/instructor/quizzes' },
  { href: '/instructor/students', label: 'Students', match: (p) => p.startsWith('/instructor/students') },
  { href: '/instructor/grading', label: 'Grading', match: (p) => p === '/instructor/grading' || p.startsWith('/instructor/assignments') },
  { href: '/instructor/activity', label: 'Activity', match: (p) => p === '/instructor/activity' },
  { href: '/instructor/profile', label: 'Profile', match: (p) => p === '/instructor/profile' },
];

const STAFF = new Set(['instructor', 'admin', 'superadmin']);

export function PortalNav({ pathname, badges = {} }: { pathname: string; badges?: Record<string, number> }) {
  return (
    <nav aria-label="Teaching areas" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {PORTAL_NAV.map((item) => {
          const active = item.match(pathname);
          const badge = badges[item.label];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors ${active ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}
              >
                {item.label}
                {typeof badge === 'number' && badge > 0 && <span className="rounded-full bg-primary-500 px-1.5 text-2xs font-semibold text-neutral-950 num">{badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function PortalShell({ title, lede, actions, badges, children }: { title: string; lede?: string; actions?: ReactNode; badges?: Record<string, number>; children: ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) router.replace('/login');
    else if (user && !STAFF.has(user.role)) router.replace('/dashboard');
  }, [loading, isAuthenticated, user, router]);

  if (loading || !isAuthenticated || !user || !STAFF.has(user.role)) {
    return <LoadingSpinner message="Checking your session" fullScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="page-kicker">Teaching</p>
              <h1 className="page-title mt-3">{title}</h1>
              {lede && <p className="page-lede">{lede}</p>}
            </div>
            {actions}
          </div>
          <div className="mb-8"><PortalNav pathname={router.pathname} badges={badges} /></div>
          {children}
        </main>
      </div>
      <Footer />
    </div>
  );
}
