/**
 * AI Service
 * Server-side AI integration using OpenAI API
 * Handles prompt building, role-aware responses, rate limiting, and error handling
 */

interface AIConfig {
  apiKey: string;
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

// Cache for AI responses (in-memory, can be upgraded to Redis)
const responseCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Rate limiting (in-memory, per user)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 1000 * 60; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute per user

/**
 * Get AI configuration from environment variables
 */
function getAIConfig(): AIConfig | null {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    console.warn('AI_API_KEY not configured. AI features will be disabled.');
    return null;
  }

  return {
    apiKey,
    model: process.env.AI_MODEL || 'gpt-3.5-turbo',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '500', 10),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
  };
}

/**
 * Check if AI is configured
 */
export function isAIConfigured(): boolean {
  return !!process.env.AI_API_KEY;
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
 * Call OpenAI API
 */
async function callOpenAI(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens?: number,
  temperature?: number
): Promise<AIResponse> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens || config.maxTokens,
      temperature: temperature || config.temperature,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`OpenAI API error: ${error.error?.message || 'Failed to get AI response'}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || 'No response generated',
    usage: data.usage,
  };
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
    console.error('AI service error:', error);
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
    level: userLevel as any,
    context: { userId },
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
      context: { userId },
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
    console.error('AI trade analysis error:', error);
    throw error;
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
    level: userLevel as any,
    context: { userId },
  });
}

