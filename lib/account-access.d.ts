export type AppRole = 'superadmin' | 'admin' | 'instructor' | 'student';

export interface AccountUser {
  userId: string;
  email: string;
  role: AppRole;
  status: string;
}

export type AccountDecision =
  | { ok: true; status: 200; user: AccountUser }
  | { ok: false; status: 401 | 403; error: string };

export function decideAccountAccess(input: {
  userId: string;
  record: { [key: string]: any } | null;
  allowedRoles?: readonly AppRole[];
}): AccountDecision;

export function decideCommunityRoomJoin(input: {
  user?: { userId?: string; role?: string; learningLevel?: string; tradingLevel?: string } | null;
  roomId?: string;
  room?: { _id?: unknown; name?: string; type?: string; participants?: unknown[] } | null;
  lookupError?: boolean;
}): { ok: true; roomId: string; roomName: string; publicRoom: boolean } | { ok: false; error: string };

export function communityMember(
  userId: unknown,
  record: { [key: string]: any } | null
): { userId: string; role: string; learningLevel?: string; tradingLevel?: string };

export function decideCommunityMessageAccess(input: {
  member?: { userId?: string; role?: string; learningLevel?: string; tradingLevel?: string } | null;
  room?: { _id?: unknown; name?: string; type?: string; participants?: unknown[] } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; roomId: string; senderId: string } | { ok: false; status: 403 | 404 | 500; error: string };

export function decideCommunityMessageSend(input: {
  member?: { userId?: string; role?: string; learningLevel?: string; tradingLevel?: string } | null;
  room?: { _id?: unknown; name?: string; type?: string; participants?: unknown[] } | null;
  body?: { [key: string]: any } | null;
  lookupError?: boolean;
}): { ok: true; status: 201; roomId: string; message: { roomId: string; senderId: string; type: string; content: string; fileUrl: string | null; fileName: string | null; fileSize: number | null } } | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export function decideCommunityTyping(input: {
  member?: { userId?: string; role?: string; email?: string; learningLevel?: string; tradingLevel?: string } | null;
  roomId?: string;
  room?: { _id?: unknown; name?: string } | null;
  lookupError?: boolean;
}): { ok: true; channel: string; roomId: string; user: { userId: string; email: string } } | { ok: false; error: string };

export function decideConsultationTyping(input: {
  member?: { userId?: string; role?: AppRole; email?: string } | null;
  session?: { _id?: unknown; studentId?: string; expertId?: string } | null;
  lookupError?: boolean;
}): { ok: true; channel: string; sessionId: string; user: { userId: string; email: string } } | { ok: false; error: string };

export function clientSafeAuthError(error: { message?: string } | null): { status: 401 | 500; error: string };

export function decideLessonRoomAccess(input: {
  member?: { userId?: string; role?: string; email?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown; requiredLevel?: string | null } | null;
  course?: { _id?: unknown; instructorId?: unknown; difficulty?: string | null; status?: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  lookupError?: boolean;
}): { ok: true; lessonId: string; courseId: string; lessonChannel: string; courseChannel: string; user: { userId: string; email: string } } | { ok: false; error: string };

export function decideLessonChat(input: {
  member?: { userId?: string; role?: string; email?: string; name?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown; requiredLevel?: string | null } | null;
  course?: { _id?: unknown; instructorId?: unknown; difficulty?: string | null; status?: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  text?: unknown;
  lookupError?: boolean;
}): { ok: true; channel: string; lessonId: string; text: string; sender: { userId: string; senderName: string } } | { ok: false; error: string };

export function decideLessonRead(input: {
  member?: { userId?: string; role?: string; email?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown; requiredLevel?: string | null } | null;
  course?: { _id?: unknown; instructorId?: unknown; difficulty?: string | null; status?: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; lessonId: string } | { ok: false; status: 403 | 404 | 500; error: string };

export function decideLessonCatalog(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; courseId: string } | { ok: false; status: 403 | 404 | 500; error: string };

export function presentLessonRead(
  lesson: { [key: string]: any } | null,
  includeProtected: boolean,
  courseId?: string
): { [key: string]: any };

export function consultationLookupId(value: unknown): string;

export function decideConsultationPublisherToken(input: {
  member?: { userId?: string; role?: string } | null;
  session?: { _id?: unknown; studentId?: unknown; expertId?: unknown; status?: string } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; sessionId: string; channel: string; account: string; ttlSeconds: number } | { ok: false; status: 403 | 404 | 500; error: string };

export function consultationPublisherResponse(input: {
  decision: { ok: true; channel: string; account: string; ttlSeconds: number } | { ok: false; status: number; error: string };
  appId?: string;
  nowSeconds?: number;
  issue?: (input: { channel: string; account: string; privilegeExpireTime: number }) => string;
}): { ok: true; status: 200; body: { token: string; appId: string; channel: string; uid: string } } | { ok: false; status: number; error: string };

export function decideLessonMessageRead(input: {
  member?: { userId?: string; role?: string; email?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown; requiredLevel?: string | null } | null;
  course?: { _id?: unknown; instructorId?: unknown; difficulty?: string | null; status?: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; lessonId: string } | { ok: false; status: 403 | 404 | 500; error: string };

export function decideQuizMutation(input: {
  member?: { userId?: string; role?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  questions?: unknown;
  lookupError?: boolean;
}): { ok: true; status: 200; lessonId: string; courseId: string; questions: Array<{ question: string; options: string[]; correctAnswer: number }> } | { ok: false; status: number; error: string; code?: string; field?: string };

export function decideProgressUpdate(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; status?: unknown } | null;
  lesson?: { _id?: unknown; courseId?: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; userId: string; courseId: string; lessonId: string } | { ok: false; status: 403 | 404 | 500; error: string };

export function decideLessonDelete(input: {
  member?: { userId?: string; role?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; lessonId: string; courseId: string } | { ok: false; status: number; error: string; code?: string; field?: string };

export function isStoredId(value: unknown): value is string;

export function decideLessonUpdate(input: {
  member?: { userId?: string; role?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  patch?: { [key: string]: any } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; lessonId: string; courseId: string; patch: { [key: string]: any } } | { ok: false; status: number; error: string; code?: string; field?: string };

export function decideLessonCreate(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  body?: { [key: string]: any } | null;
  lookupError?: boolean;
}): { ok: true; status: 201; courseId: string; document: { [key: string]: any } } | { ok: false; status: number; error: string; code?: string; field?: string };

export function decideCourseCreate(input: {
  member?: { userId?: string; role?: string } | null;
  body?: { [key: string]: any } | null;
  assignee?: { userId?: string; role?: string; status?: string } | null;
  lookupError?: boolean;
}): { ok: true; status: 201; document: { title: string; description: string; category: string; difficulty: string; instructorId: string; thumbnail: string; status: string; freePreviewExplicit: boolean } } | { ok: false; status: number; error: string; code?: string; field?: string };

export function decideAssignmentRead(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; courseId: string; staff: boolean } | { ok: false; status: 403 | 404 | 500; error: string };

export function presentAssignment(
  assignment: { [key: string]: any },
  staff: boolean,
  submission?: { [key: string]: any } | null
): { [key: string]: any };

export function presentSubmission(submission: { [key: string]: any } | null): { [key: string]: any } | null;

export function decideAssignmentCreate(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  lesson?: { _id?: unknown; courseId?: unknown } | null;
  body?: { [key: string]: any } | null;
  lookupError?: boolean;
}): { ok: true; status: 201; document: { [key: string]: any } } | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export function decideAssignmentMutation(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  assignment?: { _id?: unknown; courseId?: unknown } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; assignmentId: string; courseId: string } | { ok: false; status: 403 | 404 | 500; error: string };

export function decideAssignmentSubmit(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  assignment?: { _id?: unknown; courseId?: unknown; lessonId?: unknown; points?: number } | null;
  body?: { [key: string]: any } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; userId: string; assignmentId: string; courseId: string; lessonId: unknown; submissionText: string; submissionFile: string | null; points: number } | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export function decideAssignmentGrade(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  assignment?: { _id?: unknown; courseId?: unknown; points?: number } | null;
  submission?: { _id?: unknown; assignmentId?: unknown; userId?: unknown } | null;
  grade?: unknown;
  feedback?: unknown;
  lookupError?: boolean;
}): { ok: true; status: 200; submissionId: string; userId: string; grade: number; feedback: string; gradedBy: string; points: number } | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export function decideCourseUpdate(input: {
  member?: { userId?: string; role?: string } | null;
  course?: { _id?: unknown; instructorId?: unknown; status?: unknown; [key: string]: unknown } | null;
  patch?: { [key: string]: any } | null;
  assignee?: { userId?: string; role?: string; status?: string } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; courseId: string; patch: { [key: string]: any } } | { ok: false; status: number; error: string; code?: string; field?: string };

export function decideCommunityPresence(input: {
  member?: { userId?: string; role?: string; learningLevel?: string; tradingLevel?: string } | null;
  rooms?: Array<{ _id?: unknown; name?: string }> | null;
  lookupError?: boolean;
}): { ok: true; userId: string; channels: string[] } | { ok: false; error: string };

export function presenceOfflineTargets(rooms: Iterable<unknown> | null | undefined): string[];

export function decideQuizRead(input: {
  member?: { userId?: string; role?: string; email?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown; requiredLevel?: string | null } | null;
  course?: { _id?: unknown; instructorId?: unknown; difficulty?: string | null; status?: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  quiz?: { questions?: Array<{ question?: string; options?: string[]; correctAnswer?: number }> } | null;
  lookupError?: boolean;
}): { ok: true; status: 200; lessonId: string; courseId: string; revealAnswers: boolean; questions: Array<{ question: string; options: string[]; correctAnswer?: number }> } | { ok: false; status: 403 | 404 | 500; error: string };

export function decideQuizSubmit(input: {
  member?: { userId?: string; role?: string; email?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown; requiredLevel?: string | null } | null;
  course?: { _id?: unknown; instructorId?: unknown; difficulty?: string | null; status?: unknown } | null;
  enrollment?: { userId?: unknown; courseId?: unknown; progress?: number } | null;
  quiz?: { questions?: Array<{ question?: string; options?: string[]; correctAnswer?: number }> } | null;
  answers?: unknown;
  lookupError?: boolean;
}): { ok: true; status: 200; lessonId: string; courseId: string; userId: string; score: number; correct: number; total: number; results: Array<{ question: string; userAnswer: unknown; correctAnswer: number | undefined; isCorrect: boolean }> } | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export function decideLessonStaffNotify(input: {
  member?: { userId?: string; role?: string; email?: string } | null;
  lesson?: { _id?: unknown; courseId?: unknown } | null;
  course?: { _id?: unknown; status?: unknown } | null;
  lookupError?: boolean;
}): { ok: true; lessonId: string; courseId: string; lessonChannel: string; courseChannel: string } | { ok: false; error: string };

export function canJoinConsultation(
  user: { userId: string; role: AppRole } | null,
  session: { studentId?: string; expertId?: string } | null
): boolean;

export function accountStatus(record: { status?: string | null } | null): string;

export type InputCheck<T> = { ok: true; fields: T } | { ok: false; status: 400; code: string; field: string; error: string };

export function checkCourseInput(
  body: unknown,
  options?: { partial?: boolean; current?: { [key: string]: unknown } | null }
): InputCheck<{ [key: string]: string }>;

export function checkLessonInput(body: unknown):
  | { ok: true; patch: { [key: string]: any } }
  | { ok: false; status: 400; code: string; field: string; error: string };

export function decideInstructorAssignee(
  requestedId: unknown,
  assignee: { userId?: string; role?: string; status?: string } | null | undefined
): { ok: true; instructorId: string } | { ok: false; status: 400; code: string; error: string };
