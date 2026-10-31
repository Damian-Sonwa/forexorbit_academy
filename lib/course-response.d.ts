export const COURSE_RESPONSE_FIELDS: readonly string[];

export function canReadCourseLessons(
  role: string | undefined,
  userId: unknown,
  instructorId: unknown
): boolean;

export function presentCourse(
  course: { [key: string]: any } | null,
  options?: {
    progress?: number;
    enrolled?: boolean;
    completedAt?: Date | string | null;
    lessons?: unknown[];
  }
): { [key: string]: any };
