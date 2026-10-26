/**
 * Class notifications go to active enrollments of one course.
 * A class with no course has no audience. This does not notify every student.
 */

function planClassNotification({ action, classId, courseId, title, date, time, activeStudentIds }) {
  const storedCourse = typeof courseId === 'string' && /^[a-fA-F0-9]{24}$/.test(courseId);
  const id = classId == null ? '' : String(classId);
  if (!storedCourse || !id) {
    return { notify: false, reason: 'no-course', recipients: [], dedupeKey: '' };
  }
  const recipients = Array.from(new Set((Array.isArray(activeStudentIds) ? activeStudentIds : []).map((item) => String(item)).filter(Boolean)));
  const name = typeof title === 'string' && title.trim() ? title.trim() : 'Class';
  let dedupeKey = `class:${id}:created`;
  let heading = `Class scheduled: ${name}`;
  let message = `${name} is scheduled.`;
  if (action === 'cancelled') {
    dedupeKey = `class:${id}:cancelled`;
    heading = `Class cancelled: ${name}`;
    message = `${name} was cancelled.`;
  } else if (action === 'rescheduled') {
    dedupeKey = `class:${id}:schedule:${date || ''}:${time || ''}`;
    heading = `Class rescheduled: ${name}`;
    message = `${name} is now scheduled for ${date || 'a new date'} ${time || ''}`.trim();
  }
  return {
    notify: recipients.length > 0,
    reason: recipients.length > 0 ? 'enrolled-students' : 'no-active-students',
    recipients,
    dedupeKey,
    title: heading,
    message,
    href: `/courses/${courseId}`,
  };
}

function dueReminderWindow(now, minutes) {
  const start = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const span = typeof minutes === 'number' && minutes > 0 ? minutes : 15;
  return { start, end: new Date(start.getTime() + span * 60 * 1000) };
}

function notificationDestination(notification) {
  const metadata = notification && notification.metadata;
  const href = metadata && typeof metadata.href === 'string' ? metadata.href : '';
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('://') || href.includes('\\')) return null;
  return href;
}

module.exports = {
  planClassNotification,
  dueReminderWindow,
  notificationDestination,
};
