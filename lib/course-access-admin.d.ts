import type { Db } from 'mongodb';

type Refusal = { ok: false; status: number; code: string; error: string };
type Actor = { userId: string; email?: string | null };

export type CourseAccessEntry = {
  courseId: string;
  title: string | null;
  courseStatus: string | null;
  enrollment: {
    active: boolean;
    withdrawnAt: string | Date | null;
    progress: number;
    completedAt: string | Date | null;
    enrolledVia: string | null;
    enrolledAt: string | Date | null;
  } | null;
  access: {
    entitlementType: string | null;
    paid: boolean;
    entitled: boolean;
    paystackReference: string | null;
    unlockedAt: string | Date | null;
    grantedAt: string | Date | null;
    grantReason: string | null;
    revokedAt: string | Date | null;
    revokedReason: string | null;
  } | null;
};

export type StudentAccessOverview = {
  student: { id: string; name: string; email: string; status: string };
  courses: CourseAccessEntry[];
};

export const GRANT_REVOKED: 'grant_revoked';
export const REASON_MIN: number;
export const REASON_MAX: number;
export function studentAccessOverview(db: Db, input: { userId?: string; email?: string }): Promise<({ ok: true; status: 200 } & StudentAccessOverview) | Refusal>;
export function grantCourseAccess(db: Db, input: { actor: Actor; userId: string; courseId: string; reason: unknown; now?: Date }): Promise<{ ok: true; status: 200; code: 'granted'; enrollment: string } | Refusal>;
export function revokeCourseGrant(db: Db, input: { actor: Actor; userId: string; courseId: string; reason: unknown; now?: Date }): Promise<{ ok: true; status: 200; code: 'revoked' } | Refusal>;
