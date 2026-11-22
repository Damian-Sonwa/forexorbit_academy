/**
 * AI Service
 * Server-side AI integration using OpenAI API
 * Handles prompt building, role-aware responses, rate limiting, and error handling
 * IMPORTANT: Only runs on Render backend, never on Vercel frontend
 */

import OpenAI from 'openai';
import { ProviderError, chatText, resolveProvider } from '@/lib/ai-provider';

interface AIConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface AIRequest {
  prompt: string;
  context?: Record<string, unknown>;
  role?: 'student' | 'instructor' | 'admin';
  level?: 'beginner' | 'intermediate' | 'advanced';
  maxTokens?: number;
  temperature?: number;
}

// Global OpenAI client instance (initialized only on backend)
let openaiClient: OpenAI | null = null;

// Cache for AI responses (in-memory, can be upgraded to Redis)
const responseCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Rate limiting (in-memory, per user)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 1000 * 60; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per user

/**
 * Check if we're running on the backend (server-side)
 * AI should NEVER run on Vercel frontend, only on Render backend
 */
function isBackend(): boolean {
  return typeof window === 'undefined' && typeof process !== 'undefined';
}

/**
 * Get AI configuration from environment variables
 * Only works on server-side (Render backend)
 */
function getAIConfig(): AIConfig | null {
  // CRITICAL: Only allow on server-side (backend)
  if (!isBackend()) {
    console.warn('AI service called from frontend - this should never happen');
    return null;
  }
  // The provider (Groq, Cloudflare Workers AI, OpenAI, Ollama or another compatible server) comes
  // from the same settings as AI lesson development (lib/ai-provider.js). Before, any key starting
  // with "sk-" counted as configured and requests always went to OpenAI with gpt-3.5-turbo.
  const provider = resolveProvider();
  if (!provider.ok) {
    console.warn('[AI] No AI provider configured. AI features will be disabled.');
    return null;
  }
  return {
    apiKey: provider.key,
    baseURL: provider.baseUrl,
    model: process.env.AI_MODEL || provider.model,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '500', 10),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
  };
}

/**
 * Initialize OpenAI client (only on backend)
 */
function getOpenAIClient(): OpenAI | null {
  // CRITICAL: Only initialize on server-side
  if (!isBackend()) {
    return null;
  }

  // Return cached client if already initialized
  if (openaiClient) {
    return openaiClient;
  }

  const config = getAIConfig();
  if (!config) {
    return null;
  }

  try {
    openaiClient = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    console.log('[AI] OpenAI client initialized successfully');
    return openaiClient;
  } catch (error) {
    console.error('[AI] Failed to initialize OpenAI client:');
    return null;
  }
}

/**
 * Check if AI is configured
 * Only returns true if running on backend with valid API key
 */
export function isAIConfigured(): boolean {
  if (!isBackend()) {
    return false;
  }
  return resolveProvider().ok;
}

/**
 * Check rate limit for a user
 */
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (userLimit.count >= RATE_LIMIT_MAX) {
    return false;
  }

  userLimit.count++;
  return true;
}

/**
 * Generate cache key from request
 */
function generateCacheKey(request: AIRequest): string {
  return `${request.role || 'default'}_${request.level || 'default'}_${request.prompt.substring(0, 100)}`;
}

/**
 * Check cache for existing response
 */
function getCachedResponse(cacheKey: string): string | null {
  const cached = responseCache.get(cacheKey);
  if (!cached) return null;

  const now = Date.now();
  if (now > cached.timestamp + CACHE_TTL) {
    responseCache.delete(cacheKey);
    return null;
  }

  return cached.response;
}

/**
 * Store response in cache
 */
function setCachedResponse(cacheKey: string, response: string): void {
  responseCache.set(cacheKey, { response, timestamp: Date.now() });
}

/**
 * Build system prompt based on role and level
 */
function buildSystemPrompt(role?: string, level?: string): string {
  let systemPrompt = 'You are a helpful AI assistant for a Forex trading education platform. ';

  if (role === 'student') {
    systemPrompt += 'You are helping students learn Forex trading. ';
    if (level === 'beginner') {
      systemPrompt += 'Use simple language and explain concepts clearly. Avoid jargon. ';
    } else if (level === 'intermediate') {
      systemPrompt += 'You can use more technical terms but still explain them. ';
    } else if (level === 'advanced') {
      systemPrompt += 'You can use advanced terminology and concepts. ';
    }
  } else if (role === 'instructor') {
    systemPrompt += 'You are helping instructors analyze student performance and provide insights. ';
  }

  systemPrompt += 'IMPORTANT: This is a demo/educational platform only. Do not provide real-money trading advice. ';
  systemPrompt += 'Focus on educational explanations and learning guidance.';

  return systemPrompt;
}

/**
 * Call OpenAI API using the official OpenAI client
 * Only works on backend (Render)
 */
async function callOpenAI(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens?: number,
  temperature?: number
): Promise<AIResponse> {
  // CRITICAL: Ensure we're on backend
  if (!isBackend()) {
    throw new Error('AI service can only be called from server-side (backend)');
  }

  // The same connector as lesson development (lib/ai-provider.js): Groq, Cloudflare, OpenAI, Ollama
  // or another compatible server, with automatic replacement of a retired model and low reasoning
  // effort for reasoning models. AI_MODEL still chooses the model when the provider is OpenAI.
  const provider = resolveProvider();
  const env = provider.ok && provider.id === 'openai' && process.env.AI_MODEL && !process.env.AI_LESSON_MODEL
    ? { ...process.env, AI_LESSON_MODEL: process.env.AI_MODEL }
    : process.env;
  try {
    const answer = await chatText({
      system: systemPrompt,
      user: userPrompt,
      // Reasoning models spend part of the budget thinking; leave room for the answer itself.
      maxTokens: Math.max(1200, (maxTokens || config.maxTokens || 500) * 2),
      temperature: temperature ?? config.temperature,
      env,
    });
    return {
      content: answer.content,
      usage: { promptTokens: answer.usage.promptTokens, completionTokens: answer.usage.completionTokens, totalTokens: answer.usage.promptTokens + answer.usage.completionTokens },
    };
  } catch (error: unknown) {
    const failure = error instanceof ProviderError ? error : new ProviderError('unavailable', 'The AI assistant is not available right now. Try again later.');
    console.error(JSON.stringify({ event: 'aiAssistant', result: 'failed', code: failure.code, status: failure.status }));
    throw failure;
  }
}

/**
 * The HTTP answer for an AI failure: provider problems (configuration, quota, model, timeout) get a
 * 503 with a message people can act on; anything else stays a generic 500 with a request id.
 */
export function aiFailure(error: unknown): { status: number; body: { error: string; code: string } } | null {
  if (error instanceof ProviderError) {
    const status = error.code === 'rate_limited' ? 429 : 503;
    return { status, body: { error: error.message, code: `ai_${error.code}` } };
  }
  if (error instanceof Error && /Rate limit exceeded/.test(error.message)) {
    return { status: 429, body: { error: 'Too many AI requests. Try again in a minute.', code: 'ai_rate_limited' } };
  }
  return null;
}

/**
 * Main AI service function
 */
export async function getAIResponse(request: AIRequest): Promise<string> {
  // Check if AI is configured
  const config = getAIConfig();
  if (!config) {
    throw new Error('AI service is not configured. Please set AI_API_KEY environment variable.');
  }

  // Check rate limit (if userId is provided in context)
  const userId = request.context?.userId as string | undefined;
  if (userId && typeof userId === 'string' && !checkRateLimit(userId)) {
    throw new Error('Rate limit exceeded. Please try again in a minute.');
  }

  // Check cache
  const cacheKey = generateCacheKey(request);
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Build system prompt
    const systemPrompt = buildSystemPrompt(request.role, request.level);

    // Call OpenAI
    const aiResponse = await callOpenAI(
      config,
      systemPrompt,
      request.prompt,
      request.maxTokens,
      request.temperature
    );

    // Cache response
    setCachedResponse(cacheKey, aiResponse.content);

    return aiResponse.content;
  } catch (error) {
    console.error('AI service error:');
    throw error;
  }
}

/**
 * Get AI explanation for a lesson
 */
export async function explainLesson(
  lessonTitle: string,
  lessonContent: string,
  userLevel?: string,
  userId?: string
): Promise<string> {
  const prompt = `Explain this Forex trading lesson in a clear and engaging way:

Title: ${lessonTitle}

Content: ${lessonContent}

Please provide:
1. A simple summary of the main concepts
2. Key takeaways
3. Why this is important for Forex trading
4. Any common mistakes to avoid

Keep it concise and educational.`;

  return getAIResponse({
    prompt,
    role: 'student',
    level: userLevel as 'beginner' | 'intermediate' | 'advanced' | undefined,
    context: userId ? { userId } : undefined,
  });
}

/**
 * Get AI feedback for a demo trade
 */
export async function analyzeTrade(
  tradeData: {
    pair: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
    notes?: string;
  },
  userId?: string
): Promise<{
  strengths: string[];
  mistakes: string[];
  suggestions: string[];
  riskReward: string;
}> {
  const risk = Math.abs(tradeData.entryPrice - tradeData.stopLoss);
  const reward = Math.abs(tradeData.takeProfit - tradeData.entryPrice);
  const riskRewardRatio = reward / risk;

  const prompt = `Analyze this demo Forex trade and provide educational feedback:

Currency Pair: ${tradeData.pair}
Direction: ${tradeData.direction.toUpperCase()}
Entry Price: ${tradeData.entryPrice}
Stop Loss: ${tradeData.stopLoss}
Take Profit: ${tradeData.takeProfit}
Lot Size: ${tradeData.lotSize}
Risk-to-Reward Ratio: ${riskRewardRatio.toFixed(2)}:1
Notes: ${tradeData.notes || 'None'}

Please provide:
1. 2-3 strengths of this trade setup
2. 2-3 potential mistakes or areas for improvement
3. 2-3 actionable suggestions for better trading
4. A brief assessment of the risk-to-reward ratio

Format your response as JSON with keys: strengths, mistakes, suggestions, riskReward.
Each value should be an array of strings (except riskReward which is a string).

IMPORTANT: This is educational feedback only. Do not provide real trading advice.`;

  try {
    const response = await getAIResponse({
      prompt,
      role: 'student',
      context: userId ? { userId } : undefined,
      temperature: 0.5, // Lower temperature for more consistent analysis
    });

    // Try to parse JSON response
    try {
      const parsed = JSON.parse(response);
      return {
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [parsed.strengths || 'Good trade setup'],
        mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes : [parsed.mistakes || 'Consider reviewing risk management'],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [parsed.suggestions || 'Continue practicing'],
        riskReward: parsed.riskReward || `Risk-to-reward ratio of ${riskRewardRatio.toFixed(2)}:1 is ${riskRewardRatio >= 2 ? 'good' : 'could be improved'}`,
      };
    } catch {
      // If JSON parsing fails, return structured text response
      return {
        strengths: ['Trade setup shows understanding of basic concepts'],
        mistakes: ['Review risk management principles'],
        suggestions: ['Continue practicing and learning'],
        riskReward: response.substring(0, 200),
      };
    }
  } catch (error) {
    console.error('AI trade analysis error:');
    throw error;
  }
}

/**
 * Feedback on a reviewed practice-desk trade (lib/trading/reviews.js). The trade's figures come from
 * the simulator as recorded by the server (exact decimal strings), never typed by the student; the
 * reflection is the student's. Educational feedback on the process, not trading advice.
 */
export async function analyzeTradeReview(
  review: {
    trade: { instrument: string; side: string; units: string; entry: string; exit: string | null; stopLoss: string; takeProfit: string | null; realizedPl: string | null; closeReason: string | null; planNote: string | null };
    setup: string;
    followedPlan: string;
    confidence: number;
    emotion: string | null;
    reason: string;
    lesson: string;
  },
  userId?: string
): Promise<{ strengths: string[]; mistakes: string[]; suggestions: string[]; riskReward: string }> {
  const t = review.trade;
  const closed: Record<string, string> = { manual: 'closed by the student', stop_loss: 'stop-loss hit', take_profit: 'take-profit hit', stop_out: 'stopped out by the margin rule' };
  const prompt = `Give educational feedback on a student's reviewed trade from a practice simulator (virtual funds, simulated prices).

Recorded by the simulator:
- Pair: ${t.instrument.replace('_', '/')}, ${t.side.toUpperCase()} ${t.units} units
- Entry ${t.entry}, exit ${t.exit ?? 'n/a'}, stop-loss ${t.stopLoss}, take-profit ${t.takeProfit ?? 'none'}
- Result ${t.realizedPl ?? 'n/a'} USD, ${closed[t.closeReason || ''] || 'closed'}
- Plan note written before the trade: ${t.planNote || 'none'}

The student's review:
- Setup: ${review.setup}
- Followed the plan: ${review.followedPlan}
- Confidence (1-5): ${review.confidence}${review.emotion ? `, emotion: ${review.emotion}` : ''}
- Why they entered: ${review.reason}
- Lesson / what they would change: ${review.lesson}

Focus on the process (planning, stop placement, discipline, whether the reasoning matches what happened), not on whether it made money.
Respond as JSON with keys strengths, mistakes, suggestions (arrays of 2-3 short strings) and riskReward (one sentence on the stop and target placement).
IMPORTANT: Educational feedback only. Do not give real trading advice.`;

  const response = await getAIResponse({ prompt, role: 'student', context: userId ? { userId } : undefined, temperature: 0.4 });
  try {
    const parsed = JSON.parse(response);
    const list = (value: unknown, fallback: string) => (Array.isArray(value) ? value.map(String).slice(0, 4) : [String(value || fallback)]);
    return {
      strengths: list(parsed.strengths, 'You reviewed the trade, which is the habit that matters most.'),
      mistakes: list(parsed.mistakes, 'Compare your plan note with what you actually did.'),
      suggestions: list(parsed.suggestions, 'Keep reviewing every closed trade.'),
      riskReward: String(parsed.riskReward || '').slice(0, 300),
    };
  } catch {
    return {
      strengths: ['You reviewed the trade, which is the habit that matters most.'],
      mistakes: ['Compare your plan note with what you actually did.'],
      suggestions: ['Keep reviewing every closed trade.'],
      riskReward: response.substring(0, 200),
    };
  }
}

/**
 * Get AI hint for a demo task
 */
export async function getTaskHint(
  taskTitle: string,
  taskDescription: string,
  taskLevel?: string,
  userId?: string
): Promise<string> {
  const prompt = `A student is working on this demo trading task:

Title: ${taskTitle}
Description: ${taskDescription}
Level: ${taskLevel || 'beginner'}

Provide a helpful hint that:
1. Guides them in the right direction
2. Explains the concept they should focus on
3. Does NOT give away the answer directly
4. Is appropriate for their level (${taskLevel || 'beginner'})

Keep it concise (2-3 sentences).`;

  return getAIResponse({
    prompt,
    role: 'student',
    level: taskLevel as 'beginner' | 'intermediate' | 'advanced' | undefined,
    context: userId ? { userId } : undefined,
    temperature: 0.7,
  });
}

/**
 * Get AI answer to a general question
 */
export async function answerQuestion(
  question: string,
  userLevel?: string,
  userId?: string
): Promise<string> {
  const prompt = `Answer this Forex trading question clearly and concisely:

Question: ${question}

Provide a helpful, educational answer that:
1. Directly addresses the question
2. Uses appropriate language for ${userLevel || 'beginner'} level
3. Includes examples if helpful
4. Emphasizes this is for educational/demo purposes only

Keep it under 200 words.`;

  return getAIResponse({
    prompt,
    role: 'student',
    level: userLevel as 'beginner' | 'intermediate' | 'advanced' | undefined,
    context: userId ? { userId } : undefined,
  });
}

/**
 * Analyze student performance for instructors
 */
export async function analyzeStudentPerformance(
  studentData: {
    name: string;
    email: string;
    level?: string;
    totalTrades?: number;
    winRate?: number;
    averageProfitLoss?: number;
    completedTasks?: number;
    pendingTasks?: number;
    averageGrade?: number;
    /** Practice desk trade reviews (lib/trading/reviews.js). */
    reviewedTrades?: number;
    planFollowedRate?: number | null;
    recentSubmissions?: Array<{
      taskTitle: string;
      grade?: number;
      submittedAt: string;
    }>;
  },
  userId?: string
): Promise<{
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendations: string[];
}> {
  const prompt = `Analyze this student's performance and provide insights for an instructor:

Student: ${studentData.name} (${studentData.email})
Level: ${studentData.level || 'Unknown'}
Closed practice trades (recorded by the simulator): ${studentData.totalTrades || 0}
Win Rate: ${studentData.winRate ? (studentData.winRate * 100).toFixed(1) + '%' : 'N/A'}
Average P/L: ${studentData.averageProfitLoss ? `$${studentData.averageProfitLoss.toFixed(2)}` : 'N/A'}
Completed Tasks: ${studentData.completedTasks || 0}
Pending Tasks: ${studentData.pendingTasks || 0}
Average Grade: ${studentData.averageGrade ? studentData.averageGrade.toFixed(1) : 'N/A'}
Trades reviewed by the student: ${studentData.reviewedTrades ?? 0}
Plan followed (in reviews): ${typeof studentData.planFollowedRate === 'number' ? (studentData.planFollowedRate * 100).toFixed(0) + '%' : 'N/A'}
Recent Submissions: ${studentData.recentSubmissions?.length || 0}

Please provide:
1. A brief summary of overall performance (2-3 sentences)
2. 2-3 key strengths
3. 2-3 areas of concern (if any)
4. 2-3 actionable recommendations for the instructor

Format your response as JSON with keys: summary, strengths, concerns, recommendations.
Each value should be an array of strings (except summary which is a string).

Be constructive and educational.`;

  try {
    const response = await getAIResponse({
      prompt,
      role: 'instructor',
      context: userId ? { userId } : undefined,
      temperature: 0.6,
      maxTokens: 800,
    });

    try {
      const parsed = JSON.parse(response);
      return {
        summary: parsed.summary || 'Student is making progress in their Forex trading education.',
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [parsed.strengths || 'Good engagement'],
        concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [parsed.recommendations || 'Continue monitoring progress'],
      };
    } catch {
      return {
        summary: response.substring(0, 200),
        strengths: ['Active participation'],
        concerns: [],
        recommendations: ['Continue providing guidance'],
      };
    }
  } catch (error) {
    console.error('AI student performance analysis error:');
    throw error;
  }
}

/**
 * Draft feedback for a student submission
 */
export async function draftFeedback(
  submissionData: {
    taskTitle: string;
    taskDescription: string;
    studentReasoning: string;
    studentLevel?: string;
  },
  userId?: string
): Promise<string> {
  const prompt = `Draft constructive feedback for a student's task submission:

Task: ${submissionData.taskTitle}
Description: ${submissionData.taskDescription}
Student Level: ${submissionData.studentLevel || 'beginner'}

Student's Reasoning/Analysis:
${submissionData.studentReasoning}

Please draft feedback that:
1. Acknowledges what the student did well
2. Provides constructive criticism
3. Offers specific suggestions for improvement
4. Is encouraging and educational
5. Is appropriate for ${submissionData.studentLevel || 'beginner'} level

Keep it professional, supportive, and actionable (3-4 sentences).`;

  return getAIResponse({
    prompt,
    role: 'instructor',
    context: userId ? { userId } : undefined,
    temperature: 0.7,
    maxTokens: 300,
  });
}

/**
 * Get lesson improvement suggestions
 */
export async function suggestLessonImprovements(
  lessonData: {
    title: string;
    content: string;
    studentFeedback?: Array<{
      rating?: number;
      comment?: string;
    }>;
    completionRate?: number;
    averageScore?: number;
  },
  userId?: string
): Promise<{
  suggestions: string[];
  strengths: string[];
  improvements: string[];
}> {
  const prompt = `Analyze this lesson and suggest improvements:

Lesson Title: ${lessonData.title}
Content Preview: ${lessonData.content.substring(0, 500)}...
Completion Rate: ${lessonData.completionRate ? (lessonData.completionRate * 100).toFixed(1) + '%' : 'N/A'}
Average Score: ${lessonData.averageScore ? lessonData.averageScore.toFixed(1) : 'N/A'}
Student Feedback: ${lessonData.studentFeedback?.length || 0} reviews

Please provide:
1. 2-3 strengths of the current lesson
2. 2-3 specific improvement suggestions
3. 1-2 actionable recommendations

Format your response as JSON with keys: strengths, improvements, suggestions.
Each value should be an array of strings.

Be constructive and focused on enhancing learning outcomes.`;

  try {
    const response = await getAIResponse({
      prompt,
      role: 'instructor',
      context: userId ? { userId } : undefined,
      temperature: 0.6,
      maxTokens: 600,
    });

    try {
      const parsed = JSON.parse(response);
      return {
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [parsed.strengths || 'Well-structured content'],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [parsed.improvements || 'Consider adding more examples'],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [parsed.suggestions || 'Continue refining based on student feedback'],
      };
    } catch {
      return {
        strengths: ['Good content structure'],
        improvements: ['Consider adding more practical examples'],
        suggestions: ['Gather more student feedback'],
      };
    }
  } catch (error) {
    console.error('AI lesson improvement suggestions error:');
    throw error;
  }
}
