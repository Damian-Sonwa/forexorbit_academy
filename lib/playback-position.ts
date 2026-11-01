/**
 * Video resume position (Phase 7). Kept in this browser's localStorage, per signed-in account and
 * lesson; it is never sent to the server and never counts as completion. Completing a lesson is
 * a separate, explicit action (POST /api/progress). Cross-device sync is Phase 8.
 */

export const PLAYBACK_KEY_PREFIX = 'fo-playback:v1:';
/** Positions saved at most this often while playing. */
export const SAVE_INTERVAL_MS = 5000;
/** Too close to the start to be worth resuming. */
export const MIN_RESUME_SECONDS = 5;
/** Within this many seconds of the end the video starts again from the beginning. */
export const END_MARGIN_SECONDS = 10;
/** Saved positions older than this are ignored. */
export const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function playbackKey(userId: string, lessonId: string): string | null {
  if (!userId || !lessonId) return null;
  return `${PLAYBACK_KEY_PREFIX}${userId}:${lessonId}`;
}

/** Where to resume, or null to start from the beginning. `duration` 0/NaN means unknown. */
export function resumePosition(saved: number | null, duration: number): number | null {
  if (saved == null || !Number.isFinite(saved) || saved < MIN_RESUME_SECONDS) return null;
  if (Number.isFinite(duration) && duration > 0 && saved >= duration - END_MARGIN_SECONDS) return null;
  return saved;
}

export function readPosition(storage: StorageLike | null | undefined, key: string | null, now = Date.now()): number | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: unknown; at?: unknown };
    const t = typeof parsed.t === 'number' ? parsed.t : NaN;
    const at = typeof parsed.at === 'number' ? parsed.at : NaN;
    if (!Number.isFinite(t) || t < 0 || !Number.isFinite(at) || now - at > MAX_AGE_MS) return null;
    return t;
  } catch {
    return null;
  }
}

export function writePosition(storage: StorageLike | null | undefined, key: string | null, seconds: number, now = Date.now()): void {
  if (!storage || !key || !Number.isFinite(seconds) || seconds < 0) return;
  try {
    storage.setItem(key, JSON.stringify({ t: Math.floor(seconds), at: now }));
  } catch {
    // Storage full or disabled (private mode): resume is best effort.
  }
}

export function clearPosition(storage: StorageLike | null | undefined, key: string | null): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
