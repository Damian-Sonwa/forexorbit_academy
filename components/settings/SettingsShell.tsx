/**
 * Frame for Settings: /profile (profile, learning, security, appearance) and /settings/communication
 * (notifications) share one header band and one section list, so they read as a single place. The
 * guard only shapes the experience; every API enforces the session and role on the server.
 */

import { useEffect, type ReactNode } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Bell, GraduationCap, ShieldCheck, SunMoon, UserRound } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import CandleMeter from '@/components/profile/CandleMeter';
import { useAuth } from '@/hooks/useAuth';
import { completeness } from '@/lib/student-profile';

export type SectionId = 'profile' | 'learning' | 'security' | 'notifications' | 'appearance';

const SECTIONS: Array<{ id: SectionId; label: string; href: string; icon: typeof Bell; studentOnly?: boolean }> = [
  { id: 'profile', label: 'Profile', href: '/profile', icon: UserRound },
  { id: 'learning', label: 'Learning', href: '/profile?section=learning', icon: GraduationCap, studentOnly: true },
  { id: 'security', label: 'Security', href: '/profile?section=security', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', href: '/settings/communication', icon: Bell },
  { id: 'appearance', label: 'Appearance', href: '/profile?section=appearance', icon: SunMoon },
];

const ROLE_LABEL: Record<string, string> = { student: 'Student', instructor: 'Instructor', admin: 'Admin', superadmin: 'Super admin' };

/** The section in the URL, limited to what this role has. */
export function sectionFrom(value: string | string[] | undefined, isStudent: boolean): SectionId {
  const found = SECTIONS.find((s) => s.id === value && s.id !== 'notifications' && (isStudent || !s.studentOnly));
  return found ? found.id : 'profile';
}

export default function SettingsShell({ section, onLeave, flagged = [], children }: {
  section: SectionId;
  /** Called before the link to another settings page is followed; return false to stay. */
  onLeave?: (href: string) => boolean;
  /** Sections with unsaved changes. */
  flagged?: SectionId[];
  children: ReactNode;
}) {
  const { user, isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  if (loading || !isAuthenticated || !user) return <LoadingSpinner message="Loading settings" fullScreen />;

  const isStudent = user.role === 'student';
  const items = SECTIONS.filter((s) => isStudent || !s.studentOnly);
  const name = user.studentDetails?.fullName || user.name || 'User';
  const { filled, total } = completeness(user);
  const active = items.find((s) => s.id === section);

  return (
    <div className="studio flex min-h-screen flex-col">
      <Head><title key="title">{`${active ? active.label : 'Settings'} settings | ForexOrbit Academy`}</title></Head>
      <Header />
      <div className="relative flex min-w-0 flex-1 lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full min-w-0 max-w-[72rem] flex-1 px-3 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-8">
          <header className="studio-night rounded-t-2xl px-4 py-5 sm:px-7 sm:py-6">
            <h1 className="font-display text-[1.625rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.875rem]">Settings</h1>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#ff7417] font-display text-lg font-semibold text-[#191919]">
                  {user.profilePhoto ? <img src={user.profilePhoto} alt="" className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{name}</span>
                  <span className="night-muted block truncate text-sm">{user.email}</span>
                </span>
              </div>
              <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm sm:gap-x-8">
                <div><dt className="night-muted text-[0.8125rem]">Account</dt><dd className="mt-0.5 font-semibold">{ROLE_LABEL[user.role] || user.role}</dd></div>
                {isStudent && user.learningLevel && <div><dt className="night-muted text-[0.8125rem]">Course level</dt><dd className="mt-0.5 font-semibold capitalize">{user.learningLevel}</dd></div>}
                {isStudent && (
                  <div>
                    <dt className="night-muted text-[0.8125rem]">Profile details</dt>
                    <dd className="mt-0.5 flex items-center gap-2.5 font-semibold num"><CandleMeter filled={filled} total={total} className="h-5 w-auto" />{filled} of {total}</dd>
                  </div>
                )}
              </dl>
            </div>
          </header>

          <div className="studio-sheet grid rounded-b-2xl border-t-0 md:grid-cols-[13.5rem_minmax(0,1fr)]">
            <nav aria-label="Settings sections" className="border-b border-[var(--st-frost-line)] bg-[var(--st-frost)] md:rounded-bl-2xl md:border-b-0 md:border-r">
              <ul className="flex justify-between overflow-x-auto px-1 md:sticky md:top-20 md:block md:space-y-0.5 md:overflow-visible md:p-3 md:pt-6">
                {items.map(({ id, label, href, icon: Icon }) => {
                  const current = id === section;
                  return (
                    <li key={id} className="shrink-0">
                      <Link
                        href={href}
                        shallow={href.startsWith('/profile') && router.pathname === '/profile'}
                        scroll={false}
                        aria-current={current ? 'page' : undefined}
                        onClick={(e) => { if (!current && onLeave && !onLeave(href)) e.preventDefault(); }}
                        className={`studio-nav min-h-[3.75rem] flex-col justify-center gap-1 border-b-2 px-1.5 text-[0.6875rem] sm:px-4 sm:text-[0.8125rem] md:min-h-[2.75rem] md:flex-row md:justify-start md:gap-3 md:rounded-lg md:border-b-0 md:px-3 md:text-[0.9375rem] ${current ? 'border-[#e0620f] md:bg-[var(--st-sheet)]' : 'border-transparent'}`}
                      >
                        <span className="studio-candle !hidden md:!block" aria-hidden />
                        <Icon className={`h-[18px] w-[18px] shrink-0 ${current ? 'text-[var(--st-accent)]' : ''}`} aria-hidden />
                        <span>{label}</span>
                        {flagged.includes(id) && <span className="absolute right-1 top-2 h-2 w-2 rounded-full bg-[#ff7417] md:static md:ml-auto"><span className="sr-only">Unsaved changes</span></span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="min-w-0 px-4 pb-4 pt-7 sm:px-8 sm:pt-8">{children}</div>
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
