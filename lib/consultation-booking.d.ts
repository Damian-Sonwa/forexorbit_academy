export const ACTIVE_LIFECYCLES: string[];
export const HOLD_MS: number;
export const CANCEL_CUTOFF_MS: number;

export function normalizeLifecycle(record: { lifecycle?: string; status?: string } | null): string;
export function legacyStatus(lifecycle: string, reason?: string): string;
export function bookingRole(
  member: { userId?: string; role?: string },
  booking: { studentId?: string; expertId?: string }
): 'admin' | 'expert' | 'learner' | 'none';
export function canReadMeetingLink(
  member: { userId?: string; role?: string },
  booking: { studentId?: string; expertId?: string; lifecycle?: string; status?: string; meetingUrl?: string; startsAt?: Date | string },
  now?: Date
): boolean;
export function decideAvailability(body: unknown):
  | { ok: true; schedule: { timeZone: string; durations: number[]; bufferMinutes: number; focus: string; windows: Array<{ weekday: number; start: string; end: string }> } }
  | { ok: false; status: number; error: string };
export function buildSlots(input: {
  schedule: { timeZone: string; durations: number[]; bufferMinutes: number; windows: Array<{ weekday: number; start: string; end: string }> };
  rangeStart: Date | string;
  rangeEnd: Date | string;
  bookings: unknown[];
  now?: Date;
}): Array<{ startsAt: string; endsAt: string; durationMinutes: number }>;
export function decideBookingDraft(
  body: unknown,
  schedule: { timeZone: string; durations: number[]; bufferMinutes: number; windows: Array<{ weekday: number; start: string; end: string }> },
  bookings: unknown[],
  now?: Date
): { ok: true; expertId: string; topic: string; description: string; startsAt: Date; endsAt: Date; durationMinutes: number; slotKey: string; holdExpiresAt: Date } | { ok: false; status: number; error: string };
export function hasOverlap(candidate: { startsAt: Date | string; endsAt: Date | string }, bookings: unknown[], ignoreId?: string, bufferMinutes?: number): boolean;
export function decideMeetingUrl(value: unknown):
  | { ok: true; meetingUrl: string; provider: string }
  | { ok: false; status: number; error: string };
export function decideBookingAction(input: {
  member: { userId?: string; role?: string };
  booking: Record<string, unknown>;
  action: string;
  now?: Date;
  proposed?: { startsAt: Date | string; endsAt?: Date | string; durationMinutes?: number };
  reason?: string;
  meetingUrl?: string;
}): { ok: true; lifecycle: string; reason?: string; proposed?: { startsAt: Date | string; endsAt?: Date | string; durationMinutes?: number }; meeting?: { ok: true; meetingUrl: string; provider: string } } | { ok: false; status: number; error: string };
export function canPublishAvailability(
  member: { role?: string } | null,
  record: { isExpert?: boolean } | null,
  mode: 'publish' | 'pause'
): { ok: true; markExpert: boolean } | { ok: false; status: number; error: string; markExpert: boolean };
export function paymentRequired(): boolean;
