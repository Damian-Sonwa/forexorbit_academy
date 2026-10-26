export function planClassNotification(input: {
  action?: string;
  classId?: string;
  courseId?: string;
  title?: string;
  date?: string;
  time?: string;
  activeStudentIds?: string[] | null;
}): {
  notify: boolean;
  reason: string;
  recipients: string[];
  dedupeKey: string;
  title?: string;
  message?: string;
  href?: string;
};

export function dueReminderWindow(now: Date | string | number, minutes?: number): { start: Date; end: Date };

export function notificationDestination(notification: { metadata?: { href?: string } } | null): string | null;
