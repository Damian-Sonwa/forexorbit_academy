/** Types for lib/admin-portal.js (Phase 13). Also the frontend's contract for the admin portal. */
import type { Db } from 'mongodb';

type Member = { userId: string; role: string; email?: string };
type Refusal = { ok: false; status: number; error: string };
type R<T> = Promise<({ ok: true } & T) | Refusal>;
export type Paging = { page: number; limit: number; total: number; pages: number };
export type CheckoutState = 'paid' | 'held' | 'confirming' | 'stalled' | 'pending' | 'abandoned' | 'closed' | 'unknown';

export type AuditView = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reference: string | null;
  reason: string | null;
  outcome: string | null;
  actor: { userId: string | null; email: string | null; role: string | null } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string | null;
};

export type Alert = { id: string; severity: 'action' | 'warning'; title: string; href: string };
export type FinanceSummary = {
  currency: string;
  paidCount: number;
  gross: string;
  refunds: string;
  refundCount: number;
  net: string;
  states: Record<'paid' | 'held' | 'confirming' | 'stalled' | 'pending' | 'abandoned' | 'closed', number>;
  openExceptions: number;
  held: number;
  refundsNeedingAttention: number;
};
export type AdminOverview = {
  role: string;
  metrics: {
    windowDays: number;
    students: number;
    activeStudents: number;
    activeLearners: number;
    instructors: number;
    activeInstructors: number;
    admins: number;
    suspended: number;
    newRegistrations: number;
    newStudents: number;
    coursesByStatus: Record<'draft' | 'in_review' | 'published' | 'archived', number>;
    enrollments: number;
    newEnrollments: number;
    completions: number;
    coursesNeedingInstructor: number;
  };
  trend: Array<{ day: string; registrations: number }>;
  alerts: Alert[];
  recentRegistrations: Array<{ id: string; name: string; role: string; status: string; createdAt: string | null }>;
  finance: FinanceSummary | null;
  recentActions: AuditView[] | null;
};

export type UserRow = { id: string; name: string; email: string; role: string; status: string; createdAt: string | null; isExpert: boolean; courses: number | null };
export type UserList = { rows: UserRow[]; pagination: Paging; canDecideApprovals: boolean; canChangeStatus: boolean };
export type UserDetail = {
  user: { id: string; name: string; email: string; phone?: string | null; role: string; status: string; statusReason: string | null; learningLevel: string | null; isExpert: boolean; createdAt: string | null; activeSessions: number };
  learning: { totalMinutes: number; lastLearningDay: string | null; learningDays: number };
  enrollments: Array<{ courseId: string; course: string; status: 'active' | 'withdrawn'; progress: number; enrolledAt: string | null; completedAt: string | null; lastActivityAt: string | null; access: { type: string | null; entitled: boolean; reference?: string | null } | null }>;
  courses: Array<{ courseId: string; title: string; status: string; updatedAt: string | null }>;
  payments: Array<{ reference: string; course: string; amount: string; state: CheckoutState; refund: string | null; createdAt: string | null; paidAt: string | null }> | null;
  history: AuditView[] | null;
  permissions: { canChangeStatus: boolean; canDecideApproval: boolean; canGrantAccess: boolean };
};

export type CourseRow = {
  courseId: string;
  title: string;
  status: string;
  difficulty: string | null;
  instructor: { id: string; name: string; status: string } | null;
  instructorNeedsAttention: boolean;
  lessons: number;
  enrollments: number;
  completionRate: number | null;
  reassignments: number;
  createdAt: string | null;
  updatedAt: string | null;
};
export type CourseList = { rows: CourseRow[]; pagination: Paging };

export type EnrollmentRow = {
  id: string;
  studentId: string;
  student: string;
  email?: string;
  courseId: string;
  course: string;
  status: 'active' | 'withdrawn';
  progress: number;
  enrolledAt: string | null;
  completedAt: string | null;
  withdrawnAt: string | null;
  access: { type: string | null; entitled: boolean; unlockedAt: string | null; reference?: string | null } | null;
};
export type EnrollmentList = { rows: EnrollmentRow[]; pagination: Paging; canGrant?: boolean };

export type PaymentRow = {
  reference: string;
  student: string;
  email: string;
  studentId: string;
  course: string;
  courseId: string;
  amount: string;
  currency: string;
  state: CheckoutState;
  refund: 'refunded' | 'partially_refunded' | 'refund_pending' | null;
  refunded: string;
  heldReason: string | null;
  createdAt: string | null;
  paidAt: string | null;
};
export type PaymentList = { rows: PaymentRow[]; pagination: Paging };

export type RefundRow = {
  id: string;
  reference: string;
  student: string;
  course: string;
  amount: string;
  status: string;
  full: boolean;
  revokeAccess: boolean;
  reason: string;
  providerRefundId: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
};
export type RefundList = { rows: RefundRow[]; counts: Record<'open' | 'processed' | 'failed', number>; pagination: Paging };

export type AdminReport = {
  range: { from: string; to: string; days: number; timezone: string };
  totals: { registrations: number; studentRegistrations: number; enrollments: number; completions: number; learningMinutes: number; activeLearners: number };
  daily: Array<{ day: string; registrations: number; enrollments: number; completions: number; learningMinutes: number; activeLearners: number }>;
  topCourses: Array<{ courseId: string; title: string; enrollments: number; completions: number }>;
  finance: { currency: string; gross: string; refunds: string; net: string; paidCount: number; refundCount: number; statusDistribution: Record<string, number>; daily: Array<{ day: string; gross: string; refunds: string; net: string }> } | null;
  grading: Array<{ userId: string; name: string; graded: number; regraded: number }> | null;
};

export type PlatformConfig = {
  editable: false;
  environment: 'production' | 'non-production';
  integrations: Array<{ id: string; label: string; state: string; detail?: string | null }>;
  platform: Array<{ label: string; value: string }>;
};
export type AuditPage = { rows: AuditView[]; pagination: Paging };

export const ABANDON_AFTER_MS: number;
export const EXPORT_MAX_ROWS: number;
export const EXPORT_TYPES: Readonly<Record<string, 'admin' | 'superadmin'>>;
export const PAYMENT_STATES: readonly string[];
export const ACCOUNT_STATUSES: readonly string[];
export const AUDIT_TYPES: readonly string[];
export function checkoutState(intent: unknown, now?: Date): CheckoutState;
export function csvCell(value: unknown): string;
export function kobo(value: unknown): bigint;
export function naira(value: bigint): string;
export function presentAudit(entry: unknown): AuditView;
export function adminOverview(db: Db, member: Member, options?: { days?: number; now?: Date }): R<AdminOverview>;
export function adminUsers(db: Db, member: Member, options?: { q?: string; role?: string; status?: string; page?: number; limit?: number }): R<UserList>;
export function adminUserDetail(db: Db, member: Member, options: { userId: string; now?: Date }): R<UserDetail>;
export function adminCourses(db: Db, member: Member, options?: { q?: string; status?: string; instructorId?: string; attention?: string; page?: number; limit?: number }): R<CourseList>;
export function adminEnrollments(db: Db, member: Member, options?: { q?: string; courseId?: string; status?: string; access?: string; page?: number; limit?: number }): R<EnrollmentList>;
export function adminPayments(db: Db, member: Member, options?: { state?: string; from?: string; to?: string; q?: string; courseId?: string; page?: number; limit?: number; now?: Date }): R<PaymentList>;
export function adminRefunds(db: Db, member: Member, options?: { status?: string; page?: number; limit?: number }): R<RefundList>;
export function adminReport(db: Db, member: Member, options?: { from?: string; to?: string; now?: Date }): R<AdminReport>;
export function platformConfig(member: Member, env?: Record<string, string | undefined>): ({ ok: true } & PlatformConfig) | Refusal;
export function auditPage(db: Db, options?: { entityType?: string; action?: string; actor?: string; from?: string; to?: string; q?: string; page?: number; limit?: number }): R<AuditPage>;
export function buildExport(db: Db, member: Member, options: { type: string; filters?: Record<string, string>; now?: Date }): Promise<{ ok: true; filename: string; csv: string; rows: number; truncated: boolean } | Refusal>;
