/** Types for lib/trading/reviews.js (practice desk trade reviews). */
export type TradeFacts = {
  positionId: string;
  instrument: string;
  side: string;
  units: string;
  entry: string;
  exit: string | null;
  stopLoss: string;
  takeProfit: string | null;
  realizedPl: string | null;
  closeReason: string | null;
  openedAt: string | null;
  closedAt: string | null;
  planNote: string | null;
};
export type AiFeedback = { strengths: string[]; mistakes: string[]; suggestions: string[]; riskReward: string };
export type Review = {
  id: string;
  setup: string;
  followedPlan: string;
  confidence: number;
  emotion: string | null;
  reason: string;
  lesson: string;
  screenshot: string | null;
  taskId: string | null;
  aiFeedback: AiFeedback | null;
  createdAt: string | null;
  updatedAt: string | null;
};
export type SaveResult =
  | { ok: true; created: boolean; review: Review; trade: TradeFacts; changedText: boolean }
  | { ok: false; status: number; error: string; field?: string };

export const SETUPS: readonly string[];
export const PLAN: readonly string[];
export const EMOTIONS: readonly string[];
export const TEXT_MAX: number;
export const NOTE_MAX: number;
export function readReviewInput(body: unknown): { ok: true; fields: Record<string, unknown> } | { ok: false; field: string; error: string };
export function readPlanNote(value: unknown): { ok: true; note: string } | { ok: false; error: string };
export function reviewIdFor(positionId: unknown): string;
export function presentReview(doc: unknown): Review | null;
export function listReviews(db: unknown, input: { userId: string; status?: string; page?: number; limit?: number }): Promise<{
  rows: Array<{ trade: TradeFacts; review: Review | null }>;
  counts: { reviewed: number; pending: number };
  pagination: { page: number; limit: number; total: number; pages: number };
}>;
export function saveReview(db: unknown, input: { userId: string; positionId: string; body: unknown; now?: Date }): Promise<SaveResult>;
export function setAiFeedback(db: unknown, positionId: string, feedback: AiFeedback): Promise<void>;
export function instructorReviews(db: unknown, input: { viewerId: string; role?: string; limit?: number }): Promise<{
  rows: Array<{ student: string; task: string | null; trade: TradeFacts; review: Review | null }>;
}>;
export const COLLECTIONS: Readonly<Record<string, string>>;
export function practiceSummary(db: unknown, userId: string): Promise<{ totalTrades: number; winRate: number; averageProfitLoss: number; reviewedTrades: number; planFollowedRate: number | null }>;
