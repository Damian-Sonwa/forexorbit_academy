import type { Db, Document } from 'mongodb';
import type { Block } from './course-content';
import type { KnowledgeCheck, QualityCheck } from './lesson-generation';

export type ProposalSummary = {
  id: string; mode: string; sectionKind: string | null; status: 'pending' | 'accepted' | 'rejected'; createdAt: string | Date; decidedAt: string | Date | null;
  baseRevision: number; provider: string; model: string; blocks: number; checks: number; questions: number; instructions: string;
};
export type Proposal = ProposalSummary & { blocks: Block[]; knowledgeChecks: KnowledgeCheck[]; suggestions: string[]; quality: { checks: QualityCheck[]; words?: number }; usage: { promptTokens: number; completionTokens: number } | null };
type Refusal = { ok: false; status: number; code: string; error: string };
type Member = { userId: string; role: string };

export const KEEP: number;
export function proposedBody(mode: string, current: Block[], generated: Block[], insertAfter: string | null): Block[];
export function generateProposal(db: Db, input: { member: Member; course: Document; lessonId: string; request: Record<string, unknown>; chat?: unknown; env?: Record<string, string | undefined>; now?: Date }): Promise<{ ok: true; status: number; reused?: boolean; proposal: Proposal } | Refusal>;
export function acceptProposal(db: Db, input: { member: Member; course: Document; lessonId: string; body: Record<string, unknown>; now?: Date }): Promise<{ ok: true; status: number; revision: number; quiz: { added: number; note: string } | null } | Refusal>;
export function rejectProposal(db: Db, input: { member: Member; course: Document; lessonId: string; body: Record<string, unknown>; now?: Date }): Promise<{ ok: true; status: number } | Refusal>;
export function restoreVersion(db: Db, input: { member: Member; course: Document; lessonId: string; body: Record<string, unknown>; now?: Date }): Promise<{ ok: true; status: number; revision: number } | Refusal>;
export function addDraftQuestions(db: Db, input: Record<string, unknown>): Promise<{ added: number; note: string }>;
export function readAi(db: Db, input: { course: Document; lessonId: string; proposalId?: string; historyId?: string }): Promise<
  | { ok: true; status: number; proposals: ProposalSummary[]; proposal: Proposal | null; history: Array<{ id: string; at: string | Date; reason: string; revision: number; blocks: number }>; version: { id: string; blocks: Block[] } | null; running: boolean; revision: number }
  | Refusal
>;
