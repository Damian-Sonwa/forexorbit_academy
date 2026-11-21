/** Types for lib/academic-operations.js (Phase 12). */
import type { Db } from 'mongodb';

type Refusal = { ok: false; status: number; code: string; error: string };
export type Actor = { userId: string; email?: string | null; role?: string | null };
export type Notice = { userId: string; title: string; message: string; dedupeKey: string; relatedId: string };

export const ASSIGNMENT_STATUSES: readonly ['draft', 'published', 'closed'];
export const POINTS_MAX: number;
export const REASON_MIN: number;
export const REASON_MAX: number;
export function decideGradeChange(input: { currentGrade: number | null; newGrade: number; reason: unknown }): { ok: true; regrade: boolean; changing: boolean; reason: string } | Refusal;
export function gradeAuditId(submissionId: string, version: number): string;
export function gradeAuditEntry(input: {
  submissionId: string;
  version: number;
  previousGrade: number | null;
  grade: number;
  reason: string;
  regrade: boolean;
  actor: Actor;
  context: { courseId?: string | null; courseTitle?: string | null; assignmentId?: string | null; assignmentTitle?: string | null; studentId?: string | null };
  now: Date;
}): Record<string, unknown> & { entityId: string; after: { grade: number; version: number } };
export function writeGradeAudit(db: Db, entry: ReturnType<typeof gradeAuditEntry>): Promise<boolean>;
export function repairGradeAudits(db: Db, options?: { limit?: number }): Promise<{ repaired: number }>;
export function readDueDate(value: unknown): { ok: true; value: string | Date | null } | Refusal;
export function readAssignmentPatch(body: unknown, options?: { graded?: boolean; currentPoints?: number }): { ok: true; set: Record<string, unknown> } | Refusal;
export function assignmentStatus(assignment: unknown): 'draft' | 'published' | 'closed';
export function visibleToStudents(assignment: unknown): boolean;
export function acceptsSubmissions(assignment: unknown): boolean;
export function reassignCourse(db: Db, input: { actor: Actor; courseId: string; instructorId: string; reason: unknown; now?: Date; notify?: (notices: Notice[]) => Promise<void> }): Promise<{ ok: true; courseId: string; from: string | null; to: string; audited: boolean } | Refusal>;
export function applyReassignment(db: Db, input: { course: { _id: unknown; title?: unknown; instructorId?: unknown }; from: string | null; to: string; actor: Actor; reason: string; now: Date; notify?: (notices: Notice[]) => Promise<void>; extraSet?: Record<string, unknown> }): Promise<{ ok: true; courseId: string; from: string | null; to: string; audited: boolean } | Refusal>;
export function reassignmentHistory(db: Db, courseId: string): Promise<{ ok: true; course: { courseId: string; title: string; instructorId: string | null; instructor: string | null }; history: Array<{ from: string | null; to: string; by: string; at: string | null; reason: string }> } | Refusal>;
