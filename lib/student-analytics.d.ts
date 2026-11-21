/** Types for lib/student-analytics.js (Phase 11). Also the frontend's contract for the dashboard. */
import type { Db } from 'mongodb';
import type { LearningStats } from './learning-activity';

export type Range = '7' | '30' | '90' | 'all';

export type Overview = {
  enrolled: number;
  completedCourses: number;
  inProgressCourses: number;
  notStartedCourses: number;
  completedLessons: number;
  totalLessons: number;
  overallPercent: number | null;
};

export type CourseCard = {
  courseId: string;
  title: string;
  thumbnail: string | null;
  difficulty: string | null;
  category: string | null;
  archived: boolean;
  status: 'completed' | 'in_progress' | 'not_started';
  percent: number;
  completedLessons: number;
  totalLessons: number;
  completedAt: string | null;
  lastStudiedAt: string | null;
  lastLesson: { lessonId: string; title: string } | null;
  href: string;
  action: 'review' | 'start' | 'continue';
};

export type SeriesBucket = { key: string; minutes: number; lessons: number };
export type LearningSeries = {
  range: Range;
  granularity: 'day' | 'month';
  timezone: string;
  buckets: SeriesBucket[];
  totals: { minutes: number; lessons: number; activeDays: number };
  undatedCompletions: number;
};

export type ScoreView = {
  id: string;
  lessonId: string;
  courseId: string;
  lessonTitle: string | null;
  courseTitle: string | null;
  percent: number;
  passed: boolean | null;
  attemptNumber: number | null;
  finishedAt: string | null;
  href: string | null;
};
export type AssessmentPerformance = {
  attempts: number;
  scanned: number;
  quizzesAttempted: number;
  quizzesPassed: number;
  passRate: number | null;
  averagePercent: number | null;
  bestPercent: number | null;
  recent: ScoreView[];
  trend: Array<{ at: string | null; percent: number; passed: boolean | null }>;
  firstPassedAt: string | null;
};

export type UpcomingItem = {
  kind: 'quiz' | 'assignment';
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  lessonId: string | null;
  lessonTitle: string | null;
  status: 'in_progress' | 'opens_soon' | 'retake_available' | 'not_started' | 'overdue' | 'not_submitted';
  opensAt: string | null;
  dueAt: string | null;
  attemptsUsed?: number;
  attemptsRemaining?: number | null;
  maxAttempts?: number | null;
  timeLimitMinutes?: number | null;
  passingPercent?: number | null;
  bestPercent?: number | null;
  points?: number | null;
  href: string;
};

export type Milestone = {
  id: string;
  title: string;
  description: string;
  achieved: boolean;
  at: string | null;
  progress?: { current: number; target: number };
};

export type Recommendation = { id: string; kind: 'learn' | 'assess' | 'practice'; title: string; reason: string; href: string; action: string };

export type ActivityEvent = {
  id: string;
  type: 'course_started' | 'course_completed' | 'lesson_completed' | 'quiz_finished' | 'assignment_submitted' | 'certificate_earned' | 'trade_closed';
  at: string;
  title: string;
  detail: string | null;
  href: string | null;
};

export type TradeView = {
  id: string;
  instrument: string;
  side: string;
  units: string;
  entry: string;
  stopLoss: string;
  takeProfit: string | null;
  status: string;
  currentPrice: string | null;
  unrealizedPl: string | null;
  exit: string | null;
  realizedPl: string | null;
  closeReason: string | null;
  openedAt: string | null;
  closedAt: string | null;
};
export type TradingPerformance = {
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: string | null;
  netRealized: string;
  grossProfit: string;
  grossLoss: string;
  averageWin: string | null;
  averageLoss: string | null;
  bestTrade: string | null;
  worstTrade: string | null;
  closeReasons: Record<string, number>;
  byInstrument: Array<{ instrument: string; trades: number; wins: number; losses: number; winRate: string | null; net: string }>;
  series: Array<{ day: string; trades: number; net: string; cumulative: string }>;
};
export type TradingOverview = {
  account: {
    id: string;
    virtual: true;
    currency: string;
    startingBalance: string;
    balance: string;
    equity: string | null;
    usedMargin: string;
    freeMargin: string | null;
    marginLevel: string | null;
    unrealizedPl: string | null;
    marginCall: boolean;
    leverage: string;
  };
  openPositions: number;
  pendingOrders: number;
  positions: TradeView[];
  market: { label: string; open: boolean };
} | null;
export type TradingSection = {
  simulated: true;
  marketLabel: string;
  hasAccount: boolean;
  overview: TradingOverview;
  performance: TradingPerformance;
  reviews: { reviewed: number; pending: number };
  recent: TradeView[];
};

export type StudentDashboard = {
  generatedAt: string;
  student: { firstName: string | null };
  overview: Overview;
  continue: { courseId: string; courseTitle: string; lessonId: string | null; lessonTitle: string | null; reason: string; percent: number; href: string; lastStudiedAt: string | null } | null;
  courses: CourseCard[];
  learning: LearningStats & { series: LearningSeries };
  assessments: AssessmentPerformance;
  upcoming: { items: UpcomingItem[]; total: number; retakes: number };
  milestones: Milestone[];
  certificates: number;
  recommendations: Recommendation[];
  activity: { events: ActivityEvent[]; hasMore: boolean };
  trading: TradingSection;
};
export type ActivityPage = { events: ActivityEvent[]; page: number; limit: number; hasMore: boolean; window: number };

export const ACTIVITY_WINDOW: number;
export const RANGES: Readonly<Record<Range, number | null>>;
export function parseRange(value: unknown): Range;
export function studentDashboard(db: Db, input: { userId: string; name?: string | null; now?: Date; env?: Record<string, string | undefined>; range?: Range }): Promise<StudentDashboard>;
export function studentLearningSeries(db: Db, input: { userId: string; range?: Range; now?: Date }): Promise<LearningSeries>;
export function studentActivity(db: Db, input: { userId: string; page?: number; limit?: number; now?: Date }): Promise<ActivityPage>;
export function studentTrading(db: Db, input: { userId: string; now?: Date; env?: Record<string, string | undefined> }): Promise<TradingSection & { accounts: number; firstClosedAt: string | null }>;
