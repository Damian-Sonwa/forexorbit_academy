import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import { useAuth } from '@/hooks/useAuth';
import { COMMUNITY_CATEGORIES, communityReturnPath } from '@/lib/community-qa';
import { CommunityShell } from '@/components/community/CommunityShell';

export default function AskQuestionPage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const back = communityReturnPath(typeof router.query.from === 'string' ? router.query.from : '/community');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('beginner');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await apiClient.post<{ id: string }>('/community/questions', { title, body, category });
      await router.replace(`/community/questions/${created.id}?from=${encodeURIComponent(back)}`);
    } catch (reason) {
      setError(messageFromUnknown(reason));
      setSubmitting(false);
    }
  }

  return (
    <CommunityShell>
      <Link href={back} className="text-sm font-semibold text-[#9A4E0C]">Back to community</Link>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">Ask a question</h1>
      <p className="mt-2 max-w-xl text-[#525252]">Explain what you have already tried. A specific question is easier for someone else to answer.</p>
      {!loading && !isAuthenticated ? (
        <p className="mt-8 text-sm">Sign in before asking a question. <Link className="font-semibold text-[#9A4E0C]" href="/login">Sign in</Link></p>
      ) : (
        <form className="mt-8 max-w-2xl space-y-5" onSubmit={onSubmit}>
          <label className="block text-sm font-semibold">
            Title
            <input
              required
              minLength={12}
              maxLength={140}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-base font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A4E0C]"
            />
          </label>
          <label className="block text-sm font-semibold">
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e5e5e5] bg-[#ffffff] px-3 py-2 text-base font-normal"
            >
              {COMMUNITY_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Details
            <textarea
              required
              minLength={20}
              maxLength={8000}
              rows={8}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 text-base font-normal leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A4E0C]"
            />
          </label>
          {error ? <p className="text-sm text-[#9A4E0C]" role="alert">{error}</p> : null}
          <button type="submit" disabled={submitting} className="rounded-full bg-[#F28C28] px-5 py-2.5 text-sm font-semibold text-[#102017] disabled:opacity-60">
            {submitting ? 'Posting question…' : 'Post question'}
          </button>
        </form>
      )}
    </CommunityShell>
  );
}
