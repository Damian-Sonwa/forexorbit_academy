/**
 * Add Missing Quizzes Script
 * Finds lessons without quizzes and adds appropriate quizzes
 * SAFE: Only adds quizzes, never deletes anything
 */

const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');

// Load .env.local file manually
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config({ path: '.env.local' });
}

// Quiz question generators based on lesson topics
const generateQuizQuestions = (lessonTitle, lessonContent, lessonSummary) => {
  const title = lessonTitle.toLowerCase();
  const questions = [];

  // Helper to extract key terms from content
  const getKeyTerms = (text) => {
    if (!text) return [];
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how'];
    const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 4 && !commonWords.includes(w));
    return [...new Set(words)].slice(0, 10);
  };

  // Generate questions based on lesson topic
  if (title.includes('forex') || title.includes('introduction') || title.includes('basics')) {
    questions.push(
      {
        question: 'What does Forex stand for?',
        options: ['Foreign Exchange', 'Forex Exchange', 'Foreign Exchange Market', 'Forex Market'],
        correctAnswer: 0,
      },
      {
        question: 'Which is the most traded currency pair?',
        options: ['GBP/USD', 'EUR/USD', 'USD/JPY', 'AUD/USD'],
        correctAnswer: 1,
      },
      {
        question: 'Forex markets are open:',
        options: ['24/7', 'Monday to Friday, 24 hours', '9 AM to 5 PM', 'Only during business hours'],
        correctAnswer: 1,
      },
      {
        question: 'What is a pip in Forex trading?',
        options: ['A type of currency', 'The smallest price movement', 'A trading strategy', 'A broker fee'],
        correctAnswer: 1,
      },
      {
        question: 'The Forex market is primarily:',
        options: ['Centralized', 'Decentralized (OTC)', 'Regulated by one authority', 'Only accessible to banks'],
        correctAnswer: 1,
      },
      {
        question: 'What is the typical lot size in Forex trading?',
        options: ['100 units', '1,000 units', '10,000 units', '100,000 units'],
        correctAnswer: 3,
      },
      {
        question: 'Which session has the highest trading volume?',
        options: ['Asian session', 'European session', 'London session', 'New York session'],
        correctAnswer: 2,
      }
    );
  } else if (title.includes('currency pair') || title.includes('pairs')) {
    questions.push(
      {
        question: 'EUR/USD is an example of:',
        options: ['Major pair', 'Minor pair', 'Exotic pair', 'Cross pair'],
        correctAnswer: 0,
      },
      {
        question: 'In EUR/USD, EUR is the:',
        options: ['Base currency', 'Quote currency', 'Counter currency', 'Secondary currency'],
        correctAnswer: 0,
      },
      {
        question: 'What are the major currency pairs?',
        options: ['Pairs involving USD and major economies', 'Pairs with high volatility', 'Pairs with low spreads', 'Pairs traded only in Asia'],
        correctAnswer: 0,
      },
      {
        question: 'In GBP/JPY, JPY is the:',
        options: ['Base currency', 'Quote currency', 'Primary currency', 'Trading currency'],
        correctAnswer: 1,
      },
      {
        question: 'The spread is the difference between:',
        options: ['Bid and ask prices', 'High and low prices', 'Open and close prices', 'Buy and sell orders'],
        correctAnswer: 0,
      },
      {
        question: 'What does a bid price represent?',
        options: ['The price at which you can sell', 'The price at which you can buy', 'The average price', 'The closing price'],
        correctAnswer: 0,
      },
      {
        question: 'Exotic pairs typically include:',
        options: ['Only major currencies', 'One major and one emerging market currency', 'Two emerging market currencies', 'Only European currencies'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('candlestick') || title.includes('chart')) {
    questions.push(
      {
        question: 'What is a candlestick chart?',
        options: [
          'A type of price chart showing open, high, low, and close',
          'A trading strategy',
          'A currency pair',
          'A market indicator',
        ],
        correctAnswer: 0,
      },
      {
        question: 'A doji candlestick pattern typically indicates:',
        options: ['Strong bullish momentum', 'Strong bearish momentum', 'Market indecision', 'Trend continuation'],
        correctAnswer: 2,
      },
      {
        question: 'A green/white candlestick typically represents:',
        options: ['Price closed lower than it opened', 'Price closed higher than it opened', 'No price change', 'Market closed'],
        correctAnswer: 1,
      },
      {
        question: 'What does the wick of a candlestick show?',
        options: ['Opening price', 'Closing price', 'High and low prices during the period', 'Average price'],
        correctAnswer: 2,
      },
      {
        question: 'The body of a candlestick shows:',
        options: ['High and low prices', 'Opening and closing prices', 'Volume', 'Spread'],
        correctAnswer: 1,
      },
      {
        question: 'A hammer candlestick pattern is typically:',
        options: ['A bullish reversal signal', 'A bearish reversal signal', 'A continuation pattern', 'A neutral pattern'],
        correctAnswer: 0,
      },
      {
        question: 'A long upper wick suggests:',
        options: ['Strong buying pressure', 'Strong selling pressure at highs', 'No trading activity', 'Market consolidation'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('rsi') || title.includes('indicator') || title.includes('technical')) {
    questions.push(
      {
        question: 'What does RSI stand for?',
        options: ['Relative Strength Index', 'Risk Signal Indicator', 'Rate of Speed Indicator', 'Real-time Signal Index'],
        correctAnswer: 0,
      },
      {
        question: 'An RSI reading above 70 typically indicates:',
        options: ['Oversold conditions', 'Overbought conditions', 'Neutral market', 'Strong uptrend'],
        correctAnswer: 1,
      },
      {
        question: 'What does MACD stand for?',
        options: ['Moving Average Convergence Divergence', 'Market Analysis Chart Data', 'Maximum Average Change Direction', 'Multiple Asset Chart Display'],
        correctAnswer: 0,
      },
      {
        question: 'Support and resistance levels are:',
        options: ['Price levels where buying/selling pressure is strong', 'Time-based indicators', 'Volume indicators', 'Moving averages'],
        correctAnswer: 0,
      },
      {
        question: 'A moving average helps identify:',
        options: ['Exact entry points', 'Trend direction and smoothing price data', 'Volume levels', 'Spread values'],
        correctAnswer: 1,
      },
      {
        question: 'An RSI reading below 30 typically indicates:',
        options: ['Overbought conditions', 'Oversold conditions', 'Neutral market', 'Strong downtrend'],
        correctAnswer: 1,
      },
      {
        question: 'Technical analysis primarily focuses on:',
        options: ['Economic news', 'Price charts and patterns', 'Political events', 'Company earnings'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('risk') || title.includes('management') || title.includes('stop loss') || title.includes('take profit')) {
    questions.push(
      {
        question: 'A favorable risk-reward ratio is typically:',
        options: ['1:1', '1:2 or higher', '2:1', '1:0.5'],
        correctAnswer: 1,
      },
      {
        question: 'What is a stop-loss order?',
        options: ['An order to take profits', 'An order to limit losses', 'An order to enter a trade', 'An order to close all positions'],
        correctAnswer: 1,
      },
      {
        question: 'What percentage of account balance should typically be risked per trade?',
        options: ['10-20%', '5-10%', '1-2%', '50% or more'],
        correctAnswer: 2,
      },
      {
        question: 'A take-profit order is used to:',
        options: ['Limit losses', 'Secure profits at a target price', 'Enter a trade', 'Close all positions'],
        correctAnswer: 1,
      },
      {
        question: 'Risk management involves:',
        options: ['Maximizing profits only', 'Protecting capital and managing risk', 'Ignoring losses', 'Trading with maximum leverage'],
        correctAnswer: 1,
      },
      {
        question: 'Position sizing should be based on:',
        options: ['Account balance only', 'Risk tolerance and account balance', 'Gut feeling', 'Maximum leverage available'],
        correctAnswer: 1,
      },
      {
        question: 'Diversification in trading means:',
        options: ['Trading only one currency pair', 'Spreading risk across different trades/pairs', 'Using maximum leverage', 'Ignoring market analysis'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('pattern') || title.includes('head') || title.includes('shoulder') || title.includes('triangle')) {
    questions.push(
      {
        question: 'A head and shoulders pattern is typically:',
        options: ['A bullish reversal pattern', 'A bearish reversal pattern', 'A continuation pattern', 'A neutral pattern'],
        correctAnswer: 1,
      },
      {
        question: 'Triangle patterns can indicate:',
        options: ['Only uptrends', 'Only downtrends', 'Consolidation before a breakout', 'Market closure'],
        correctAnswer: 2,
      },
      {
        question: 'Chart patterns help traders:',
        options: ['Predict exact prices', 'Identify potential trend reversals or continuations', 'Control market movements', 'Eliminate all risks'],
        correctAnswer: 1,
      },
      {
        question: 'A double top pattern typically signals:',
        options: ['A bullish reversal', 'A bearish reversal', 'Trend continuation', 'No significant change'],
        correctAnswer: 1,
      },
      {
        question: 'Pattern recognition in trading involves:',
        options: ['Random guessing', 'Identifying recurring price formations', 'Following news only', 'Ignoring charts'],
        correctAnswer: 1,
      },
      {
        question: 'A symmetrical triangle suggests:',
        options: ['Strong directional bias', 'Market indecision and potential breakout', 'Market closure', 'No trading activity'],
        correctAnswer: 1,
      },
      {
        question: 'Patterns are more reliable when:',
        options: ['They occur randomly', 'They form at key support/resistance levels', 'They ignore volume', 'They contradict trends'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('psychology') || title.includes('emotion') || title.includes('mindset')) {
    questions.push(
      {
        question: 'Trading psychology involves:',
        options: ['Only technical skills', 'Managing emotions and maintaining discipline', 'Ignoring losses', 'Trading impulsively'],
        correctAnswer: 1,
      },
      {
        question: 'Emotional trading often leads to:',
        options: ['Consistent profits', 'Poor decision-making and losses', 'Guaranteed success', 'Risk-free trading'],
        correctAnswer: 1,
      },
      {
        question: 'A professional trader\'s mindset treats trading as:',
        options: ['A game of chance', 'A business with expenses and revenue', 'A hobby', 'A way to get rich quick'],
        correctAnswer: 1,
      },
      {
        question: 'Revenge trading refers to:',
        options: ['Trading after careful analysis', 'Trading to recover losses emotionally', 'Trading with a plan', 'Trading during news events'],
        correctAnswer: 1,
      },
      {
        question: 'Maintaining discipline in trading means:',
        options: ['Changing strategies frequently', 'Following your trading plan consistently', 'Trading based on emotions', 'Ignoring risk management'],
        correctAnswer: 1,
      },
      {
        question: 'Losses in trading should be viewed as:',
        options: ['Failures', 'Learning opportunities and part of the process', 'Reasons to quit', 'Signs of incompetence'],
        correctAnswer: 1,
      },
      {
        question: 'Overconfidence in trading can lead to:',
        options: ['Better risk management', 'Increased position sizes and higher risk', 'More consistent profits', 'Elimination of all losses'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('fundamental') || title.includes('economic') || title.includes('macro') || title.includes('gdp') || title.includes('inflation')) {
    questions.push(
      {
        question: 'Fundamental analysis focuses on:',
        options: ['Chart patterns only', 'Economic indicators and news', 'Technical indicators only', 'Price movements only'],
        correctAnswer: 1,
      },
      {
        question: 'Interest rates affect currency values because:',
        options: ['They have no impact', 'Higher rates attract foreign investment', 'Lower rates always strengthen currency', 'Rates only affect stocks'],
        correctAnswer: 1,
      },
      {
        question: 'GDP measures:',
        options: ['Currency exchange rates', 'A country\'s total economic output', 'Inflation rates', 'Interest rates'],
        correctAnswer: 1,
      },
      {
        question: 'Inflation typically:',
        options: ['Strengthens currency', 'Erodes purchasing power and can weaken currency', 'Has no effect', 'Only affects stocks'],
        correctAnswer: 1,
      },
      {
        question: 'Central banks use monetary policy to:',
        options: ['Control only stock markets', 'Control inflation and stimulate growth', 'Set currency prices directly', 'Eliminate all economic risks'],
        correctAnswer: 1,
      },
      {
        question: 'Trade balance affects currency values when:',
        options: ['It has no impact', 'Countries have trade surpluses or deficits', 'Only during wars', 'Only in developed countries'],
        correctAnswer: 1,
      },
      {
        question: 'Economic calendars help traders:',
        options: ['Predict exact prices', 'Anticipate volatility around data releases', 'Control market movements', 'Eliminate all risks'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('strategy') || title.includes('trading strategy') || title.includes('scalping') || title.includes('swing')) {
    questions.push(
      {
        question: 'A trading strategy should be:',
        options: ['Changed daily', 'Based on well-defined rules and tested', 'Based on random signals', 'Kept secret from everyone'],
        correctAnswer: 1,
      },
      {
        question: 'Scalping involves:',
        options: ['Long-term positions', 'Quick trades with small profits', 'Only buying currencies', 'Ignoring risk management'],
        correctAnswer: 1,
      },
      {
        question: 'Swing trading typically involves:',
        options: ['Holding positions for minutes', 'Holding positions for days to weeks', 'Only day trading', 'Ignoring trends'],
        correctAnswer: 1,
      },
      {
        question: 'Backtesting a strategy means:',
        options: ['Predicting future prices', 'Testing on historical data', 'Trading with real money immediately', 'Ignoring past performance'],
        correctAnswer: 1,
      },
      {
        question: 'A trading plan should include:',
        options: ['Only entry points', 'Entry, exit, and risk management rules', 'Only exit points', 'Random decisions'],
        correctAnswer: 1,
      },
      {
        question: 'Strategy diversification involves:',
        options: ['Using only one approach', 'Using different trading approaches simultaneously', 'Ignoring market conditions', 'Trading randomly'],
        correctAnswer: 1,
      },
      {
        question: 'Paper trading helps:',
        options: ['Guarantee profits', 'Test strategies without real money risk', 'Eliminate all losses', 'Predict exact prices'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('portfolio') || title.includes('diversification') || title.includes('correlation')) {
    questions.push(
      {
        question: 'Portfolio management involves:',
        options: ['Trading only one position', 'Managing multiple positions as a unified portfolio', 'Ignoring risk', 'Trading randomly'],
        correctAnswer: 1,
      },
      {
        question: 'Correlation measures:',
        options: ['Only price movements', 'How currency pairs move relative to each other', 'Only volume', 'Only spreads'],
        correctAnswer: 1,
      },
      {
        question: 'Diversification helps:',
        options: ['Eliminate all risks', 'Spread risk across different positions', 'Increase leverage', 'Trade only one pair'],
        correctAnswer: 1,
      },
      {
        question: 'Risk parity allocates:',
        options: ['Equal capital to each position', 'Equal risk to each position', 'Random amounts', 'Maximum leverage'],
        correctAnswer: 1,
      },
      {
        question: 'Portfolio optimization aims to:',
        options: ['Maximize only profits', 'Maximize returns while minimizing risk', 'Ignore risk completely', 'Trade only major pairs'],
        correctAnswer: 1,
      },
      {
        question: 'Rebalancing involves:',
        options: ['Never changing positions', 'Adjusting positions to maintain desired risk levels', 'Trading randomly', 'Ignoring correlations'],
        correctAnswer: 1,
      },
      {
        question: 'Highly correlated pairs provide:',
        options: ['Maximum diversification', 'Limited diversification', 'No risk', 'Guaranteed profits'],
        correctAnswer: 1,
      }
    );
  } else if (title.includes('algorithm') || title.includes('automated') || title.includes('ea') || title.includes('expert advisor')) {
    questions.push(
      {
        question: 'Algorithmic trading uses:',
        options: ['Human intuition only', 'Computer programs with predefined rules', 'Random signals', 'Only technical indicators'],
        correctAnswer: 1,
      },
      {
        question: 'What is an Expert Advisor (EA)?',
        options: ['A human trading advisor', 'An automated trading system', 'A market analysis tool', 'A broker service'],
        correctAnswer: 1,
      },
      {
        question: 'Backtesting allows you to:',
        options: ['Predict future prices', 'Test strategies on historical data', 'Guarantee profits', 'Avoid all risks'],
        correctAnswer: 1,
      },
      {
        question: 'Paper trading is:',
        options: ['Trading with real money', 'Simulated trading without real money', 'Trading only paper assets', 'A type of currency'],
        correctAnswer: 1,
      },
      {
        question: 'Algorithmic trading can help:',
        options: ['Eliminate all risks', 'Remove emotions from trading decisions', 'Guarantee profits', 'Predict market movements'],
        correctAnswer: 1,
      },
      {
        question: 'What is forward testing?',
        options: ['Testing on historical data', 'Testing on live data with paper trading', 'Testing on future data', 'Testing with real money'],
        correctAnswer: 1,
      },
      {
        question: 'A trading algorithm should be:',
        options: ['Based on random signals', 'Based on well-defined rules and logic', 'Changed every day', 'Kept secret from everyone'],
        correctAnswer: 1,
      }
    );
  } else {
    // Generic questions for any other topic
    questions.push(
      {
        question: 'What is the primary goal of this lesson?',
        options: ['To guarantee profits', 'To understand key concepts and improve trading knowledge', 'To eliminate all risks', 'To trade without analysis'],
        correctAnswer: 1,
      },
      {
        question: 'Effective learning in Forex trading requires:',
        options: ['Only reading', 'Practice, understanding concepts, and applying knowledge', 'Only watching videos', 'Ignoring fundamentals'],
        correctAnswer: 1,
      },
      {
        question: 'Risk management is:',
        options: ['Optional', 'Essential for long-term success', 'Only for beginners', 'Not important'],
        correctAnswer: 1,
      },
      {
        question: 'Consistent application of learned concepts leads to:',
        options: ['Guaranteed profits', 'Better trading decisions and improved performance', 'No benefits', 'Increased risks'],
        correctAnswer: 1,
      },
      {
        question: 'Understanding market fundamentals helps traders:',
        options: ['Predict exact prices', 'Make informed decisions based on analysis', 'Eliminate all losses', 'Trade without risk'],
        correctAnswer: 1,
      },
      {
        question: 'Practice and experience in trading:',
        options: ['Are not necessary', 'Help develop skills and improve decision-making', 'Guarantee success', 'Eliminate all risks'],
        correctAnswer: 1,
      },
      {
        question: 'Continuous learning in Forex trading:',
        options: ['Is not important', 'Helps adapt to changing market conditions', 'Only for beginners', 'Has no benefits'],
        correctAnswer: 1,
      }
    );
  }

  // Ensure we have at least 5 questions
  while (questions.length < 5) {
    questions.push({
      question: `What is a key takeaway from "${lessonTitle}"?`,
      options: [
        'Understanding the concepts improves trading knowledge',
        'Trading requires no analysis',
        'All trades will be profitable',
        'Risk management is optional'
      ],
      correctAnswer: 0,
    });
  }

  // Return 5-7 questions
  return questions.slice(0, 7);
};

async function addMissingQuizzes() {
  try {
    console.log('🔍 Starting to find and add missing quizzes...');
    
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGO_URI not defined in .env.local');
    }
    
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    const db = client.db('Forex_elearning');
    
    // Get all lessons
    console.log('📚 Fetching all lessons...');
    const lessons = await db.collection('lessons').find({}).toArray();
    console.log(`   Found ${lessons.length} lessons`);
    
    // Get all existing quizzes
    console.log('❓ Fetching existing quizzes...');
    const existingQuizzes = await db.collection('quizzes').find({}).toArray();
    const existingLessonIds = new Set(existingQuizzes.map(q => q.lessonId?.toString()));
    console.log(`   Found ${existingQuizzes.length} existing quizzes`);
    
    // Find lessons without quizzes
    const lessonsWithoutQuizzes = lessons.filter(lesson => {
      const lessonId = lesson._id.toString();
      return !existingLessonIds.has(lessonId);
    });
    
    console.log(`\n📊 Analysis:`);
    console.log(`   Total lessons: ${lessons.length}`);
    console.log(`   Lessons with quizzes: ${existingQuizzes.length}`);
    console.log(`   Lessons without quizzes: ${lessonsWithoutQuizzes.length}`);
    
    if (lessonsWithoutQuizzes.length === 0) {
      console.log('\n✅ All lessons already have quizzes! Nothing to add.');
      await client.close();
      return;
    }
    
    console.log(`\n🎯 Lessons that need quizzes:`);
    lessonsWithoutQuizzes.forEach((lesson, index) => {
      console.log(`   ${index + 1}. ${lesson.title} (Course ID: ${lesson.courseId})`);
    });
    
    // Generate and insert quizzes
    console.log(`\n📝 Generating quizzes for ${lessonsWithoutQuizzes.length} lessons...`);
    const quizzesToInsert = [];
    
    for (const lesson of lessonsWithoutQuizzes) {
      const lessonId = lesson._id.toString();
      const courseId = lesson.courseId?.toString() || lesson.courseId;
      
      if (!courseId) {
        console.log(`   ⚠️  Skipping "${lesson.title}" - no courseId found`);
        continue;
      }
      
      const questions = generateQuizQuestions(
        lesson.title,
        lesson.content,
        lesson.lessonSummary?.overview || lesson.summary
      );
      
      quizzesToInsert.push({
        lessonId: lessonId,
        courseId: courseId,
        questions: questions,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      
      console.log(`   ✓ Generated ${questions.length} questions for "${lesson.title}"`);
    }
    
    if (quizzesToInsert.length === 0) {
      console.log('\n⚠️  No quizzes could be generated. Check lesson data.');
      await client.close();
      return;
    }
    
    // Insert quizzes (safe - only inserts, never deletes)
    console.log(`\n💾 Inserting ${quizzesToInsert.length} new quizzes into database...`);
    const result = await db.collection('quizzes').insertMany(quizzesToInsert);
    
    console.log(`\n✅ Successfully added ${result.insertedCount} quizzes!`);
    console.log(`\n📋 Summary:`);
    console.log(`   - Quizzes added: ${result.insertedCount}`);
    console.log(`   - Total quizzes now: ${existingQuizzes.length + result.insertedCount}`);
    console.log(`   - Lessons with quizzes: ${existingQuizzes.length + result.insertedCount} / ${lessons.length}`);
    
    // Verify no data was deleted
    const finalQuizzes = await db.collection('quizzes').find({}).toArray();
    console.log(`\n🔒 Safety Check:`);
    console.log(`   - Original quizzes: ${existingQuizzes.length}`);
    console.log(`   - Final quizzes: ${finalQuizzes.length}`);
    console.log(`   - Data preserved: ${finalQuizzes.length >= existingQuizzes.length ? '✅ YES' : '❌ NO'}`);
    
    if (finalQuizzes.length < existingQuizzes.length) {
      console.log(`\n⚠️  WARNING: Quiz count decreased! This should not happen.`);
    } else {
      console.log(`\n✅ All existing data preserved. No deletions occurred.`);
    }
    
    await client.close();
    console.log('\n🎉 Script completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
addMissingQuizzes();

