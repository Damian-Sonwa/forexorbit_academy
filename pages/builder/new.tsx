/**
 * Start a course (instructors, admins, Super Admin). Only a title is needed to create the draft;
 * everything else is filled in the builder and checked before review. Admins assign the
 * instructor (the server accepts only an active instructor account).
 */

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Header from '@/components/Header';
import { CATEGORIES } from '@/components/builder/CoursePanels';
import { useAuth } from '@/hooks/useAuth';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';
import type { UserList } from '@/lib/admin-portal';

export default function NewCoursePage() {
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const instructors = usePortalResource<UserList>(isAdmin ? '/admin/portal/users?role=instructor&status=active&limit=100' : null);
  const [form, setForm] = useState({ title: '', summary: '', category: '', difficulty: '', instructorId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) void router.replace('/login?next=/builder/new');
    else if (user && !['instructor', 'admin', 'superadmin'].includes(user.role)) void router.replace('/dashboard');
  }, [loading, isAuthenticated, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const created = await apiClient.post<{ id: string }>('/courses', { draftStart: true, title: form.title, summary: form.summary, category: form.category, difficulty: form.difficulty, ...(isAdmin ? { instructorId: form.instructorId } : {}) });
      void router.push(`/builder/${created.id}`);
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'The course could not be created.');
      setBusy(false);
    }
  };

  if (loading || !user) return null;
  return (
    <div className="min-h-screen bg-[var(--fo-bg)]">
      <Head><title>New course · Course builder</title></Head>
      <Header />
      <main className="mx-auto max-w-2xl px-4 pb-20 pt-10 sm:px-6">
        <Link href={isAdmin ? '/admin/courses' : '/instructor/dashboard?section=courses'} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Courses</Link>
        <p className="page-kicker mt-6">Course builder</p>
        <h1 className="page-title mt-2">Start a new course</h1>
        <p className="page-lede">Give it a working title. You will add modules, lessons and details in the builder; nothing is visible to students until it is published.</p>
        <form onSubmit={submit} className="mt-8 space-y-5" data-testid="new-course-form">
          <label className="block"><span className="label">Course title</span>
            <input className="input mt-1.5 w-full text-lg" required maxLength={200} autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Risk management for new traders" data-testid="new-course-title" />
          </label>
          <label className="block"><span className="label">Short description (optional)</span>
            <textarea className="input mt-1.5 min-h-[4rem] w-full" maxLength={300} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="label">Category (optional)</span>
              <select className="input mt-1.5 w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="">Decide later</option>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="block"><span className="label">Difficulty (optional)</span>
              <select className="input mt-1.5 w-full" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}><option value="">Decide later</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select>
            </label>
          </div>
          {isAdmin && (
            <label className="block"><span className="label">Instructor</span>
              <select className="input mt-1.5 w-full" required value={form.instructorId} onChange={(e) => setForm({ ...form, instructorId: e.target.value })} data-testid="new-course-instructor">
                <option value="">Choose the instructor who owns this course</option>
                {(instructors.data?.rows || []).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
              <span className="mt-1 block text-xs text-ink-subtle">The instructor can edit the course while it is a draft. You can reassign it later.</span>
            </label>
          )}
          {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !form.title.trim() || (isAdmin && !form.instructorId)} data-testid="create-course">{busy ? 'Creating…' : 'Create and open the builder'}</button>
        </form>
      </main>
    </div>
  );
}
