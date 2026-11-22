/**
 * Who may open a course in the builder: an active account that is the course's assigned instructor,
 * an admin or the Super Admin (the same owners as decideCourseUpdate). Everyone else, including an
 * instructor of another course, gets 404 so course ids cannot be probed. Content changes add the
 * lifecycle rule (lib/course-lifecycle.js decideContentEdit: instructors edit drafts only).
 */

import { ObjectId, type Db, type Document } from 'mongodb';
import type { AuthRequest } from '@/lib/auth-middleware';
import { decideAccountAccess, isStoredId } from '@/lib/account-access';
import { decideContentEdit } from '@/lib/course-lifecycle';

export type BuilderMember = { userId: string; role: string; email?: string };
export type OwnedCourse = { ok: true; member: BuilderMember; course: Document } | { ok: false; status: number; error: string; code?: string };

export async function loadOwnedCourse(db: Db, req: AuthRequest, courseId: unknown, projection?: Document, { edit = false } = {}): Promise<OwnedCourse> {
  if (!isStoredId(courseId)) return { ok: false, status: 400, error: 'Invalid course ID' };
  const record = await db.collection('users').findOne({ _id: new ObjectId(req.user!.userId) }, { projection: { email: 1, role: 1, status: 1 } });
  const account = decideAccountAccess({ userId: req.user!.userId, record });
  if (!account.ok) return { ok: false, status: 403, error: 'Not authorized' };
  const member = { userId: account.user.userId, role: account.user.role, email: account.user.email };
  if (!['instructor', 'admin', 'superadmin'].includes(member.role)) return { ok: false, status: 403, error: 'Not authorized' };
  const course = await db.collection('courses').findOne({ _id: new ObjectId(courseId) }, projection ? { projection: { instructorId: 1, status: 1, deletionStartedAt: 1, ...projection } } : undefined);
  const admin = member.role === 'admin' || member.role === 'superadmin';
  if (!course || course.deletionStartedAt || (!admin && String(course.instructorId ?? '') !== String(member.userId))) {
    return { ok: false, status: 404, error: 'Course not found' };
  }
  if (edit) {
    const editable = decideContentEdit(member, course);
    if (!editable.ok) return editable as { ok: false; status: number; error: string; code: string };
  }
  return { ok: true, member, course };
}
