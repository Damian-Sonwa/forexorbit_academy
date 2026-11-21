/**
 * Admin portal frame (Phase 13): app header and sidebar, the operations navigation and the page
 * heading. Super Admin-only areas are listed only for the Super Admin; every API enforces the role
 * and the account status on the server regardless of what is shown here.
 */

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';

export type AdminNavItem = { href: string; label: string; superOnly?: boolean; match: (path: string) => boolean };

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin/overview', label: 'Overview', match: (p) => p === '/admin/overview' },
  { href: '/admin/users', label: 'Users', match: (p) => p.startsWith('/admin/users') },
  { href: '/admin/users?role=instructor', label: 'Instructors', match: () => false },
  { href: '/admin/courses', label: 'Courses', match: (p) => p === '/admin/courses' },
  { href: '/admin/enrollments', label: 'Enrollments', match: (p) => p === '/admin/enrollments' },
  { href: '/admin/payments', label: 'Payments', superOnly: true, match: (p) => p === '/admin/payments' || p === '/admin/purchases' },
  { href: '/admin/refunds', label: 'Refunds', superOnly: true, match: (p) => p === '/admin/refunds' },
  { href: '/admin/reconciliation', label: 'Reconciliation', superOnly: true, match: (p) => p === '/admin/reconciliation' },
  { href: '/admin/reports', label: 'Reports', match: (p) => p === '/admin/reports' },
  { href: '/admin/audit', label: 'Audit log', superOnly: true, match: (p) => p === '/admin/audit' },
  { href: '/admin/settings', label: 'Settings', match: (p) => p === '/admin/settings' },
];

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

export function AdminNav({ pathname, role }: { pathname: string; role: string }) {
  const items = ADMIN_NAV.filter((i) => !i.superOnly || role === 'superadmin');
  return (
    <nav aria-label="Platform operations" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {items.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? 'page' : undefined} className={`flex min-h-[40px] items-center rounded-lg px-3.5 text-sm font-medium transition-colors ${active ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function AdminShell({ title, lede, actions, superOnly = false, children }: { title: string; lede?: string; actions?: ReactNode; superOnly?: boolean; children: ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const allowed = Boolean(user && ADMIN_ROLES.has(user.role) && (!superOnly || user.role === 'superadmin'));

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) router.replace('/login');
    else if (user && !ADMIN_ROLES.has(user.role)) router.replace('/dashboard');
    else if (user && superOnly && user.role !== 'superadmin') router.replace('/admin/overview');
  }, [loading, isAuthenticated, user, router, superOnly]);

  if (loading || !isAuthenticated || !allowed || !user) return <LoadingSpinner message="Checking your session" fullScreen />;

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="page-kicker">{user.role === 'superadmin' ? 'Super Admin' : 'Admin'} · Platform operations</p>
              <h1 className="page-title mt-3">{title}</h1>
              {lede && <p className="page-lede">{lede}</p>}
            </div>
            {actions}
          </div>
          <div className="mb-8"><AdminNav pathname={router.pathname} role={user.role} /></div>
          {children}
        </main>
      </div>
      <Footer />
    </div>
  );
}
