import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { formatDistanceToNow } from 'date-fns';
import { Check } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';
import { useAuth } from '@/hooks/useAuth';
import { COMMUNITY_CATEGORIES, communityReturnPath } from '@/lib/community-qa';
import { CommunityShell } from '@/components/community/CommunityShell';
import { VoteControl } from '@/components/community/VoteControl';

type Author = { id: string; name: string; photo: string | null };
type Question = {
  id: string;
  title: string;
  body: string;
  category: string;
  categoryLabel: string;
  author: Author;
  authorStats: { questions: number; replies: number; helpful: number };
  score: number;
  viewerVote: number;
  answered: boolean;
  canEdit: boolean;
  canAccept: boolean;
  createdAt: string;
};
type Reply = {
  id: string;
  body: string;
  score: number;
  viewerVote: number;
  accepted: boolean;
  canEdit: boolean;
  createdAt: string;
  author: Author;
};

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNow(date, { addSuffix: true });
}

export default function DiscussionPage() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const back = communityReturnPath(typeof router.query.from === 'string' ? router.query.from : '/community');
  const [question, setQuestion] = useState<Question | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [replyPage, setReplyPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('beginner');
  const [questionDraft, setQuestionDraft] = useState('');
  const [editingReply, setEditingReply] = useState('');
  const [replyDraft, setReplyDraft] = useState('');

  async function load(page = 1) {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.get<{ question: Question; replies: Reply[]; hasMoreReplies: boolean }>(`/community/questions/${id}?replyPage=${page}`);
      setQuestion(data.question);
      setReplies(Array.isArray(data.replies) ? data.replies : []);
      setHasMore(data.hasMoreReplies === true);
      setReplyPage(page);
      setQuestionDraft(data.question.body);
      setTitleDraft(data.question.title);
      setCategoryDraft(data.question.category);
    } catch (reason) {
      setError(messageFromUnknown(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !isAuthenticated || !id) {
      if (!authLoading) setLoading(false);
      return;
    }
    load(1);
    // load is recreated each render; the id is the intended trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, id]);

  async function vote(target: 'question' | 'reply', targetId: string, value: 1 | -1) {
    if (!question) return;
    const previousQuestion = question;
    const previousReplies = replies;
    if (target === 'question') {
      const nextVote = question.viewerVote === value ? 0 : value;
      setQuestion({ ...question, viewerVote: nextVote, score: question.score + (nextVote - question.viewerVote) });
    } else {
      setReplies((current) => current.map((item) => {
        if (item.id !== targetId) return item;
        const nextVote = item.viewerVote === value ? 0 : value;
        return { ...item, viewerVote: nextVote, score: item.score + (nextVote - item.viewerVote) };
      }));
    }
    try {
      const result = await apiClient.post<{ vote: number; score: number }>(`/community/questions/${id}/vote`, {
        target,
        replyId: target === 'reply' ? targetId : undefined,
        value,
      });
      if (target === 'question') setQuestion((current) => current ? { ...current, viewerVote: result.vote, score: result.score } : current);
      else setReplies((current) => current.map((item) => item.id === targetId ? { ...item, viewerVote: result.vote, score: result.score } : item));
    } catch (reason) {
      setQuestion(previousQuestion);
      setReplies(previousReplies);
      setError(messageFromUnknown(reason));
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post(`/community/questions/${id}/replies`, { body: replyBody });
      setReplyBody('');
      setNotice('Reply posted.');
      await load(replyPage);
    } catch (reason) {
      setError(messageFromUnknown(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.put(`/community/questions/${id}`, { title: titleDraft, body: questionDraft, category: categoryDraft });
      setEditingQuestion(false);
      setNotice('Question updated.');
      await load(replyPage);
    } catch (reason) {
      setError(messageFromUnknown(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeQuestion() {
    if (!window.confirm('Delete this question?')) return;
    setSubmitting(true);
    try {
      await apiClient.delete(`/community/questions/${id}`);
      await router.push(back);
    } catch (reason) {
      setError(messageFromUnknown(reason));
      setSubmitting(false);
    }
  }

  async function saveReply(replyId: string) {
    setSubmitting(true);
    setError('');
    try {
      await apiClient.put(`/community/questions/${id}/replies/${replyId}`, { body: replyDraft });
      setEditingReply('');
      setNotice('Reply updated.');
      await load(replyPage);
    } catch (reason) {
      setError(messageFromUnknown(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeReply(replyId: string) {
    if (!window.confirm('Delete this reply?')) return;
    setSubmitting(true);
    try {
      await apiClient.delete(`/community/questions/${id}/replies/${replyId}`);
      setNotice('Reply removed.');
      await load(replyPage);
    } catch (reason) {
      setError(messageFromUnknown(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function accept(replyId: string | null) {
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post(`/community/questions/${id}/accept`, { replyId });
      setNotice(replyId ? 'Answer accepted.' : 'Accepted answer cleared.');
      await load(replyPage);
    } catch (reason) {
      setError(messageFromUnknown(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CommunityShell>
      <Link href={back} className="text-sm font-semibold text-primary-700">Back to community</Link>
      {loading ? <div className="mt-6 h-40 motion-safe:animate-pulse rounded-2xl bg-[#f6f6f6]" aria-hidden /> : null}
      {error ? <p className="mt-4 text-sm text-primary-700" role="alert">{error} <button type="button" className="font-semibold" onClick={() => load(replyPage)}>Try again</button></p> : null}
      {notice ? <p className="mt-4 text-sm font-semibold text-[#171717]" role="status">{notice}</p> : null}
      {!authLoading && !isAuthenticated ? <p className="mt-8">Sign in to read this discussion. <Link className="font-semibold text-primary-700" href="/login">Sign in</Link></p> : null}
      {question ? (
        <article className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">{question.categoryLabel}</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{question.title}</h1>
            <VoteControl score={question.score} vote={question.viewerVote} disabled={submitting} onVote={(value) => vote('question', question.id, value)} />
          </div>
          <p className="mt-3 flex items-center gap-2 text-sm text-[#525252]">
            {question.author.photo ? <img src={question.author.photo} alt="" className="h-8 w-8 rounded-full object-cover" /> : null}
            <span>{question.author.name} · {when(question.createdAt)} · {question.answered ? 'Answered' : 'Unanswered'}</span>
          </p>
          <p className="mt-1 text-xs text-[#525252]">
            {question.authorStats.questions} questions · {question.authorStats.replies} replies · {question.authorStats.helpful} helpful votes
          </p>
          {editingQuestion ? (
            <form className="mt-5 space-y-3" onSubmit={saveQuestion}>
              <label className="block text-sm font-semibold" htmlFor="question-title">Title
                <input id="question-title" className="mt-2 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 font-normal" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
              </label>
              <label className="block text-sm font-semibold" htmlFor="question-category">Category
                <select id="question-category" className="mt-2 w-full rounded-xl border border-[#e5e5e5] bg-[#ffffff] px-3 py-2 font-normal" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)}>
                  {COMMUNITY_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold" htmlFor="question-body">Question details
                <textarea id="question-body" className="mt-2 w-full rounded-xl border border-[#e5e5e5] px-3 py-2 font-normal" rows={6} value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} />
              </label>
              <div className="mt-3 flex gap-2">
                <button type="submit" disabled={submitting} className="rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-neutral-950">Save</button>
                <button type="button" className="rounded-full border border-[#e5e5e5] px-4 py-2 text-sm" onClick={() => setEditingQuestion(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <p className="mt-5 whitespace-pre-wrap text-base leading-relaxed">{question.body}</p>
          )}
          {question.canEdit ? (
            <div className="mt-4 flex gap-3 text-sm">
              <button type="button" className="font-semibold text-primary-700" onClick={() => setEditingQuestion(true)}>Edit question</button>
              <button type="button" className="font-semibold text-[#525252]" onClick={removeQuestion}>Delete question</button>
            </div>
          ) : null}

          <h2 className="mt-10 font-display text-2xl font-bold">Replies</h2>
          {replies.length === 0 ? <p className="mt-3 text-sm text-[#525252]">No replies yet. Be the first to answer.</p> : null}
          <ul className="mt-4 space-y-4">
            {replies.map((reply) => (
              <li key={reply.id} className={`rounded-2xl border p-4 ${reply.accepted ? 'border-primary-600 bg-[#fff8f1]' : 'border-[#e5e5e5] bg-[#ffffff]'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    {reply.accepted ? (
                      <p className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-primary-700">
                        <Check className="h-4 w-4" aria-hidden />
                        Accepted answer
                      </p>
                    ) : null}
                    <p className="text-sm text-[#525252]">{reply.author.name} · {when(reply.createdAt)}</p>
                    {editingReply === reply.id ? (
                      <div className="mt-3">
                        <label className="sr-only" htmlFor={`reply-${reply.id}`}>Reply text</label>
                        <textarea id={`reply-${reply.id}`} className="w-full rounded-xl border border-[#e5e5e5] px-3 py-2" rows={4} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} />
                        <div className="mt-2 flex gap-2">
                          <button type="button" className="rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-neutral-950" onClick={() => saveReply(reply.id)}>Save reply</button>
                          <button type="button" className="text-sm" onClick={() => setEditingReply('')}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap leading-relaxed">{reply.body}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-3 text-sm">
                      {question.canAccept ? (
                        <button type="button" className="font-semibold text-primary-700" onClick={() => accept(reply.accepted ? null : reply.id)}>
                          {reply.accepted ? 'Clear accepted answer' : 'Accept answer'}
                        </button>
                      ) : null}
                      {reply.canEdit ? (
                        <>
                          <button type="button" className="font-semibold" onClick={() => { setEditingReply(reply.id); setReplyDraft(reply.body); }}>Edit</button>
                          <button type="button" className="font-semibold text-[#525252]" onClick={() => removeReply(reply.id)}>Delete</button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <VoteControl score={reply.score} vote={reply.viewerVote} disabled={submitting} onVote={(value) => vote('reply', reply.id, value)} />
                </div>
              </li>
            ))}
          </ul>
          {hasMore || replyPage > 1 ? (
            <div className="mt-4 flex gap-3">
              <button type="button" className="text-sm font-semibold text-primary-700 disabled:opacity-40" disabled={replyPage <= 1} onClick={() => load(replyPage - 1)}>Previous replies</button>
              <button type="button" className="text-sm font-semibold text-primary-700 disabled:opacity-40" disabled={!hasMore} onClick={() => load(replyPage + 1)}>Next replies</button>
            </div>
          ) : null}

          <form className="mt-8" onSubmit={sendReply}>
            <label className="block text-sm font-semibold" htmlFor="new-reply">Your reply</label>
            <textarea
              id="new-reply"
              required
              minLength={2}
              maxLength={5000}
              rows={5}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e5e5e5] px-3 py-2"
            />
            <button type="submit" disabled={submitting} className="mt-3 rounded-full bg-primary-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 disabled:opacity-60">
              {submitting ? 'Posting reply…' : 'Post reply'}
            </button>
          </form>
        </article>
      ) : null}
    </CommunityShell>
  );
}
