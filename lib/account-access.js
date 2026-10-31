/**
 * Authorization decisions from the current user record.
 * Token role and email claims are intentionally not inputs.
 */

const ROLES = ['superadmin', 'admin', 'instructor', 'student'];

const INACTIVE_STATUSES = new Set([
  'pending',
  'rejected',
  'suspended',
  'deactivated',
  'disabled',
  'inactive',
]);

const { isActiveEnrollment } = require('./enrollment-state');
const { COURSE_STATUS, decideContentEdit, studentContentOpen } = require('./course-lifecycle');
const { safeLinkUrl } = require('./safe-url');

function accountStatus(record) {
  if (!record || record.status == null || record.status === '') {
    return 'approved';
  }
  return String(record.status);
}

function decideAccountAccess({ userId, record, allowedRoles }) {
  if (!userId || !record) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const role = record.role;
  if (!ROLES.includes(role)) {
    return { ok: false, status: 403, error: 'Insufficient permissions' };
  }

  const status = accountStatus(record);
  if (INACTIVE_STATUSES.has(status) || status !== 'approved') {
    return { ok: false, status: 403, error: 'Account is not active' };
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return { ok: false, status: 403, error: 'Insufficient permissions' };
  }

  return {
    ok: true,
    status: 200,
    user: {
      userId: String(userId),
      email: typeof record.email === 'string' ? record.email : '',
      role,
      status,
    },
  };
}

const LEVEL_ROOMS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

const PUBLIC_SOCKET_ROOM = 'community_global';

/**
 * Community room membership. A database lookup is required for every room
 * except the shared public socket room. Lookup failures do not join.
 */
function decideCommunityRoomJoin({ user, roomId, room, lookupError }) {
  if (!roomId || typeof roomId !== 'string') {
    return { ok: false, error: 'Room ID is required' };
  }

  if (roomId === PUBLIC_SOCKET_ROOM) {
    return {
      ok: true,
      roomId: PUBLIC_SOCKET_ROOM,
      roomName: PUBLIC_SOCKET_ROOM,
      publicRoom: true,
    };
  }

  if (lookupError) {
    return { ok: false, error: 'Unable to join room' };
  }

  if (!user || !['student', 'instructor', 'admin', 'superadmin'].includes(user.role)) {
    return { ok: false, error: 'Account is not active' };
  }

  if (!room || room._id == null) {
    return { ok: false, error: 'Room not found' };
  }

  const levelName = levelRoomName(room);
  if (levelName) {
    if (user.role === 'student') {
      const level = user.learningLevel || user.tradingLevel;
      if (!level || typeof level !== 'string') {
        return { ok: false, error: 'Please complete onboarding to access community rooms' };
      }
      const allowedName = LEVEL_ROOMS[level.toLowerCase()];
      if (!allowedName || room.name !== allowedName) {
        return { ok: false, error: 'Access restricted to your learning level' };
      }
    }
    return {
      ok: true,
      roomId: String(room._id),
      roomName: levelName,
      publicRoom: false,
    };
  }

  if (!roomIncludesMember(room, user.userId)) {
    return { ok: false, error: 'Access denied' };
  }

  return {
    ok: true,
    roomId: String(room._id),
    roomName: typeof room.name === 'string' ? room.name : 'Room',
    publicRoom: false,
  };
}

function levelRoomName(room) {
  if (!room || typeof room.name !== 'string') return '';
  if (room.type != null && room.type !== 'global') return '';
  return LEVEL_ROOM_NAMES.has(room.name) ? room.name : '';
}

function roomIncludesMember(room, userId) {
  const participants = room && Array.isArray(room.participants) ? room.participants : [];
  return participants.some((participant) => sameId(participant, userId));
}

function communityMember(userId, record) {
  const details = record && record.studentDetails && typeof record.studentDetails === 'object'
    ? record.studentDetails
    : {};
  return {
    userId: userId == null ? '' : String(userId),
    role: record && typeof record.role === 'string' ? record.role : '',
    learningLevel: record && typeof record.learningLevel === 'string' ? record.learningLevel : undefined,
    tradingLevel: typeof details.tradingLevel === 'string' ? details.tradingLevel : undefined,
  };
}

function decideCommunityMessageAccess({ member, room, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  if (!room || room._id == null) {
    return { ok: false, status: 404, error: 'Room not found' };
  }
  const join = decideCommunityRoomJoin({
    user: member,
    roomId: String(room._id),
    room,
  });
  if (!join.ok) {
    const safe = join.error === 'Please complete onboarding to access community rooms'
      || join.error === 'Access restricted to your learning level'
      || join.error === 'Access denied'
      ? join.error
      : 'Not authorized';
    return { ok: false, status: 403, error: safe };
  }
  return { ok: true, status: 200, roomId: join.roomId, senderId: String(member.userId) };
}

const COMMUNITY_MESSAGE_TYPES = new Set(['text', 'audio', 'document', 'video', 'image']);

function decideCommunityMessageSend({ member, room, body, lookupError }) {
  const access = decideCommunityMessageAccess({ member, room, lookupError });
  if (!access.ok) return access;
  const type = body && typeof body.type === 'string' ? body.type : '';
  const content = body && typeof body.content === 'string' ? body.content.trim() : '';
  if (!COMMUNITY_MESSAGE_TYPES.has(type) || !content || content.length > 5000) {
    return { ok: false, status: 400, error: 'Room ID, type, and content are required' };
  }
  return {
    ok: true,
    status: 201,
    roomId: access.roomId,
    message: {
      roomId: access.roomId,
      senderId: access.senderId,
      type,
      content,
      fileUrl: body && typeof body.fileUrl === 'string' ? body.fileUrl : null,
      fileName: body && typeof body.fileName === 'string' ? body.fileName : null,
      fileSize: body && typeof body.fileSize === 'number' ? body.fileSize : null,
    },
  };
}

function clientSafeAuthError(error) {
  const message = error && typeof error.message === 'string' ? error.message : '';
  if (message === 'Invalid or expired token') {
    return { status: 401, error: 'Invalid or expired token' };
  }
  return { status: 500, error: 'Internal server error' };
}

function isKnownMember(member) {
  return Boolean(
    member &&
    member.userId &&
    ['student', 'instructor', 'admin', 'superadmin'].includes(member.role)
  );
}

/**
 * Whether a typing indicator may be relayed to a community room.
 * The client room id only selects a target. The channel is the server's room id.
 */
function decideCommunityTyping({ member, roomId, room, lookupError }) {
  if (lookupError || !isKnownMember(member)) {
    return { ok: false, error: 'Unable to send typing indicator' };
  }
  const join = decideCommunityRoomJoin({ user: member, roomId, room });
  if (!join.ok) {
    return { ok: false, error: 'Unable to send typing indicator' };
  }
  return {
    ok: true,
    channel: `room:${join.roomId}`,
    roomId: join.roomId,
    user: {
      userId: String(member.userId),
      email: typeof member.email === 'string' ? member.email : '',
    },
  };
}

/**
 * Whether a typing indicator may be relayed to a consultation.
 * The channel uses the stored session id, not the raw client value.
 */
function decideConsultationTyping({ member, session, lookupError }) {
  if (lookupError || !isKnownMember(member) || !session || session._id == null) {
    return { ok: false, error: 'Unable to send typing indicator' };
  }
  if (!canJoinConsultation(member, session)) {
    return { ok: false, error: 'Unable to send typing indicator' };
  }
  const sessionId = String(session._id);
  return {
    ok: true,
    channel: `consultation:${sessionId}`,
    sessionId,
    user: {
      userId: String(member.userId),
      email: typeof member.email === 'string' ? member.email : '',
    },
  };
}

function canJoinConsultation(user, session) {
  if (!user || !session) return false;
  if (user.role === 'student') return session.studentId === user.userId;
  if (user.role === 'instructor') return session.expertId === user.userId;
  if (user.role === 'admin' || user.role === 'superadmin') return true;
  return false;
}

const LESSON_LEVEL_RANK = { beginner: 1, intermediate: 2, advanced: 3 };
const MAX_LESSON_CHAT_LENGTH = 2000;

function sameId(left, right) {
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

function canonicalLessonTarget(lesson, course) {
  if (!lesson || lesson._id == null || !course || course._id == null) return null;
  if (!sameId(lesson.courseId, course._id)) return null;
  const lessonId = String(lesson._id);
  const courseId = String(course._id);
  return {
    lessonId,
    courseId,
    lessonChannel: `lesson:${lessonId}`,
    courseChannel: `course:${courseId}`,
  };
}

/**
 * Student prerequisite rule from the lesson detail route.
 * A required level above the course difficulty needs course progress of 100.
 */
function lessonPrerequisiteBlocksStudent(lesson, course, enrollment) {
  if (!lesson || !lesson.requiredLevel || !course) return false;
  const courseRank = LESSON_LEVEL_RANK[String(course.difficulty || 'beginner').toLowerCase()];
  const requiredRank = LESSON_LEVEL_RANK[String(lesson.requiredLevel).toLowerCase()];
  if (!courseRank || !requiredRank || requiredRank <= courseRank) return false;
  const progressValue = enrollment && typeof enrollment.progress === 'number' ? enrollment.progress : 0;
  return progressValue < 100;
}

/**
 * Active enrollment only. A row with withdrawnAt or active false is retained
 * history and does not grant lesson, quiz, assignment, or progress-update access.
 * The product owner approved this withdrawn-enrollment rule on 26 October 2026.
 */
function studentOwnsEnrollment(member, courseId, enrollment) {
  return Boolean(
    enrollment &&
    isActiveEnrollment(enrollment) &&
    sameId(enrollment.userId, member.userId) &&
    sameId(enrollment.courseId, courseId)
  );
}

/**
 * Lesson and course room membership.
 * Students need an enrollment on the lesson's course. Instructors need to be
 * the course instructor. Admins and superadmins follow the lesson management rule.
 */
function decideLessonRoomAccess({ member, lesson, course, enrollment, lookupError }) {
  if (lookupError || !isKnownMember(member)) {
    return { ok: false, error: 'Unable to access lesson' };
  }
  const target = canonicalLessonTarget(lesson, course);
  if (!target) {
    return { ok: false, error: 'Unable to access lesson' };
  }

  let allowed = false;
  if (member.role === 'admin' || member.role === 'superadmin') {
    allowed = true;
  } else if (member.role === 'instructor') {
    allowed = sameId(course.instructorId, member.userId);
  } else if (member.role === 'student') {
    // Draft and in-review courses are never open to students; archived ones stay open to
    // students who are still enrolled (lib/course-lifecycle.js).
    allowed = studentContentOpen(course)
      && studentOwnsEnrollment(member, target.courseId, enrollment)
      && !lessonPrerequisiteBlocksStudent(lesson, course, enrollment);
  }

  if (!allowed) {
    return { ok: false, error: 'Unable to access lesson' };
  }

  return {
    ok: true,
    lessonId: target.lessonId,
    courseId: target.courseId,
    lessonChannel: target.lessonChannel,
    courseChannel: target.courseChannel,
    user: {
      userId: String(member.userId),
      email: typeof member.email === 'string' ? member.email : '',
    },
  };
}

/**
 * Lesson chat. Sender identity comes from the current account, not the payload.
 */
function decideLessonChat({ member, lesson, course, enrollment, text, lookupError }) {
  const access = decideLessonRoomAccess({ member, lesson, course, enrollment, lookupError });
  if (!access.ok) {
    return { ok: false, error: 'Unable to send message' };
  }
  if (typeof text !== 'string') {
    return { ok: false, error: 'Unable to send message' };
  }
  const body = text.trim();
  if (!body || body.length > MAX_LESSON_CHAT_LENGTH) {
    return { ok: false, error: 'Unable to send message' };
  }
  const senderName = member && typeof member.name === 'string' && member.name.trim()
    ? member.name.trim()
    : 'Anonymous';
  return {
    ok: true,
    channel: access.lessonChannel,
    lessonId: access.lessonId,
    text: body,
    sender: {
      userId: access.user.userId,
      senderName,
    },
  };
}

/**
 * Client-originated lesson and quiz refresh notices.
 * Matches lesson create/update/delete: instructor, admin, or superadmin.
 * The stored lesson and course ids are the only broadcast targets.
 */
/**
 * Read lesson chat. Lookup failures and missing lessons stay distinct from a denied member.
 */
function decideLessonMessageRead({ member, lesson, course, enrollment, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  const target = canonicalLessonTarget(lesson, course);
  if (!target) {
    return { ok: false, status: 404, error: 'Lesson not found' };
  }
  const access = decideLessonRoomAccess({ member, lesson, course, enrollment });
  if (!access.ok) {
    return { ok: false, status: 403, error: 'Unable to access lesson' };
  }
  return { ok: true, status: 200, lessonId: access.lessonId };
}

const MAX_QUIZ_QUESTIONS = 100;

function sanitizeQuizQuestions(questions) {
  if (!Array.isArray(questions) || questions.length > MAX_QUIZ_QUESTIONS) return null;
  const clean = [];
  for (const item of questions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (typeof item.question !== 'string' || item.question.length > 2000) return null;
    if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 8) return null;
    if (!item.options.every((option) => typeof option === 'string' && option.length <= 500)) return null;
    if (!Number.isInteger(item.correctAnswer) || item.correctAnswer < 0 || item.correctAnswer >= item.options.length) {
      return null;
    }
    clean.push({
      question: item.question,
      options: item.options.slice(),
      correctAnswer: item.correctAnswer,
    });
  }
  return clean;
}

/**
 * Quiz create/update. Admins and superadmins follow lesson management.
 * Instructors must be the course instructor. The stored course id is authoritative.
 */
function decideQuizMutation({ member, lesson, course, questions, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Unable to update quiz' };
  }
  if (member.role !== 'instructor' && member.role !== 'admin' && member.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Unable to update quiz' };
  }
  const target = canonicalLessonTarget(lesson, course);
  if (!target) {
    return { ok: false, status: 404, error: 'Lesson not found' };
  }
  if (member.role === 'instructor' && !sameId(course.instructorId, member.userId)) {
    return { ok: false, status: 403, error: 'Unable to update quiz' };
  }
  const editable = decideContentEdit(member, course);
  if (!editable.ok) return editable;
  const storedQuestions = sanitizeQuizQuestions(questions);
  if (!storedQuestions) {
    return { ok: false, status: 400, error: 'Missing required fields' };
  }
  return {
    ok: true,
    status: 200,
    lessonId: target.lessonId,
    courseId: target.courseId,
    questions: storedQuestions,
  };
}

/**
 * Student progress. An existing enrollment is required. The client cannot choose the user id.
 */
function decideProgressUpdate({ member, course, lesson, enrollment, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Unable to update progress' };
  }
  if (!course || course._id == null || !lesson || lesson._id == null) {
    return { ok: false, status: 404, error: 'Lesson not found' };
  }
  if (!sameId(lesson.courseId, course._id)) {
    return { ok: false, status: 403, error: 'Unable to update progress' };
  }
  const courseId = String(course._id);
  if (member.role !== 'student' || !studentContentOpen(course) || !studentOwnsEnrollment(member, courseId, enrollment)) {
    return { ok: false, status: 403, error: 'Unable to update progress' };
  }
  return {
    ok: true,
    status: 200,
    userId: String(member.userId),
    courseId,
    lessonId: String(lesson._id),
  };
}

/**
 * Lesson deletion. Assigned instructors, admins, and superadmins only.
 * The stored lesson id is the only quiz-delete key.
 */
function decideLessonDelete({ member, lesson, course, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const target = canonicalLessonTarget(lesson, course);
  if (!target) {
    return { ok: false, status: 404, error: 'Lesson not found' };
  }
  const assigned = member.role === 'instructor' && sameId(course.instructorId, member.userId);
  const admin = member.role === 'admin' || member.role === 'superadmin';
  if (!assigned && !admin) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const editable = decideContentEdit(member, course);
  if (!editable.ok) return editable;
  return { ok: true, status: 200, lessonId: target.lessonId, courseId: target.courseId };
}

function isStoredId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function ownsCourse(member, course) {
  if (!isKnownMember(member) || !course || course._id == null) return false;
  if (member.role === 'admin' || member.role === 'superadmin') return true;
  return member.role === 'instructor' && sameId(course.instructorId, member.userId);
}

const LESSON_LEVELS = ['beginner', 'intermediate', 'advanced'];
const LESSON_TITLE_MAX = 500;
const LESSON_TYPE_MAX = 32;
const MAX_LESSON_RESOURCES = 50;
const RESOURCE_TITLE_MAX = 300;
const RESOURCE_TYPE_MAX = 32;

function lessonInputError(field, error, code = 'invalid_lesson_input') {
  return { ok: false, status: 400, code, field, error };
}

/** A stored link field: null when empty, the URL when allowed, or undefined when refused. */
function linkFieldValue(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  if (value.trim() === '') return null;
  const url = safeLinkUrl(value);
  return url === null ? undefined : url;
}

/**
 * Lesson content an instructor editor is allowed to write, checked.
 * Course association, ownership, position (lib/lesson-order.js), roles and answer keys never
 * come from this patch. Links must be http(s) or relative (lib/safe-url.js); a present link that
 * is not allowed is refused, not dropped. Other text fields keep their earlier, lenient handling.
 */
function checkLessonInput(body) {
  const patch = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: true, patch };
  if (typeof body.title === 'string') {
    if (body.title.length > LESSON_TITLE_MAX) {
      return lessonInputError('title', `The lesson title must be at most ${LESSON_TITLE_MAX} characters.`);
    }
    patch.title = body.title;
  }
  for (const key of ['description', 'lastModified']) {
    if (typeof body[key] === 'string') patch[key] = body[key];
  }
  if (body.summary === null || typeof body.summary === 'string') patch.summary = body.summary;
  if (typeof body.type === 'string') {
    if (body.type.length > LESSON_TYPE_MAX) return lessonInputError('type', 'Unknown lesson type.');
    patch.type = body.type;
  }
  if (body.requiredLevel !== undefined) {
    if (body.requiredLevel === null || body.requiredLevel === '') {
      patch.requiredLevel = null;
    } else if (typeof body.requiredLevel === 'string' && LESSON_LEVELS.includes(body.requiredLevel.toLowerCase())) {
      patch.requiredLevel = body.requiredLevel.toLowerCase();
    } else {
      return lessonInputError('requiredLevel', 'The required level must be beginner, intermediate or advanced.');
    }
  }
  for (const key of ['videoUrl', 'pdfUrl']) {
    if (body[key] === undefined) continue;
    const value = linkFieldValue(body[key]);
    if (value === undefined) {
      return lessonInputError(key, 'Links must start with https:// or http://, or be a relative link.', 'invalid_url');
    }
    patch[key] = value;
  }
  if (body.resources !== undefined) {
    if (!Array.isArray(body.resources)) return lessonInputError('resources', 'Resources must be a list.');
    if (body.resources.length > MAX_LESSON_RESOURCES) {
      return lessonInputError('resources', `A lesson can have at most ${MAX_LESSON_RESOURCES} resources.`);
    }
    const resources = [];
    for (const item of body.resources) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rawUrl = typeof item.url === 'string' ? item.url : '';
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      // A blank row from the editor ("Add resource" never filled in) is not stored.
      if (rawUrl.trim() === '' && title === '') continue;
      const url = safeLinkUrl(rawUrl);
      if (url === null) {
        return lessonInputError('resources', 'Each resource needs a link that starts with https:// or http://, or a relative link.', 'invalid_url');
      }
      const type = typeof item.type === 'string' ? item.type : '';
      if (type.length > RESOURCE_TYPE_MAX || title.length > RESOURCE_TITLE_MAX) {
        return lessonInputError('resources', 'A resource title or type is too long.');
      }
      resources.push({ type, url, title });
    }
    patch.resources = resources;
  }
  if (typeof body.isFreePreview === 'boolean') patch.isFreePreview = body.isFreePreview;
  if (typeof body.content === 'string') {
    patch.content = body.content;
    patch.lessonSummary = { overview: body.content, screenshots: [] };
  } else if (
    body.lessonSummary &&
    typeof body.lessonSummary === 'object' &&
    !Array.isArray(body.lessonSummary) &&
    typeof body.lessonSummary.overview === 'string'
  ) {
    patch.lessonSummary = { overview: body.lessonSummary.overview, screenshots: [] };
  }
  return { ok: true, patch };
}

/**
 * Lesson update. Ownership comes from the stored lesson and its course.
 * A client course id is never copied onto the lesson. An instructor edits only a draft course.
 */
function decideLessonUpdate({ member, lesson, course, patch, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const target = canonicalLessonTarget(lesson, course);
  if (!target) {
    return { ok: false, status: 404, error: 'Lesson not found' };
  }
  if (!ownsCourse(member, course)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const editable = decideContentEdit(member, course);
  if (!editable.ok) return editable;
  const checked = checkLessonInput(patch);
  if (!checked.ok) return checked;
  return {
    ok: true,
    status: 200,
    lessonId: target.lessonId,
    courseId: target.courseId,
    patch: checked.patch,
  };
}

/**
 * Lesson create. The inserted course id is the stored course, and only its
 * assigned instructor (draft courses only), an admin, or a superadmin may attach a lesson.
 * The position is assigned by the route (lib/lesson-order.js), never taken from the body.
 */
function decideLessonCreate({ member, course, body, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  if (!course || course._id == null) {
    return { ok: false, status: 404, error: 'Course not found' };
  }
  if (!ownsCourse(member, course)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const editable = decideContentEdit(member, course);
  if (!editable.ok) return editable;
  const checked = checkLessonInput(body);
  if (!checked.ok) return checked;
  const patch = checked.patch;
  if (typeof patch.title !== 'string' || patch.title.trim() === '') {
    return { ok: false, status: 400, error: 'Missing required fields' };
  }
  return {
    ok: true,
    status: 201,
    courseId: String(course._id),
    document: {
      courseId: String(course._id),
      title: patch.title,
      description: patch.description,
      summary: patch.summary === undefined ? null : patch.summary,
      videoUrl: patch.videoUrl === undefined ? null : patch.videoUrl,
      pdfUrl: patch.pdfUrl === undefined ? null : patch.pdfUrl,
      type: patch.type || 'video',
      content: patch.content,
      resources: patch.resources || [],
      requiredLevel: patch.requiredLevel === undefined ? null : patch.requiredLevel,
      isFreePreview: patch.isFreePreview === true,
    },
  };
}

const COURSE_DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);
const COURSE_TEXT_LIMITS = Object.freeze({ title: 200, description: 20000, category: 80 });
const THUMBNAIL_MAX = 2000;

function courseInputError(field, error, code = 'invalid_course_input') {
  return { ok: false, status: 400, code, field, error };
}

/**
 * Course details, checked the same way for create and edit (Phase 4, M2).
 * Create needs title, description, category and difficulty. Edit (`partial`) checks only the
 * fields sent; a field sent unchanged from `current` is accepted as stored, so a course saved
 * before these limits can still be edited. Thumbnails must be http(s) or relative links.
 * Lifecycle state and instructor assignment are not set here.
 */
function checkCourseInput(body, { partial = false, current = null } = {}) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  const unchanged = (key) => partial && current && source[key] === current[key];
  for (const [key, max] of Object.entries(COURSE_TEXT_LIMITS)) {
    if (source[key] === undefined) {
      if (partial) continue;
      return courseInputError(key, 'Missing required fields');
    }
    if (unchanged(key)) continue;
    const value = typeof source[key] === 'string' ? source[key].trim() : '';
    if (!value) return courseInputError(key, partial ? `The course ${key} cannot be empty.` : 'Missing required fields');
    if (value.length > max) return courseInputError(key, `The course ${key} must be at most ${max} characters.`);
    fields[key] = value;
  }
  if (source.difficulty === undefined) {
    if (!partial) return courseInputError('difficulty', 'Missing required fields');
  } else if (!unchanged('difficulty')) {
    if (typeof source.difficulty !== 'string' || !COURSE_DIFFICULTIES.has(source.difficulty.trim())) {
      return courseInputError('difficulty', 'Difficulty must be beginner, intermediate or advanced.');
    }
    fields.difficulty = source.difficulty.trim();
  }
  if (source.thumbnail !== undefined && source.thumbnail !== null && !unchanged('thumbnail')) {
    if (typeof source.thumbnail !== 'string') return courseInputError('thumbnail', 'The thumbnail must be a link.');
    const raw = source.thumbnail.trim();
    if (raw === '') {
      fields.thumbnail = '';
    } else {
      const url = raw.length <= THUMBNAIL_MAX ? safeLinkUrl(raw) : null;
      if (url === null) {
        return courseInputError('thumbnail', 'The thumbnail must be a link that starts with https:// or http://, or a relative link.', 'invalid_url');
      }
      fields.thumbnail = url;
    }
  } else if (!partial) {
    fields.thumbnail = '';
  }
  return { ok: true, fields };
}

/**
 * Instructor assignment (Phase 4, Decision 5): only an active account with the instructor role.
 * `assignee` is the stored account the route looked up for `requestedId`; client values about the
 * account are never trusted. Admins and the Super Admin manage courses but are not assignees.
 */
function decideInstructorAssignee(requestedId, assignee) {
  if (!isStoredId(requestedId)) {
    return { ok: false, status: 400, code: 'invalid_instructor', error: 'Choose an active instructor for this course.' };
  }
  if (!assignee || !sameId(assignee.userId, requestedId) || assignee.role !== 'instructor' || accountStatus(assignee) !== 'approved') {
    return { ok: false, status: 400, code: 'invalid_instructor', error: 'Only an active instructor account can be assigned to a course.' };
  }
  return { ok: true, instructorId: String(assignee.userId) };
}

/**
 * Course update. An instructor may edit only a draft course they are assigned to, and cannot
 * change that assignment. Admins and superadmins may edit any course and reassign it to an active
 * instructor (`assignee` is the route's lookup of the requested account).
 */
function decideCourseUpdate({ member, course, patch, assignee, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  if (!course || course._id == null) {
    return { ok: false, status: 404, error: 'Course not found' };
  }
  if (!ownsCourse(member, course)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const editable = decideContentEdit(member, course);
  if (!editable.ok) return editable;
  const checked = checkCourseInput(patch, { partial: true, current: course });
  if (!checked.ok) return checked;
  const fields = { ...checked.fields };
  const admin = member.role === 'admin' || member.role === 'superadmin';
  const requested = patch && typeof patch.instructorId === 'string' ? patch.instructorId.trim() : '';
  // An instructor's request to reassign is ignored (they keep their course); see the tests.
  if (admin && requested && !sameId(requested, course.instructorId)) {
    const assignment = decideInstructorAssignee(requested, assignee);
    if (!assignment.ok) return assignment;
    fields.instructorId = assignment.instructorId;
  }
  return {
    ok: true,
    status: 200,
    courseId: String(course._id),
    patch: fields,
  };
}

const LEVEL_ROOM_NAMES = new Set(Object.values(LEVEL_ROOMS));

/**
 * Community presence audience.
 * Students receive online ids only for the global room matching their learning level.
 * Instructors, admins, and superadmins receive ids for every learning-level room,
 * because those roles may already open every global room.
 * The client cannot choose a room by emitting userOnline.
 */
function decideCommunityPresence({ member, rooms, lookupError }) {
  if (lookupError || !isKnownMember(member)) {
    return { ok: false, error: 'Unable to share presence' };
  }
  const levelRooms = (Array.isArray(rooms) ? rooms : []).filter(
    (room) => room && room._id != null && LEVEL_ROOM_NAMES.has(room.name)
  );
  let visible = [];
  if (member.role === 'student') {
    const level = member.learningLevel || member.tradingLevel;
    const allowedName = typeof level === 'string' ? LEVEL_ROOMS[level.toLowerCase()] : null;
    if (!allowedName) return { ok: false, error: 'Unable to share presence' };
    visible = levelRooms.filter((room) => room.name === allowedName);
  } else if (member.role === 'instructor' || member.role === 'admin' || member.role === 'superadmin') {
    visible = levelRooms;
  } else {
    return { ok: false, error: 'Unable to share presence' };
  }
  if (visible.length === 0) return { ok: false, error: 'Unable to share presence' };
  return {
    ok: true,
    userId: String(member.userId),
    channels: visible.map((room) => `presence:${String(room._id)}`),
  };
}

function presenceOfflineTargets(rooms) {
  const names = rooms && typeof rooms[Symbol.iterator] === 'function' ? [...rooms] : [];
  return names.filter((room) => typeof room === 'string' && room.startsWith('presence:') && room !== 'presence:community');
}

function presentQuizQuestions(questions, revealAnswers) {
  if (!Array.isArray(questions)) return [];
  return questions.map((question) => {
    const view = {
      question: question && typeof question.question === 'string' ? question.question : '',
      options: question && Array.isArray(question.options)
        ? question.options.filter((option) => typeof option === 'string')
        : [],
    };
    if (revealAnswers && question && Number.isInteger(question.correctAnswer)) {
      view.correctAnswer = question.correctAnswer;
    }
    return view;
  });
}

function revealQuizAnswers(member, course) {
  if (!member || !course) return false;
  if (member.role === 'admin' || member.role === 'superadmin') return true;
  return member.role === 'instructor' && sameId(course.instructorId, member.userId);
}

/**
 * Quiz read. Students receive questions without the stored answer key.
 */
function decideQuizRead({ member, lesson, course, enrollment, quiz, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  const target = canonicalLessonTarget(lesson, course);
  if (!target) {
    return { ok: false, status: 404, error: 'Lesson not found' };
  }
  const access = decideLessonRoomAccess({ member, lesson, course, enrollment });
  if (!access.ok) {
    return { ok: false, status: 403, error: 'Unable to access lesson' };
  }
  if (!quiz || !Array.isArray(quiz.questions)) {
    return { ok: false, status: 404, error: 'Quiz not found' };
  }
  const revealAnswers = revealQuizAnswers(member, course);
  return {
    ok: true,
    status: 200,
    lessonId: target.lessonId,
    courseId: target.courseId,
    revealAnswers,
    questions: presentQuizQuestions(quiz.questions, revealAnswers),
  };
}

/**
 * Quiz grading. The stored questions decide the score. The client cannot choose the user.
 */
function decideQuizSubmit({ member, lesson, course, enrollment, quiz, answers, lookupError }) {
  const read = decideQuizRead({ member, lesson, course, enrollment, quiz, lookupError });
  if (!read.ok) return read;
  if (!Array.isArray(answers) || !quiz || !Array.isArray(quiz.questions)) {
    return { ok: false, status: 400, error: 'Missing required fields' };
  }
  let correct = 0;
  const results = quiz.questions.map((question, index) => {
    const userAnswer = answers[index];
    const isCorrect = question && userAnswer === question.correctAnswer;
    if (isCorrect) correct += 1;
    return {
      question: question && typeof question.question === 'string' ? question.question : '',
      userAnswer,
      correctAnswer: question ? question.correctAnswer : undefined,
      isCorrect,
    };
  });
  const total = quiz.questions.length;
  return {
    ok: true,
    status: 200,
    lessonId: read.lessonId,
    courseId: read.courseId,
    userId: String(member.userId),
    score: total > 0 ? (correct / total) * 100 : 0,
    correct,
    total,
    results,
  };
}

function decideLessonRead(input) {
  return decideLessonMessageRead(input);
}

/**
 * Whether this account may open a course's lesson list.
 * An enrolled student still has each lesson checked for the prerequisite rule.
 */
function decideLessonCatalog({ member, course, enrollment, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  if (!course || course._id == null) {
    return { ok: false, status: 404, error: 'Course not found' };
  }
  const courseId = String(course._id);
  if (member.role === 'admin' || member.role === 'superadmin') {
    return { ok: true, status: 200, courseId };
  }
  if (member.role === 'instructor' && sameId(course.instructorId, member.userId)) {
    return { ok: true, status: 200, courseId };
  }
  if (member.role === 'student' && studentContentOpen(course) && studentOwnsEnrollment(member, courseId, enrollment)) {
    return { ok: true, status: 200, courseId };
  }
  return { ok: false, status: 403, error: 'Not authorized' };
}

const PUBLIC_LESSON_KEYS = ['_id', 'title', 'type', 'order'];
const PROTECTED_LESSON_KEYS = ['content', 'videoUrl', 'pdfUrl', 'resources', 'lessonSummary'];
const OUTLINE_DESCRIPTION_LIMIT = 280;

/**
 * Public course pages show a short lesson blurb. Seeded summaries and the
 * instructor body are the protected lesson text, so they stay off the outline.
 */
function publicLessonDescription(lesson) {
  if (!lesson || typeof lesson.description !== 'string') return '';
  const description = lesson.description.trim();
  if (!description || description.length > OUTLINE_DESCRIPTION_LIMIT) return '';
  if (/https?:\/\//i.test(description)) return '';
  // The outline reads only the first characters of the body and overview (outline*Head, see
  // OUTLINE_LESSON_PROJECTION in lib/course-lesson-list.js); a blurb is at most 280 characters,
  // so it can only equal a body that fits in that head.
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const content = text(lesson.content) || text(lesson.outlineContentHead);
  const summary = text(lesson.summary);
  const overview = (lesson.lessonSummary && text(lesson.lessonSummary.overview)) || text(lesson.outlineOverviewHead);
  if ((content && description === content) || (summary && description === summary) || (overview && description === overview)) {
    return '';
  }
  return description;
}

/**
 * Lesson payload for a read. Protected media and quiz fields stay off the
 * public outline. Quiz questions are attached by the quiz read decision.
 */
function presentLessonRead(lesson, includeProtected, courseId) {
  const view = { locked: !includeProtected, accessible: Boolean(includeProtected) };
  if (!lesson || typeof lesson !== 'object') return view;
  for (const key of PUBLIC_LESSON_KEYS) {
    if (lesson[key] !== undefined) view[key] = lesson[key];
  }
  const blurb = publicLessonDescription(lesson);
  if (blurb) view.description = blurb;
  if (courseId != null) view.courseId = String(courseId);
  if (includeProtected) {
    if (lesson.description !== undefined) view.description = lesson.description;
    if (lesson.summary !== undefined) view.summary = lesson.summary;
    for (const key of PROTECTED_LESSON_KEYS) {
      if (lesson[key] !== undefined) view[key] = lesson[key];
    }
  }
  return view;
}

const CONSULTATION_PUBLISHER_TTL_SECONDS = 3600;

function consultationLookupId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const bare = trimmed.startsWith('consultation_') ? trimmed.slice('consultation_'.length) : trimmed;
  return isStoredId(bare) ? bare : '';
}

/**
 * Publisher token for an active consultation.
 * The channel and account come from the stored session and the current user.
 * The client fetches one token per call and does not renew it, so the
 * lifetime stays at the existing one-hour window.
 */
function decideConsultationPublisherToken({ member, session, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Unable to start the call' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  if (!session || session._id == null || !isStoredId(String(session._id))) {
    return { ok: false, status: 404, error: 'Not found' };
  }
  if (session.status !== 'active') {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const participant = (member.role === 'student' && sameId(session.studentId, member.userId))
    || (member.role === 'instructor' && sameId(session.expertId, member.userId))
    || member.role === 'admin'
    || member.role === 'superadmin';
  if (!participant) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const sessionId = String(session._id);
  return {
    ok: true,
    status: 200,
    sessionId,
    channel: `consultation_${sessionId}`,
    account: String(member.userId),
    ttlSeconds: CONSULTATION_PUBLISHER_TTL_SECONDS,
  };
}

function consultationPublisherResponse({ decision, appId, nowSeconds, issue }) {
  if (!decision || decision.ok !== true) {
    return decision && decision.ok === false
      ? decision
      : { ok: false, status: 403, error: 'Not authorized' };
  }
  if (
    typeof appId !== 'string' ||
    appId.trim() === '' ||
    typeof issue !== 'function' ||
    !Number.isInteger(nowSeconds) ||
    !Number.isInteger(decision.ttlSeconds) ||
    decision.ttlSeconds <= 0 ||
    decision.ttlSeconds > CONSULTATION_PUBLISHER_TTL_SECONDS
  ) {
    return { ok: false, status: 500, error: 'Unable to start the call' };
  }
  let token = '';
  try {
    token = issue({
      channel: decision.channel,
      account: decision.account,
      privilegeExpireTime: nowSeconds + decision.ttlSeconds,
    });
  } catch {
    return { ok: false, status: 500, error: 'Unable to start the call' };
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, status: 500, error: 'Unable to start the call' };
  }
  return {
    ok: true,
    status: 200,
    body: {
      token,
      appId,
      channel: decision.channel,
      uid: decision.account,
    },
  };
}

function decideLessonStaffNotify({ member, lesson, course, lookupError }) {
  if (lookupError || !isKnownMember(member)) {
    return { ok: false, error: 'Unable to update lesson' };
  }
  if (member.role !== 'instructor' && member.role !== 'admin' && member.role !== 'superadmin') {
    return { ok: false, error: 'Unable to update lesson' };
  }
  const target = canonicalLessonTarget(lesson, course);
  if (!target) {
    return { ok: false, error: 'Unable to update lesson' };
  }
  if (member.role === 'instructor' && !sameId(course.instructorId, member.userId)) {
    return { ok: false, error: 'Unable to update lesson' };
  }
  return { ok: true, ...target };
}

/**
 * Course creation. An instructor owns the new course and cannot assign another instructor.
 * An admin or superadmin must assign an active instructor (Decision 5): they manage courses but
 * are not assignees. A new course starts as a draft whose free preview is set explicitly per
 * lesson (Decision 3), never by lesson order.
 */
function decideCourseCreate({ member, body, assignee, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member) || (member.role !== 'instructor' && member.role !== 'admin' && member.role !== 'superadmin')) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const checked = checkCourseInput(body);
  if (!checked.ok) return checked;
  const requested = body && typeof body.instructorId === 'string' ? body.instructorId.trim() : '';
  let instructorId = String(member.userId);
  if (member.role === 'instructor') {
    if (requested && !sameId(requested, member.userId)) {
      return { ok: false, status: 403, error: 'Not authorized' };
    }
  } else {
    const assignment = decideInstructorAssignee(requested, assignee);
    if (!assignment.ok) return assignment;
    instructorId = assignment.instructorId;
  }
  return {
    ok: true,
    status: 201,
    document: {
      ...checked.fields,
      instructorId,
      status: COURSE_STATUS.DRAFT,
      freePreviewExplicit: true,
    },
  };
}

function decideAssignmentRead({ member, course, enrollment, lookupError }) {
  if (lookupError) {
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!isKnownMember(member)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  if (!course || course._id == null) {
    return { ok: false, status: 404, error: 'Course not found' };
  }
  const courseId = String(course._id);
  if (ownsCourse(member, course)) {
    return { ok: true, status: 200, courseId, staff: true };
  }
  // Draft and in-review courses are closed to students (lib/course-lifecycle.js).
  if (member.role === 'student' && studentContentOpen(course) && studentOwnsEnrollment(member, courseId, enrollment)) {
    return { ok: true, status: 200, courseId, staff: false };
  }
  return { ok: false, status: 403, error: 'Not authorized' };
}

function assignmentMatchesCourse(assignment, courseId) {
  return Boolean(assignment && assignment._id != null && sameId(assignment.courseId, courseId));
}

function presentSubmission(submission) {
  if (!submission) return null;
  return {
    _id: submission._id,
    userId: submission.userId == null ? '' : String(submission.userId),
    assignmentId: submission.assignmentId == null ? '' : String(submission.assignmentId),
    submissionText: typeof submission.submissionText === 'string' ? submission.submissionText : '',
    submissionFile: typeof submission.submissionFile === 'string' ? submission.submissionFile : null,
    status: typeof submission.status === 'string' ? submission.status : 'submitted',
    grade: typeof submission.grade === 'number' ? submission.grade : null,
    feedback: typeof submission.feedback === 'string' ? submission.feedback : null,
    submittedAt: submission.submittedAt || null,
  };
}

function presentAssignment(assignment, staff, submission) {
  const view = {
    _id: assignment._id,
    courseId: assignment.courseId == null ? '' : String(assignment.courseId),
    lessonId: assignment.lessonId || null,
    title: typeof assignment.title === 'string' ? assignment.title : '',
    description: typeof assignment.description === 'string' ? assignment.description : '',
    instructions: typeof assignment.instructions === 'string' ? assignment.instructions : '',
    dueDate: assignment.dueDate || null,
    points: typeof assignment.points === 'number' ? assignment.points : 100,
    type: typeof assignment.type === 'string' ? assignment.type : 'assignment',
  };
  if (staff) return view;
  return {
    ...view,
    submitted: Boolean(submission),
    submission: presentSubmission(submission),
  };
}

function decideAssignmentCreate({ member, course, lesson, body, lookupError }) {
  const access = decideAssignmentRead({ member, course, enrollment: null, lookupError });
  if (!access.ok) return access;
  if (!access.staff) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  const requestedLesson = body && typeof body.lessonId === 'string' ? body.lessonId.trim() : '';
  if (requestedLesson) {
    if (!lesson || lesson._id == null || !sameId(lesson.courseId, access.courseId)) {
      return { ok: false, status: 404, error: 'Lesson not found' };
    }
  }
  const title = body && typeof body.title === 'string' ? body.title.trim() : '';
  const instructions = body && typeof body.instructions === 'string' ? body.instructions.trim() : '';
  if (!title || !instructions) {
    return { ok: false, status: 400, error: 'Missing required fields' };
  }
  const points = body && typeof body.points === 'number' && Number.isFinite(body.points) && body.points >= 0
    ? body.points
    : 100;
  const type = body && body.type === 'project' ? 'project' : 'assignment';
  return {
    ok: true,
    status: 201,
    document: {
      courseId: access.courseId,
      lessonId: requestedLesson ? String(lesson._id) : null,
      title,
      description: body && typeof body.description === 'string' ? body.description : '',
      instructions,
      dueDate: body && typeof body.dueDate === 'string' ? body.dueDate : null,
      points,
      type,
      createdBy: String(member.userId),
    },
  };
}

function decideAssignmentMutation({ member, course, assignment, lookupError }) {
  const access = decideAssignmentRead({ member, course, enrollment: null, lookupError });
  if (!access.ok) return access;
  if (!assignment || assignment._id == null) {
    return { ok: false, status: 404, error: 'Assignment not found' };
  }
  if (!access.staff || !assignmentMatchesCourse(assignment, access.courseId)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  return { ok: true, status: 200, assignmentId: String(assignment._id), courseId: access.courseId };
}

function decideAssignmentSubmit({ member, course, enrollment, assignment, body, lookupError }) {
  const access = decideAssignmentRead({ member, course, enrollment, lookupError });
  if (!access.ok) return access;
  if (access.staff || member.role !== 'student') {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  if (!assignmentMatchesCourse(assignment, access.courseId)) {
    return { ok: false, status: 404, error: 'Assignment not found' };
  }
  const submissionText = body && typeof body.submissionText === 'string' ? body.submissionText : '';
  const submissionFile = body && typeof body.submissionFile === 'string' ? body.submissionFile : '';
  if (!submissionText.trim() && !submissionFile.trim()) {
    return { ok: false, status: 400, error: 'Submission text or file required' };
  }
  return {
    ok: true,
    status: 200,
    userId: String(member.userId),
    assignmentId: String(assignment._id),
    courseId: access.courseId,
    lessonId: assignment.lessonId || null,
    submissionText,
    submissionFile: submissionFile || null,
    points: typeof assignment.points === 'number' ? assignment.points : 0,
  };
}

function boundedGrade(value) {
  const number = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  return number;
}

function decideAssignmentGrade({ member, course, assignment, submission, grade, feedback, lookupError }) {
  const access = decideAssignmentMutation({ member, course, assignment, lookupError });
  if (!access.ok) return access;
  if (!submission || submission._id == null || !sameId(submission.assignmentId, access.assignmentId)) {
    return { ok: false, status: 404, error: 'Submission not found' };
  }
  const score = boundedGrade(grade);
  if (score == null) {
    return { ok: false, status: 400, error: 'Missing required fields' };
  }
  return {
    ok: true,
    status: 200,
    submissionId: String(submission._id),
    userId: submission.userId == null ? '' : String(submission.userId),
    grade: score,
    feedback: typeof feedback === 'string' ? feedback : '',
    gradedBy: String(member.userId),
    points: typeof assignment.points === 'number' ? assignment.points : 0,
  };
}

module.exports = {
  ROLES,
  decideAccountAccess,
  decideCommunityRoomJoin,
  decideCommunityTyping,
  decideConsultationTyping,
  decideLessonRoomAccess,
  decideLessonChat,
  decideLessonMessageRead,
  decideLessonRead,
  decideLessonCatalog,
  presentLessonRead,
  decideConsultationPublisherToken,
  consultationLookupId,
  consultationPublisherResponse,
  CONSULTATION_PUBLISHER_TTL_SECONDS,
  decideLessonStaffNotify,
  communityMember,
  decideCommunityMessageAccess,
  decideCommunityMessageSend,
  decideCourseCreate,
  checkCourseInput,
  checkLessonInput,
  decideInstructorAssignee,
  decideAssignmentRead,
  presentAssignment,
  presentSubmission,
  decideAssignmentCreate,
  decideAssignmentMutation,
  decideAssignmentSubmit,
  decideAssignmentGrade,
  decideQuizMutation,
  decideQuizRead,
  decideQuizSubmit,
  decideProgressUpdate,
  decideLessonDelete,
  decideLessonUpdate,
  decideLessonCreate,
  decideCourseUpdate,
  decideCommunityPresence,
  presenceOfflineTargets,
  isStoredId,
  clientSafeAuthError,
  canJoinConsultation,
  accountStatus,
  PUBLIC_SOCKET_ROOM,
};
