/** Client-side optimistic unlock flag (persists across lesson navigation until tab closes). */
export function coursePaidStorageKey(courseId: string): string {
  return `fo_course_paid_${courseId}`;
}

export function readCoursePaidClient(courseId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(coursePaidStorageKey(courseId)) === '1';
  } catch {
    return false;
  }
}

export function writeCoursePaidClient(courseId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(coursePaidStorageKey(courseId), '1');
  } catch {
    /* ignore quota / private mode */
  }
}
