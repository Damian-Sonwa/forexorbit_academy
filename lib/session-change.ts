/**
 * This tab is replacing its own session (password change). The server ends every session, including
 * this one, a moment before the response carries the new cookie. Until then a 401 or a
 * `session_ended` event in this tab is expected and says nothing about the new session: session
 * checks wait, and a 401 does not redirect to sign-in. Other tabs and devices are unaffected.
 */

/** Requests sent just before the new cookie can still be answered 401 just after it. */
const LATE_ANSWERS_MS = 2000;

let active = 0;
let quietUntil = 0;
let pending: Promise<unknown> = Promise.resolve();

export async function duringSessionChange<T>(change: () => Promise<T>): Promise<T> {
  active += 1;
  const run = change();
  pending = run.catch(() => undefined);
  try {
    return await run;
  } finally {
    active -= 1;
    quietUntil = Date.now() + LATE_ANSWERS_MS;
  }
}

export const sessionChangeInProgress = () => active > 0 || Date.now() < quietUntil;
/** Resolves when no session change is in flight. */
export const sessionChangeSettled = () => pending;
