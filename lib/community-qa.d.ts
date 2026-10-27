export const COMMUNITY_CATEGORIES: ReadonlyArray<{ id: string; label: string }>;

export const COMMUNITY_QA_INDEXES: ReadonlyArray<{
  collection: string;
  key: Record<string, number>;
  unique?: boolean;
  name: string;
}>;

export function categoryLabel(id: string): string;

export function plainCommunityText(value: unknown, max: number): string;

export function safeProfilePhoto(value: unknown): string | null;

export function communityReturnPath(value: unknown): string;

export function clearCommunityQaRateLimits(): void;

type QaFailure = { ok: false; status: number; error: string };

export function decideCommunityQaMember(member: { userId?: string; role?: string }):
  | { ok: true; userId: string; role: string; moderator: boolean }
  | QaFailure;

export function decideQuestionDraft(body: unknown):
  | { ok: true; title: string; body: string; category: string }
  | QaFailure;

export function decideQuestionPatch(body: unknown):
  | { ok: true; patch: { title?: string; body?: string; category?: string } }
  | QaFailure;

export function decideReplyDraft(body: unknown):
  | { ok: true; body: string }
  | QaFailure;

export function decideContentControl(
  member: { userId?: string; role?: string },
  authorId: string
): { ok: true; userId: string; moderator: boolean; owner: boolean } | QaFailure;

export function decideVoteChange(input: {
  current: number;
  requested: unknown;
  isAuthor: boolean;
}): { ok: true; previous: number; next: number; delta: number; remove: boolean } | QaFailure;

export function decideAcceptAnswer(input: {
  member: { userId?: string; role?: string };
  questionAuthorId: string;
  reply: { _id?: unknown; questionId?: unknown } | null;
  questionId: string;
}): { ok: true; acceptedReplyId: string | null } | QaFailure;

export function reconcileAcceptedAnswer(input: {
  acceptedReplyId: unknown;
  removedReplyId: string;
}): { clear: boolean };

export function buildQuestionListQuery(input: {
  view?: unknown;
  sort?: unknown;
  category?: unknown;
  search?: unknown;
  page?: unknown;
  limit?: unknown;
  authorId?: string;
  repliedQuestionIds?: string[];
}): {
  ok: true;
  view: string;
  sort: string;
  filter: Record<string, unknown>;
  mongoSort: Record<string, number>;
  skip: number;
  limit: number;
} | QaFailure;

export function consumeCommunityQaRate(input: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): { ok: true } | QaFailure;
