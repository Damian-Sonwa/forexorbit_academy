import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { formatDistanceToNow } from 'date-fns';
import { MessageCircle, Search } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import { useAuth } from '@/hooks/useAuth';
import { COMMUNITY_CATEGORIES, communityReturnPath } from '@/lib/community-qa';
import { CommunityLink, CommunityShell } from '@/components/community/CommunityShell';
import { VoteControl } from '@/components/community/VoteControl';

type QuestionItem = {
  id: string;
  title: string;
  preview: string;
  categoryLabel: string;
  author: { name: string; photo: string | null };
  replyCount: number;
  score: number;
  answered: boolean;
  createdAt: string;
  lastActivityAt: string;
  viewerVote: number;
};

const VIEWS = [
  { id: 'all', label: 'All questions' },
  { id: 'unanswered', label: 'Unanswered' },
  { id: 'popular', label: 'Popular' },
  { id: 'activity', label: 'My activity' },
] as const;

const SORTS = [
  { id: 'activity', label: 'Latest activity' },
  { id: 'newest', label: 'Newest' },
  { id: 'votes', label: 'Most upvoted' },
  { id: 'replies', label: 'Most discussed' },
];

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNow(date, { addSuffix: true });
}

export default function CommunityPage() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const view = one(router.query.view) || 'all';
  const sort = one(router.query.sort) || (view === 'popular' ? 'votes' : 'activity');
  const category = one(router.query.category);
  const q = one(router.query.q);
  const page = Math.max(1, Number(one(router.query.page)) || 1);
  const [search, setSearch] = useState(q);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [votingId, setVotingId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSearch(q);
  }, [q]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (view !== 'all') params.set('view', view);
    if (sort) params.set('sort', sort);
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    params.set('page', String(page));
    apiClient.get<{ questions: QuestionItem[]; hasMore: boolean }>(`/community/questions?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setQuestions(Array.isArray(data.questions) ? data.questions : []);
        setHasMore(data.hasMore === true);
      })
      .catch((reason) => {
        if (!cancelled) setError(messageFromUnknown(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, view, sort, category, q, page, reloadKey]);

  function pushQuery(next: { view?: string; sort?: string; category?: string; q?: string; page?: string }) {
    const merged = { view, sort, category, q, page: '1', ...next };
    const query: Record<string, string> = {};
    if (merged.view && merged.view !== 'all') query.view = merged.view;
    if (merged.sort && merged.sort !== 'activity') query.sort = merged.sort;
    if (merged.category) query.category = merged.category;
    if (merged.q) query.q = merged.q;
    if (merged.page && merged.page !== '1') query.page = merged.page;
    router.push({ pathname: '/community', query });
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    pushQuery({ q: search.trim(), page: '1' });
  }

  async function vote(item: QuestionItem, value: 1 | -1) {
    const previous = questions;
    const nextVote = item.viewerVote === value ? 0 : value;
    const delta = nextVote - item.viewerVote;
    setVotingId(item.id);
    setQuestions((current) => current.map((entry) => (
      entry.id === item.id ? { ...entry, viewerVote: nextVote, score: entry.score + delta } : entry
    )));
    try {
      const result = await apiClient.post<{ vote: number; score: number }>(`/community/questions/${item.id}/vote`, {
        target: 'question',
        value,
      });
      setQuestions((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, viewerVote: result.vote, score: result.score } : entry
      )));
    } catch (reason) {
      setQuestions(previous);
      setError(messageFromUnknown(reason));
    } finally {
      setVotingId('');
    }
  }

  const returnPath = communityReturnPath(router.asPath);
  const empty = q
    ? 'No discussions match that search.'
    : view === 'unanswered'
      ? 'Every current question has an accepted answer.'
      : view === 'activity'
        ? 'You have not asked or replied yet.'
        : 'No questions yet. Ask the first one.';

  return (
    <CommunityShell>
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        <aside className="mb-8 lg:mb-0">
          <label className="mb-2 block text-sm font-semibold text-[#525252] lg:hidden" htmlFor="community-category">Category</label>
          <select
            id="community-category"
            className="mb-4 w-full rounded-xl border border-[#e5e5e5] bg-[#ffffff] px-3 py-2 text-sm lg:hidden"
            value={category}
            onChange={(event) => pushQuery({ category: event.target.value })}
          >
            <option value="">All topics</option>
            {COMMUNITY_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <nav className="hidden lg:block" aria-label="Discussion topics">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">Topics</p>
            <ul className="mt-3 space-y-1">
              <li>
                <button type="button" className={`w-full rounded-lg px-3 py-2 text-left text-sm ${category === '' ? 'bg-[#fff4ea] font-semibold' : 'hover:bg-[#faf8f4]'}`} onClick={() => pushQuery({ category: '' })}>All topics</button>
              </li>
              {COMMUNITY_CATEGORIES.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`w-full rounded-lg px-3 py-2 text-left text-sm ${category === item.id ? 'bg-[#fff4ea] font-semibold' : 'hover:bg-[#faf8f4]'}`} onClick={() => pushQuery({ category: item.id })}>{item.label}</button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <section>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">Forex Orbit Community</h1>
              <p className="mt-2 max-w-xl text-base leading-relaxed text-[#525252]">Ask better questions. Share what you learn. Grow together.</p>
            </div>
            <CommunityLink href={`/community/ask?from=${encodeURIComponent(returnPath)}`}>Ask a question</CommunityLink>
          </div>

          <form className="mt-6 flex gap-2" onSubmit={onSearch}>
            <label className="sr-only" htmlFor="community-search">Search questions</label>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#737373]" aria-hidden />
              <input
                id="community-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search questions and discussions"
                className="w-full rounded-full border border-[#e5e5e5] bg-[#ffffff] py-2.5 pl-10 pr-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
              />
            </div>
            <button type="submit" className="rounded-full border border-[#e5e5e5] px-4 py-2 text-sm font-semibold">Search</button>
          </form>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Question filters">
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={view === item.id}
                  className={`rounded-full px-3 py-1.5 text-sm ${view === item.id ? 'bg-[#171717] text-[#ffffff]' : 'border border-[#e5e5e5] text-[#171717]'}`}
                  onClick={() => pushQuery({ view: item.id, sort: item.id === 'popular' ? 'votes' : sort })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-[#525252]">
              Sort
              <select
                aria-label="Sort questions"
                value={sort}
                onChange={(event) => pushQuery({ sort: event.target.value })}
                className="rounded-lg border border-[#e5e5e5] bg-[#ffffff] px-2 py-1.5 text-sm text-[#171717]"
              >
                {SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>

          {!authLoading && !isAuthenticated ? (
            <div className="mt-8 rounded-2xl border border-[#e5e5e5] px-6 py-12 text-center">
              <p className="text-lg font-semibold">Sign in to join the discussion.</p>
              <div className="mt-4"><CommunityLink href="/login">Sign in</CommunityLink></div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-2xl border border-[#e5e5e5] bg-[#fff4ea] px-4 py-3 text-sm" role="alert">
              <p>{error}</p>
              <button type="button" className="mt-2 font-semibold text-primary-700" onClick={() => setReloadKey((current) => current + 1)}>Try again</button>
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 space-y-3" aria-hidden>
              {[0, 1, 2].map((item) => <div key={item} className="h-28 motion-safe:animate-pulse rounded-2xl bg-[#f6f6f6]" />)}
            </div>
          ) : null}

          {!loading && isAuthenticated && questions.length === 0 && !error ? (
            <div className="mt-8 rounded-2xl border border-dashed border-[#e5e5e5] px-6 py-14 text-center">
              <MessageCircle className="mx-auto h-6 w-6 text-primary-600" aria-hidden />
              <p className="mt-3 text-lg font-semibold">{empty}</p>
            </div>
          ) : null}

          <ul className="mt-6 space-y-3">
            {questions.map((item) => (
              <li key={item.id} className="rounded-2xl border border-[#e5e5e5] bg-[#ffffff] p-4 shadow-[0_8px_20px_-18px_rgba(23,23,23,0.35)] sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-700">
                      <span>{item.categoryLabel}</span>
                      <span className="rounded-full border border-[#e5e5e5] px-2 py-0.5 normal-case tracking-normal text-[#525252]">
                        {item.answered ? 'Answered' : 'Unanswered'}
                      </span>
                    </div>
                    <h2 className="mt-2 font-display text-xl font-bold leading-snug">
                      <Link className="hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600" href={`/community/questions/${item.id}?from=${encodeURIComponent(returnPath)}`}>
                        {item.title}
                      </Link>
                    </h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#525252]">{item.preview}</p>
                    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#525252]">
                      {item.author.photo ? <img src={item.author.photo} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}
                      <span>{item.author.name} · {when(item.createdAt)}{item.lastActivityAt ? ` · Active ${when(item.lastActivityAt)}` : ''} · {item.replyCount} {item.replyCount === 1 ? 'reply' : 'replies'}</span>
                    </p>
                  </div>
                  <VoteControl score={item.score} vote={item.viewerVote} disabled={votingId === item.id} onVote={(value) => vote(item, value)} />
                </div>
              </li>
            ))}
          </ul>

          {!loading && (page > 1 || hasMore) ? (
            <div className="mt-6 flex items-center justify-between">
              <button type="button" className="rounded-full border border-[#e5e5e5] px-4 py-2 text-sm font-semibold disabled:opacity-40" disabled={page <= 1} onClick={() => pushQuery({ page: String(page - 1) })}>Previous</button>
              <span className="text-sm text-[#525252]">Page {page}</span>
              <button type="button" className="rounded-full border border-[#e5e5e5] px-4 py-2 text-sm font-semibold disabled:opacity-40" disabled={!hasMore} onClick={() => pushQuery({ page: String(page + 1) })}>Next</button>
            </div>
          ) : null}
        </section>
      </div>
    </CommunityShell>
  );
}
