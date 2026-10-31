export type CourseStatus = 'draft' | 'in_review' | 'published' | 'archived';

export const COURSE_STATUS: {
  readonly DRAFT: 'draft';
  readonly IN_REVIEW: 'in_review';
  readonly PUBLISHED: 'published';
  readonly ARCHIVED: 'archived';
};
export const COURSE_STATUSES: readonly CourseStatus[];
export const TRANSITIONS: { readonly [key: string]: readonly string[] };

type Member = { userId?: string; role?: string } | null | undefined;
type CourseLike = { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null | undefined;
type Refusal = { ok: false; status: number; code: string; error: string };

export function courseStatus(course: CourseLike): CourseStatus;
export function statusFilter(status: CourseStatus): { [key: string]: unknown };
export function publicCourseFilter(): { [key: string]: unknown };
export function courseVisibilityFilter(
  member: Member,
  options?: { activeCourseIds?: unknown[]; instructorIdValues?: unknown[] }
): { [key: string]: unknown };
export function canSeeCourse(member: Member, course: CourseLike, options?: { activeEnrollment?: boolean }): boolean;
export function studentContentOpen(course: CourseLike): boolean;
export function decideCourseOpenForSale(course: CourseLike): { ok: true } | Refusal;
export function decideContentEdit(member: Member, course: CourseLike): { ok: true } | Refusal;
export function decideCourseTransition(input: { member: Member; course: CourseLike; to: unknown }):
  | { ok: true; status: 200; courseId: string; from: CourseStatus; to: CourseStatus; filter: { [key: string]: unknown } }
  | Refusal;
export function availableTransitions(member: Member, course: CourseLike): CourseStatus[];
