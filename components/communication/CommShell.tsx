/**
 * Frame for the Phase 14 communication pages (notification centre, settings, announcements,
 * moderation, operations): header, sidebar, heading and an optional role guard. The guard only
 * shapes the experience; every API enforces the session, role and scope on the server.
 */

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';

export default function CommShell({ kicker = 'Communication', title, lede, actions, roles, children }: { kicker?: string; title: string; lede?: string; actions?: ReactNode; roles?: string[]; children: ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const allowed = Boolean(user && (!roles || roles.includes(user.role)));

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) router.replace('/login');
    else if (user && !allowed) router.replace('/dashboard');
  }, [loading, isAuthenticated, user, allowed, router]);

  if (loading || !isAuthenticated || !user || !allowed) return <LoadingSpinner message="Checking your session" fullScreen />;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <Header />
      <div className="relative flex min-w-0 flex-1 lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="page-kicker">{kicker}</p>
              <h1 className="page-title mt-3">{title}</h1>
              {lede && <p className="page-lede">{lede}</p>}
            </div>
            {actions}
          </div>
          {children}
        </main>
      </div>
      <Footer />
    </div>
  );
}

export function Tabs({ items, value, onChange, label, counts }: { items: Array<[string, string]>; value: string; onChange: (v: string) => void; label: string; counts?: Record<string, number> }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label={label}>
        {items.map(([id, text]) => (
          <button key={id || 'all'} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)} className={`min-h-[40px] rounded-lg px-3.5 text-sm font-medium ${value === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}>
            {text}{counts && typeof counts[id] === 'number' && counts[id] > 0 && <span className="ml-1.5 text-ink-subtle num">{counts[id]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export const errorText = (err: unknown, fallback: string) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
