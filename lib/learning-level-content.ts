/**
 * Learning Level Content Configuration
 * Maps learning levels to personalized "What You Will Gain" content
 * This configuration is separate from UI components for maintainability
 */

export type LearningLevel = 'beginner' | 'intermediate' | 'advanced';

export interface LearningGainItem {
  icon: string;
  title: string;
  description: string;
}

export interface LearningLevelContent {
  level: LearningLevel;
  displayName: string;
  gains: LearningGainItem[];
}

/**
 * Configuration mapping learning levels to their personalized content
 */
export const learningLevelContentMap: Record<LearningLevel, LearningLevelContent> = {
  beginner: {
    level: 'beginner',
    displayName: 'Beginner',
    gains: [
      {
        icon: '📚',
        title: 'Understanding Forex Basics and Terminology',
        description: 'Master the fundamentals of currency trading, market structure, and essential trading terminology',
      },
      {
        icon: '📊',
        title: 'How to Read Candlestick Charts',
        description: 'Learn to interpret price action through candlestick patterns and chart formations',
      },
      {
        icon: '🛡️',
        title: 'Risk Management Fundamentals',
        description: 'Protect your capital with proven risk management strategies and position sizing techniques',
      },
      {
        icon: '🎯',
        title: 'How to Practice Safely Using a Demo Account',
        description: 'Build confidence and skills in a risk-free environment before trading with real money',
      },
    ],
  },
  intermediate: {
    level: 'intermediate',
    displayName: 'Intermediate',
    gains: [
      {
        icon: '📈',
        title: 'Market Structure and Trend Identification',
        description: 'Identify market trends, support and resistance levels, and understand market structure dynamics',
      },
      {
        icon: '🔍',
        title: 'Technical Indicators and Confirmations',
        description: 'Master technical analysis tools and learn to use indicators for trade confirmation',
      },
      {
        icon: '📝',
        title: 'Trade Planning and Journaling',
        description: 'Develop systematic trading plans and maintain detailed trade journals for continuous improvement',
      },
      {
        icon: '💪',
        title: 'Improving Consistency and Discipline',
        description: 'Build trading discipline and consistency through structured routines and mindset training',
      },
    ],
  },
  advanced: {
    level: 'advanced',
    displayName: 'Advanced',
    gains: [
      {
        icon: '⚡',
        title: 'Advanced Price Action Concepts',
        description: 'Master sophisticated price action patterns, market microstructure, and advanced chart analysis',
      },
      {
        icon: '🌐',
        title: 'Multi-Timeframe Market Analysis',
        description: 'Analyze markets across multiple timeframes to identify high-probability trading opportunities',
      },
      {
        icon: '🧠',
        title: 'Trading Psychology and Risk Optimization',
        description: 'Develop advanced psychological strategies and optimize risk-reward ratios for maximum profitability',
      },
      {
        icon: '📊',
        title: 'Strategy Refinement and Performance Tracking',
        description: 'Refine trading strategies through backtesting, forward testing, and detailed performance analytics',
      },
    ],
  },
};

/**
 * Get learning level content by level
 * @param level - The learning level ('beginner' | 'intermediate' | 'advanced')
 * @returns LearningLevelContent for the specified level, or beginner as fallback
 */
export function getLearningLevelContent(level: LearningLevel | string | undefined | null): LearningLevelContent {
  // Normalize level to lowercase and handle undefined/null
  const normalizedLevel = (level?.toLowerCase() || 'beginner') as LearningLevel;
  
  // Validate level and fallback to beginner if invalid
  if (normalizedLevel in learningLevelContentMap) {
    return learningLevelContentMap[normalizedLevel];
  }
  
  // Safe fallback to beginner
  return learningLevelContentMap.beginner;
}



