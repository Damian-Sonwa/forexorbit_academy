/**
 * Quiz Component
 * Displays quiz questions and handles submission
 *
 * Phase 9: the server owns attempts. This component only presents them:
 * - instructions and history come from GET /api/quizzes/:lessonId (no questions, no answers);
 * - questions arrive with an attempt started on the server (POST .../attempts), in the order the
 *   server froze for this attempt; a refresh resumes the same attempt;
 * - the countdown shows the server's deadline, corrected for this device's clock offset; when it
 *   reaches zero the answers on this page are submitted inside the server's grace period, and the
 *   server decides (it expires the attempt by itself if nothing arrives);
 * - each answer is saved as it is chosen (PUT), with a visible saved / not-saved state;
 * - submitting asks for confirmation, can be retried safely (idempotent), and shows a result only
 *   after the server has confirmed it;
 * - the answer key is shown only when the server includes it (the quiz's review policy).
 * Staff see a read-only preview with the answer key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';

type StaffQuestion = { id?: string; question: string; options: string[]; correctAnswer: number; points?: number; explanation?: string };
type QuizSummary = {
  questionCount: number;
  totalPoints: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  passingPercent: number | null;
  reviewPolicy: string;
  availableFrom: string | null;
  availableUntil: string | null;
};
type AttemptQuestion = { id: string; question: string; options: string[]; points: number };
type AttemptView = {
  id: string;
  number: number;
  status: 'in_progress' | 'submitted' | 'expired';
  startedAt: string;
  deadlineAt: string | null;
  serverNow: string;
  submittedAt: string | null;
  questions: AttemptQuestion[];
  answers: Record<string, number>;
  result?: { earned: number; available: number; percent: number; passed: boolean | null; correctCount: number; answeredCount?: number; total: number };
  reviewAvailable?: boolean;
  review?: { id: string; correctAnswer: number; correct: boolean; explanation: string }[];
};
type Overview = {
  quiz: QuizSummary;
  attemptsUsed: number;
  attemptsRemaining: number | null;
  canStart: boolean;
  unavailableReason: string | null;
  inProgressAttemptId: string | null;
  attempts: { id: string; number: number; status: string; submittedAt: string | null; result: { percent: number; earned: number; available: number; passed: boolean | null } | null; reviewAvailable: boolean }[];
};

interface QuizProps {
  lessonId: string;
  courseId: string;
  quiz: { questions?: StaffQuestion[]; summary?: QuizSummary };
}

const REVIEW_TEXT: Record<string, string> = {
  after_submission: 'Correct answers are shown after you submit.',
  after_pass: 'Correct answers are shown once you pass.',
  after_last_attempt: 'Correct answers are shown after your last attempt.',
  never: 'Correct answers are not shown for this quiz.',
};
const UNAVAILABLE_TEXT: Record<string, string> = {
  quiz_not_open: 'This quiz is not open yet.',
  quiz_closed: 'This quiz has closed.',
};

function errorMessage(err: unknown, fallback: string): string {
  const ax = err as { response?: { data?: { error?: string } } };
  if (!ax || !ax.response) return typeof navigator !== 'undefined' && navigator.onLine === false ? 'You are offline. Your answers are kept on this page; try again when you are back online.' : 'Could not reach the server. Try again.';
  return ax.response.data?.error || fallback;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function StaffPreview({ questions }: { questions: StaffQuestion[] }) {
  return (
    <div className="space-y-4" data-testid="quiz-staff-preview">
      <p className="text-sm text-gray-600 dark:text-gray-300">Preview with the answer key. Students take this quiz in server-timed attempts and never receive the key before review.</p>
      {questions.map((q, qi) => (
        <div key={q.id || qi} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-white">{qi + 1}. {q.question} <span className="text-xs font-normal text-gray-500">({q.points || 1} pt)</span></p>
          <ul className="mt-2 space-y-1 text-sm">
            {q.options.map((o, oi) => (
              <li key={oi} className={oi === q.correctAnswer ? 'font-semibold text-green-700' : 'text-gray-700 dark:text-gray-300'}>
                {oi === q.correctAnswer ? '✓ ' : '• '}{o}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function Quiz({ lessonId, quiz }: QuizProps) {
  if (Array.isArray(quiz?.questions) && quiz.questions.length && typeof quiz.questions[0]?.correctAnswer === 'number') {
    return <StaffPreview questions={quiz.questions} />;
  }
  return <StudentQuiz lessonId={lessonId} />;
}

function StudentQuiz({ lessonId }: { lessonId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState<'loading' | 'starting' | 'submitting' | null>('loading');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const submitting = useRef(false);
  const base = `/quizzes/${lessonId}`;

  const showAttempt = useCallback((view: AttemptView) => {
    // Server time minus device time when the answer arrived: a wrong device clock never moves the deadline.
    setClockOffset(new Date(view.serverNow).getTime() - Date.now());
    setAttempt(view);
    setAnswers(view.answers || {});
    setPending({});
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const data = await apiClient.get<Overview>(base);
      setOverview(data);
      setError(null);
      return data;
    } catch (err) {
      if (!isUnauthorizedError(err)) setError(errorMessage(err, 'This quiz could not be loaded.'));
      return null;
    }
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadOverview();
      if (!cancelled && data && data.inProgressAttemptId) {
        try {
          const res = await apiClient.get<{ attempt: AttemptView }>(`${base}/attempts/${data.inProgressAttemptId}`);
          if (!cancelled) showAttempt(res.attempt);
        } catch (err) {
          if (!cancelled) setError(errorMessage(err, 'Your attempt could not be loaded.'));
        }
      }
      if (!cancelled) setBusy(null);
    })();
    return () => { cancelled = true; };
  }, [base, loadOverview, showAttempt]);

  const inProgress = attempt?.status === 'in_progress';
  const deadline = attempt?.deadlineAt ? new Date(attempt.deadlineAt).getTime() : null;
  const remaining = deadline ? deadline - (now + clockOffset) : null;

  useEffect(() => {
    if (!inProgress || !deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [inProgress, deadline]);

  const refreshAttempt = useCallback(async () => {
    if (!attempt) return;
    try {
      const res = await apiClient.get<{ attempt: AttemptView }>(`${base}/attempts/${attempt.id}`);
      showAttempt(res.attempt);
      if (res.attempt.status !== 'in_progress') await loadOverview();
    } catch (err) {
      setError(errorMessage(err, 'Your attempt could not be loaded.'));
    }
  }, [attempt, base, loadOverview, showAttempt]);

  const saveOne = useCallback(async (questionId: string, value: number) => {
    if (!attempt) return;
    try {
      await apiClient.put(`${base}/attempts/${attempt.id}`, { questionId, answer: value });
      setPending((p) => {
        if (p[questionId] !== value) return p;
        const next = { ...p };
        delete next[questionId];
        return next;
      });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) await refreshAttempt();
      // Otherwise it stays pending: retried on the next change, when online, and sent with submit.
    }
  }, [attempt, base, refreshAttempt]);

  const choose = (questionId: string, value: number) => {
    if (!inProgress) return;
    setAnswers((a) => ({ ...a, [questionId]: value }));
    setPending((p) => ({ ...p, [questionId]: value }));
    void saveOne(questionId, value);
  };

  useEffect(() => {
    const retry = () => Object.entries(pending).forEach(([id, value]) => void saveOne(id, value));
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [pending, saveOne]);

  const start = async () => {
    setBusy('starting');
    setError(null);
    try {
      const res = await apiClient.post<{ attempt: AttemptView }>(`${base}/attempts`, {});
      setCurrent(0);
      showAttempt(res.attempt);
    } catch (err) {
      setError(errorMessage(err, 'The attempt could not be started.'));
      await loadOverview();
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!attempt || submitting.current) return;
    submitting.current = true;
    setBusy('submitting');
    setError(null);
    try {
      // Every answer chosen on this page, including any not yet confirmed as saved.
      const res = await apiClient.post<{ attempt: AttemptView; expired?: boolean }>(`${base}/attempts/${attempt.id}`, { answers });
      setConfirming(false);
      showAttempt(res.attempt);
      await loadOverview();
    } catch (err) {
      // Not confirmed by the server: say so. Retrying is safe (the server answers a repeat with the same result).
      setError(`Not submitted yet. ${errorMessage(err, 'Your answers could not be submitted.')}`);
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  };

  // Time is up on the clock: submit what is on this page while the grace period lasts. If that
  // cannot reach the server, ask again after the grace period: by then the server has decided.
  const timeUpHandled = useRef(false);
  useEffect(() => {
    if (inProgress && remaining !== null && remaining <= 0 && !timeUpHandled.current) {
      timeUpHandled.current = true;
      void submit();
    }
    if (!inProgress) timeUpHandled.current = false;
  });
  useEffect(() => {
    if (!inProgress || remaining === null || remaining > 0) return;
    const timer = window.setTimeout(() => void refreshAttempt(), 12000);
    return () => window.clearTimeout(timer);
  }, [inProgress, remaining !== null && remaining <= 0, refreshAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const unanswered = useMemo(() => (attempt ? attempt.questions.filter((q) => answers[q.id] === undefined).length : 0), [attempt, answers]);

  if (busy === 'loading') return <p className="text-sm text-gray-500" role="status">Loading quiz…</p>;
  if (!overview) {
    return (
      <div role="alert" className="text-sm text-gray-700">
        <p>{error || 'This quiz could not be loaded.'}</p>
        <button type="button" onClick={() => void loadOverview()} className="mt-2 font-semibold text-primary-600 hover:underline">Try again</button>
      </div>
    );
  }

  // ---- Attempt in progress
  if (attempt && inProgress) {
    const q = attempt.questions[current];
    const savedCount = Object.keys(answers).length - Object.keys(pending).length;
    return (
      <div className="space-y-4" data-testid="quiz-attempt">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-900/40">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Attempt {attempt.number} · Question {current + 1} of {attempt.questions.length}</span>
          {remaining !== null && (
            <span className={`font-mono text-sm font-bold ${remaining < 60000 ? 'text-red-700' : 'text-gray-900 dark:text-white'}`} role="timer" aria-live="off" data-testid="quiz-timer">
              Time left {formatClock(remaining)}
            </span>
          )}
          <span className="text-xs text-gray-600 dark:text-gray-300" data-testid="quiz-save-state" aria-live="polite">
            {Object.keys(pending).length ? `Saving… (${Object.keys(pending).length} not saved yet)` : `${savedCount} answer${savedCount === 1 ? '' : 's'} saved`}
          </span>
        </div>
        <nav aria-label="Questions" className="flex flex-wrap gap-2" data-testid="quiz-navigator">
          {attempt.questions.map((item, index) => {
            const answered = answers[item.id] !== undefined;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrent(index)}
                aria-current={index === current ? 'step' : undefined}
                aria-label={`Question ${index + 1}${answered ? ', answered' : ', not answered'}`}
                className={`h-11 w-11 rounded-lg text-sm font-semibold ${index === current ? 'ring-2 ring-primary-500 ' : ''}${answered ? 'bg-primary-600 text-white' : 'border border-dashed border-gray-400 bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
              >
                {index + 1}
              </button>
            );
          })}
        </nav>
        {remaining !== null && remaining <= 0 && <p className="text-sm font-semibold text-red-700" role="status" data-testid="quiz-time-up">Time is up. Submitting your answers…</p>}
        {q && (
          <fieldset className="rounded-xl border border-gray-200 p-4 sm:p-6 dark:border-gray-700">
            <legend className="px-1 text-base font-semibold text-gray-900 sm:text-lg dark:text-white">{q.question} <span className="text-xs font-normal text-gray-500">({q.points} pt)</span></legend>
            <div className="mt-3 space-y-3">
              {q.options.map((option, index) => (
                <label key={index} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${answers[q.id] === index ? 'border-primary-500 bg-primary-50 dark:bg-primary-400/10' : 'border-gray-200 hover:border-primary-300 dark:border-gray-700'}`}>
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === index} onChange={() => choose(q.id, index)} className="h-5 w-5" />
                  <span className="flex-1 break-words text-gray-800 dark:text-gray-100">{option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <button type="button" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)} className="min-h-[44px] flex-1 rounded-xl border-2 border-gray-300 px-4 text-sm font-medium disabled:opacity-40 sm:flex-none">Previous</button>
            <button type="button" disabled={current >= attempt.questions.length - 1} onClick={() => setCurrent((c) => c + 1)} className="min-h-[44px] flex-1 rounded-xl border-2 border-gray-300 px-4 text-sm font-medium disabled:opacity-40 sm:flex-none">Next</button>
          </div>
          <button type="button" onClick={() => setConfirming(true)} disabled={busy === 'submitting'} className="min-h-[44px] rounded-xl bg-green-600 px-5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60" data-testid="quiz-submit">
            Submit quiz
          </button>
        </div>
        {confirming && (
          <div role="dialog" aria-modal="true" aria-labelledby="quiz-confirm-title" className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/40" data-testid="quiz-confirm">
            <p id="quiz-confirm-title" className="font-semibold text-gray-900 dark:text-white">Submit this attempt?</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {unanswered ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} not answered and will score 0. ` : 'All questions are answered. '}
              {attempt.questions.length === unanswered ? 'An attempt with no answers does not complete this lesson. ' : ''}
              You cannot change your answers after submitting.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => void submit()} disabled={busy === 'submitting'} aria-busy={busy === 'submitting'} className="min-h-[44px] rounded-xl bg-green-600 px-5 text-sm font-semibold text-white disabled:opacity-60" data-testid="quiz-confirm-submit">
                {busy === 'submitting' ? 'Submitting…' : 'Yes, submit'}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy === 'submitting'} className="min-h-[44px] rounded-xl border-2 border-gray-300 px-5 text-sm font-medium">Keep working</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700" data-testid="quiz-error">{error}</p>}
      </div>
    );
  }

  // ---- Result of the attempt just finished or opened from history
  const finished = attempt && !inProgress ? attempt : null;
  const s = overview.quiz;
  return (
    <div className="space-y-5" data-testid="quiz-overview">
      {finished && finished.result && (
        <div className="rounded-2xl border-2 border-gray-200 p-5 dark:border-gray-700" data-testid="quiz-result">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Attempt {finished.number} {finished.status === 'expired' ? '· time ran out; answers saved in time were graded' : '· submitted'}
          </p>
          <p className="mt-1 text-4xl font-bold text-gray-900 dark:text-white">{finished.result.percent}%</p>
          <p className="text-sm text-gray-700 dark:text-gray-300">{finished.result.earned} of {finished.result.available} points · {finished.result.correctCount} of {finished.result.total} correct</p>
          {finished.result.passed !== null && (
            <p className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-semibold ${finished.result.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{finished.result.passed ? 'Passed' : 'Not passed'}</p>
          )}
          {finished.result.answeredCount === 0 && (
            <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="quiz-no-answers">No questions were answered, so this attempt does not complete the lesson.</p>
          )}
          {finished.review ? (
            <ol className="mt-4 space-y-3" data-testid="quiz-review">
              {finished.questions.map((question, index) => {
                const r = finished.review![index];
                const mine = finished.answers[question.id];
                return (
                  <li key={question.id} className={`rounded-xl border-2 p-3 ${r.correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                    <p className="font-semibold text-gray-900">{index + 1}. {question.question}</p>
                    <p className="mt-1 text-sm text-gray-700">Your answer: {mine === undefined ? 'not answered' : question.options[mine]}</p>
                    {!r.correct && <p className="text-sm text-green-800">Correct answer: {question.options[r.correctAnswer]}</p>}
                    {r.explanation && <p className="mt-1 text-sm text-gray-600">{r.explanation}</p>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{REVIEW_TEXT[s.reviewPolicy] || ''}</p>
          )}
        </div>
      )}
      <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-300" data-testid="quiz-instructions">
        <p>{s.questionCount} question{s.questionCount === 1 ? '' : 's'} · {s.totalPoints} point{s.totalPoints === 1 ? '' : 's'}{s.timeLimitMinutes ? ` · ${s.timeLimitMinutes} minute${s.timeLimitMinutes === 1 ? '' : 's'}, timed from when you start` : ' · no time limit'}</p>
        <p>{s.maxAttempts ? `${overview.attemptsRemaining} of ${s.maxAttempts} attempt${s.maxAttempts === 1 ? '' : 's'} left` : 'Unlimited attempts'}{s.passingPercent !== null ? ` · pass mark ${s.passingPercent}%` : ''}</p>
        <p>{REVIEW_TEXT[s.reviewPolicy] || ''}{s.availableUntil ? ` Closes ${new Date(s.availableUntil).toLocaleString()}.` : ''}</p>
        <p data-testid="quiz-leaderboard-note">Every attempt you finish, including retakes and attempts that run out of time, counts toward your quiz average on the leaderboard.</p>
      </div>
      {overview.unavailableReason && <p className="text-sm font-medium text-gray-700">{UNAVAILABLE_TEXT[overview.unavailableReason] || 'This quiz is not available.'}</p>}
      {!overview.canStart && !overview.unavailableReason && <p className="text-sm font-medium text-gray-700" data-testid="quiz-no-attempts">You have used all attempts for this quiz.</p>}
      {overview.canStart && (
        <button type="button" onClick={() => void start()} disabled={busy === 'starting'} className="min-h-[44px] w-full rounded-xl bg-primary-600 px-6 text-base font-semibold text-white hover:bg-primary-700 disabled:opacity-60 sm:w-auto" data-testid="quiz-start">
          {busy === 'starting' ? 'Starting…' : overview.inProgressAttemptId ? 'Resume attempt' : overview.attemptsUsed ? 'Start another attempt' : 'Start quiz'}
        </button>
      )}
      {overview.attempts.length > 0 && (
        <div data-testid="quiz-history">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Your attempts</p>
          <ul className="mt-2 divide-y divide-gray-200 text-sm dark:divide-gray-700">
            {overview.attempts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>Attempt {a.number} · {a.status === 'in_progress' ? 'in progress' : a.status === 'expired' ? 'time ran out' : 'submitted'}</span>
                <span className="flex items-center gap-3">
                  {a.result && <span className="font-semibold">{a.result.percent}%{a.result.passed === true ? ' · passed' : a.result.passed === false ? ' · not passed' : ''}</span>}
                  {a.status !== 'in_progress' && (
                    <button type="button" className="font-semibold text-primary-600 hover:underline" onClick={async () => {
                      try {
                        const res = await apiClient.get<{ attempt: AttemptView }>(`${base}/attempts/${a.id}`);
                        showAttempt(res.attempt);
                      } catch (err) {
                        setError(errorMessage(err, 'That attempt could not be loaded.'));
                      }
                    }}>
                      {a.reviewAvailable ? 'Review' : 'Details'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700" data-testid="quiz-error">{error}</p>}
    </div>
  );
}
