import type { Db } from 'mongodb';

export const ACTIVE_WINDOW_SECONDS: number;
export const ACTIVITY_EVENTS: readonly ('view' | 'heartbeat')[];
export const COLLECTIONS: { readonly minutes: string; readonly days: string };
export const HEARTBEAT_SECONDS: number;
export const LEARNING_TIMEZONE: string;
export const MINUTE_RETENTION_DAYS: number;
export type Streak = { current: number; longest: number; activeToday: boolean };
export type LearningStats = {
  timezone: string;
  today: string;
  todayMinutes: number;
  recentMinutes: number;
  totalMinutes: number;
  recent: { day: string; minutes: number }[];
  streak: Streak;
};
export function computeStreak(dayKeys: unknown, today: string): Streak;
export function dayKey(date: Date): string;
export function minuteOf(date: Date): { key: string; start: Date };
export function shiftDay(key: string, days: number): string;
export function recordActivity(
  db: Db,
  input: { userId: string; courseId: string; lessonId: string; event: 'view' | 'heartbeat'; now?: Date }
): Promise<{ newMinute: boolean; day: string; minute: string }>;
export function learningStats(db: Db, userId: string, options?: { now?: Date; recentDays?: number }): Promise<LearningStats>;
