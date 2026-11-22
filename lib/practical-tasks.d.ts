/** Types for lib/practical-tasks.js, lib/practical-task-spec.js and the grading engine. The frontend's contract. */
import type { Db } from 'mongodb';

type Member = { userId: string; role: string; email?: string | null };
type Refusal = { ok: false; status: number; error: string; field?: string; code?: string; changes?: string[] };
type Notice = { userIds: string[]; type: 'task_created' | 'task_submission' | 'task_feedback'; title: string; message: string; roleTarget: 'student' | 'instructor'; taskId?: string; relatedId?: string; dedupeKey: string; metadata?: Record<string, unknown> };
type Ok<T> = ({ ok: true; status?: number; notify?: Notice | Notice[] | null } & T) | Refusal;

export type GradingMode = 'automatic' | 'manual' | 'assisted';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type TaskStatus = 'draft' | 'published' | 'closed' | 'archived';
export type AttemptStatus = 'in_progress' | 'submitted' | 'awaiting_grading' | 'awaiting_review' | 'graded' | 'returned';
export type StudentState = 'not_started' | 'in_progress' | 'awaiting_grading' | 'graded' | 'returned' | 'overdue' | 'closed';
export type ExternalPolicy = 'none' | 'optional' | 'required';
export type AutoCheck = 'trades_in_window' | 'trade_count' | 'instrument_match' | 'direction_match' | 'order_type_match' | 'stop_loss_valid' | 'take_profit_set' | 'reward_risk_min' | 'risk_within_limit' | 'trade_closed' | 'explanation_given' | 'net_result_positive';

export type Criterion = { id: string; kind: 'auto' | 'manual'; check?: AutoCheck | null; label: string; description: string; points: number };
export type Rubric = { version: number; maxScore: number; criteria: Criterion[] };
export type Requirements = {
  side: 'buy' | 'sell' | null;
  orderTypes: Array<'market' | 'limit' | 'stop'>;
  minTrades: number;
  maxTrades: number;
  maxRiskPercent: string;
  minRewardRisk: string;
  minExplanationChars: number;
  external: ExternalPolicy;
  maxAttachments: number;
  requireTakeProfit: boolean;
  requireClosed: boolean;
  simulator: boolean;
  instruments: string[];
  dueAt: string | null;
};

/** What the editor sends and the generator returns as `draft`. */
export type TaskDefinitionInput = {
  title: string;
  summary: string;
  instructions: string;
  objectives: string[];
  category: string;
  difficulty: Difficulty;
  instruments: string[];
  requirements: Partial<Omit<Requirements, 'instruments' | 'dueAt'>>;
  rubric: Array<{ kind: 'auto'; check: AutoCheck; points: number } | { kind: 'manual'; label: string; description: string; points: number }>;
  gradingMode?: GradingMode;
  maxAttempts: number;
  dueAt: string | null;
};

export type Block = { type: 'p'; text: string } | { type: 'list'; items: string[] };
export type StudentTaskView = {
  id: string; title: string; summary: string; instructions: string; objectives: string[]; category: string; categoryLabel: string; competency: string;
  difficulty: Difficulty; instruments: string[]; requirements: Requirements; rubric: Rubric; gradingMode: GradingMode; maxAttempts: number; dueAt: string | null;
  publishedAt: string | null; status: TaskStatus; courseId: string | null;
};
export type StaffTaskView = StudentTaskView & {
  lessonId: string | null; resources: Array<{ label: string; url: string }>; version: number;
  versions: Array<{ version: number; at: string | null; changes: string[]; rubricVersion: number; reason: string | null }>;
  recipients: number; audience: 'course' | 'students' | null; source: 'generated' | 'manual'; generator: Record<string, unknown> | null;
  createdAt: string | null; updatedAt: string | null; closedAt: string | null;
};

export type StateSummary = { state: StudentState; attemptsUsed: number; attemptsLeft: number; canStart: boolean; latestStatus: AttemptStatus | null; result: { score: number; maxScore: number; percent: string; attempt: number } | null; deadline: string | null };
export type StudentTaskCard = StateSummary & {
  id: string; title: string; summary: string; instructor: string; course: string | null; courseId: string | null; lessonId: string | null; category: string; competency: string; difficulty: Difficulty; instruments: string[];
  dueAt: string | null; gradingMode: GradingMode; maxScore: number; maxAttempts: number; publishedAt: string | null;
};
export type StudentSummary = {
  completed: number; pending: number; waiting: number; averagePercent: string | null;
  competencies: Array<{ id: string; percent: string; tasks: number }>;
  riskDiscipline: { met: number; checked: number; percent: string } | null;
  history: Array<{ taskId: string; title: string; attempt: number; percent: string; at: string | null }>;
};
export type StudentTaskList = { tasks: StudentTaskCard[]; counts: Record<'todo' | 'waiting' | 'graded' | 'overdue' | 'closed', number>; summary: StudentSummary };

export type TradeEvidence = {
  positionId: string; instrument: string; side: 'buy' | 'sell'; units: number; orderType: 'market' | 'limit' | 'stop' | null; entry: string | null; stopLoss: string | null; takeProfit: string | null;
  plannedRisk: string | null; status: string; exit: string | null; realizedPl: string | null; closeReason: string | null; openedAt: string | null; closedAt: string | null; startingBalance?: string | null;
};
export type ExternalEvidence = { broker?: string; instrument?: string; side?: 'buy' | 'sell'; entry?: string; exit?: string; stopLoss?: string; takeProfit?: string; openedAt?: string; closedAt?: string; notes?: string; verified: false };
export type CriterionResult = { id: string; label: string; kind: 'auto' | 'manual'; description: string; points: number; score: number | null; feedback: string | null; automated: { score: number | null; status: string; detail: string } | null; adjusted: boolean };
export type Feedback = { summary: string; strengths: string; mistakes: string; recommendations: string };
export type ResultView = {
  score: number | null; maxScore: number; percent: string | null; source: 'system' | 'instructor'; publishedAt: string | null; criteria: CriterionResult[]; feedback: Feedback | null;
  strengths: string[]; recommendations: string[]; observations: { risk: string[]; execution: string[] }; automatedVersion: string | null;
};
export type AttemptView = {
  id: string; attempt: number; status: AttemptStatus; gradingMode: GradingMode; rubricVersion: number; startedAt: string | null; submittedAt: string | null; gradedAt: string | null; returnedAt: string | null; resubmission: boolean;
  draft: { positionIds: string[]; explanation: string; external: ExternalEvidence | null } | null;
  explanation: string | null; external: ExternalEvidence | null; trades: TradeEvidence[]; attachments: Array<{ id: string; name: string; format: string | null; bytes: number | null; url: string }>; result: ResultView | null;
};
export type StudentTaskDetail = { task: StudentTaskView & { resources: Array<{ label: string; url: string }>; instructor: string; course: string | null; blocks: Block[] }; state: StateSummary; attempts: AttemptView[]; eligibleTrades: TradeEvidence[] };

export type TaskStats = { recipients: number; started: number; submitted: number; waiting: number; graded: number; submissionRate: string | null; completionRate: string | null; averagePercent: string | null };
export type StaffTaskRow = TaskStats & { id: string; title: string; status: TaskStatus; course: string | null; courseId: string; category: string; difficulty: Difficulty; instruments: string[]; gradingMode: GradingMode; maxScore: number; dueAt: string | null; publishedAt: string | null; updatedAt: string | null; source: string };
export type StaffTaskList = { tasks: StaffTaskRow[]; counts: Record<TaskStatus, number>; toGrade: number; pagination: { page: number; pages: number; total: number }; courses: Array<{ id: string; title: string }>; readOnly: boolean };
export type StaffTaskDetail = {
  task: StaffTaskView; course: { id: string; title: string } | null; stats: TaskStats;
  students: Array<{ id: string; name: string; state: StudentState; attemptsUsed: number; result: StateSummary['result']; latestAttemptId: string | null; submittedAt: string | null }>;
  missedCriteria: Array<{ id: string; label: string; assessed: number; missed: number }>;
  eligibleStudents: Array<{ id: string; name: string; assigned: boolean }>; attemptsExist: boolean; readOnly: boolean;
};
export type QueueRow = { id: string; taskId: string; task: string; student: string; studentId: string; attempt: number; status: AttemptStatus; gradingMode: GradingMode; submittedAt: string | null; late: boolean; score: number | null; maxScore: number; suggested: boolean };
export type StaffQueue = { rows: QueueRow[]; counts: Record<'pending' | 'graded' | 'returned', number>; pagination: { page: number; pages: number; total: number }; tasks: Array<{ id: string; title: string }> };
export type AutoResult = { engine: string; version: string; criteria: Array<Criterion & { score: number | null; status: string; detail: string }>; autoScore: number; autoMax: number; score: number | null; maxScore: number; percent: string | null; complete: boolean; strengths: string[]; recommendations: string[]; observations: { risk: string[]; execution: string[] }; fingerprint: string };
export type StaffAttempt = {
  readOnly: boolean; task: StaffTaskView; student: { id: string; name: string; level: string | null };
  attempt: AttemptView & { revision: number; rubric: Rubric; requirements: Requirements; autoResult: AutoResult | null; grade: { score: number | null; criteria: Array<{ id: string; score: number; feedback: string | null }>; feedback: Feedback | null; source: string } | null; history: Array<{ at: string | null; by: string; role: string; action: string; score: number | null; maxScore: number | null; reason: string | null; engine: string | null }> };
  previous: Array<{ id: string; attempt: number; status: AttemptStatus; score: number | null; maxScore: number | null; submittedAt: string | null }>;
};
export type StaffSummary = { tasks: number; published: number; assignedStudents: number; modes: Record<GradingMode, number>; toGrade: number; gradedAttempts: number; averagePercent: string | null };

export const SCHEMA: 'practical_v2';
export const RETURN_GRACE_MS: number;
export const MAX_RECIPIENTS: number;
export function attemptId(taskId: string, studentId: string, n: number): string;
export function taskForStaff(db: Db, member: Member, taskId: string, options?: { write?: boolean }): Promise<Ok<{ task: Record<string, unknown>; course?: unknown; readOnly?: boolean }>>;
export function taskForStudent(db: Db, member: Member, taskId: string): Promise<Ok<{ task: Record<string, unknown> }>>;
export function previewGenerated(member: Member, params: Record<string, unknown>, options?: { now?: Date; context?: { price: string } | null }): Promise<Ok<{ draft: TaskDefinitionInput; task: StaffTaskView; notice: string | null; generator: Record<string, unknown> }>>;
export function saveTask(db: Db, member: Member, args: { taskId?: string; body?: Record<string, unknown>; now?: Date }): Promise<Ok<{ task: StaffTaskView }>>;
export function discardDraft(db: Db, member: Member, args: { taskId: string; now?: Date }): Promise<Ok<Record<string, never>>>;
export function publishTask(db: Db, member: Member, args: { taskId: string; body?: Record<string, unknown>; now?: Date }): Promise<Ok<{ added: number; recipients: number; task: StaffTaskView }>>;
export function changeTaskStatus(db: Db, member: Member, args: { taskId: string; action: string; now?: Date }): Promise<Ok<{ taskStatus: TaskStatus }>>;
export function studentTasks(db: Db, member: Member, args?: { group?: string; now?: Date }): Promise<Ok<StudentTaskList>>;
export function studentTaskDetail(db: Db, member: Member, args: { taskId: string; now?: Date }): Promise<Ok<StudentTaskDetail>>;
export function startAttempt(db: Db, member: Member, args: { taskId: string; now?: Date }): Promise<Ok<{ attempt: AttemptView; repeated?: boolean }>>;
export function saveDraft(db: Db, member: Member, args: { taskId: string; body?: Record<string, unknown>; now?: Date }): Promise<Ok<{ savedAt: string }>>;
export function addAttachment(db: Db, member: Member, args: { taskId: string; file: { publicId: string; format?: string; bytes?: number; width?: number; height?: number; name?: string; delivery?: string }; now?: Date }): Promise<Ok<{ attachment: { id: string; name: string; url: string } }>>;
export function removeAttachment(db: Db, member: Member, args: { taskId: string; fileId: string; now?: Date }): Promise<Ok<{ removed: string }>>;
export function evidenceFile(db: Db, member: Member, args: { attempt: string; file: string }): Promise<Ok<{ publicId: string; format: string; delivery: string }>>;
export function submitAttempt(db: Db, member: Member, args: { taskId: string; body?: Record<string, unknown>; now?: Date }): Promise<Ok<{ attempt: AttemptView }>>;
export function finishPending(db: Db, attempt: Record<string, unknown>, task: Record<string, unknown>, now?: Date): Promise<Record<string, unknown>>;
export function staffTasks(db: Db, member: Member, args?: { status?: string; courseId?: string; q?: string; page?: number; limit?: number }): Promise<Ok<StaffTaskList>>;
export function staffTaskDetail(db: Db, member: Member, args: { taskId: string; now?: Date }): Promise<Ok<StaffTaskDetail>>;
export function staffQueue(db: Db, member: Member, args?: { filter?: string; taskId?: string; courseId?: string; studentId?: string; mode?: string; from?: string; to?: string; page?: number; limit?: number }): Promise<Ok<StaffQueue>>;
export function staffAttempt(db: Db, member: Member, args: { attemptId: string; now?: Date }): Promise<Ok<StaffAttempt>>;
export function gradeAttempt(db: Db, member: Member, args: { attemptId: string; body?: Record<string, unknown>; now?: Date }): Promise<Ok<{ attempt: AttemptStatus; revision: number; grade?: { score: number; maxScore: number; percent: string } }>>;
export function staffSummary(db: Db, member: Member): Promise<Ok<StaffSummary>>;
export function studentState(task: Record<string, unknown>, attempts: Array<Record<string, unknown>>, now?: Date): StateSummary;
export function readExternal(input: unknown): Ok<{ external: ExternalEvidence | null }>;
export function enrolledStudents(db: Db, courseId: string): Promise<Array<{ id: string; name: string }>>;
export function attachmentSlot(db: Db, member: Member, args: { taskId: string }): Promise<Ok<Record<string, never>>>;
export function previewDefinition(member: Member, body?: Record<string, unknown>, options?: { now?: Date }): Ok<{ task: StaffTaskView; blocks: Block[] }>;
