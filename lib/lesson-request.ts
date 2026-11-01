/**
 * What a GET /api/lessons/:id answer means for the lesson page (Phase 7). Every outcome leads
 * to a state the student can act on: the lesson, the unlock offer, enroll first, not found, or a
 * retryable error. Only a 401 has no state of its own (the API client redirects to sign-in).
 */

export type LessonPaywallPayload = {
  access: false;
  locked: boolean;
  message: string;
  monetization?: unknown;
  lessonMeta?: { _id: string; courseId: string; title: string };
};

export type LessonOutcome<T> =
  | { kind: 'ok'; lesson: T }
  | { kind: 'locked'; payload: LessonPaywallPayload }
  | { kind: 'forbidden'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'error'; message: string; offline: boolean }
  | { kind: 'redirecting' };

export const LESSON_FORBIDDEN_MESSAGE = 'Enroll in this course to open its lessons.';
export const LESSON_NOT_FOUND_MESSAGE = 'This lesson does not exist or is no longer available.';
export const LESSON_OFFLINE_MESSAGE = 'You appear to be offline. The lesson will load again when your connection is back.';
export const LESSON_FAILED_MESSAGE = 'This lesson could not be loaded. Check your connection and try again.';

type Answer = { ok: boolean; status: number; data: unknown };

export function classifyLessonAnswer<T>(answer: Answer): LessonOutcome<T> {
  const { status, data } = answer;
  if (answer.ok && status === 200 && data && typeof data === 'object') return { kind: 'ok', lesson: data as T };
  if (status === 401) return { kind: 'redirecting' };
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (status === 403 && body.access === false && typeof body.message === 'string') {
    return {
      kind: 'locked',
      payload: {
        access: false,
        locked: body.locked === true,
        message: body.message,
        monetization: body.monetization,
        lessonMeta: body.lessonMeta as LessonPaywallPayload['lessonMeta'],
      },
    };
  }
  // The read rule (not enrolled, course not open to students, prerequisite) answers 403 with
  // `error`; it is not a failure the student can retry.
  if (status === 403) return { kind: 'forbidden', message: LESSON_FORBIDDEN_MESSAGE };
  if (status === 404 || status === 400) return { kind: 'not_found', message: LESSON_NOT_FOUND_MESSAGE };
  return { kind: 'error', message: LESSON_FAILED_MESSAGE, offline: false };
}

/** A request that got no HTTP answer at all (network down, DNS, aborted). */
export function classifyLessonFailure(online: boolean): LessonOutcome<never> {
  return online
    ? { kind: 'error', message: LESSON_FAILED_MESSAGE, offline: false }
    : { kind: 'error', message: LESSON_OFFLINE_MESSAGE, offline: true };
}

/**
 * Request sequencing: only the newest request may change state, so a slow answer for a lesson
 * the student already left (fast next/next, browser back) cannot replace the current one.
 */
export function createRequestSequence() {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isCurrent(id: number): boolean {
      return id === current;
    },
  };
}
