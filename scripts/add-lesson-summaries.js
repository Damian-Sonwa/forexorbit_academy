/**
 * Add Summaries to Existing Lessons
 * Updates all lessons in the database with appropriate summaries
 * This script does NOT delete any data - it only updates existing lessons
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

const lessonSummaries = {
  // Course 1: Forex Trading Fundamentals
  'Introduction to Forex': 'Forex is the global marketplace for trading currencies. Learn the basics of how Forex markets operate, including market participants, trading volumes, and why Forex is the largest financial market in the world.',
  'Understanding Currency Pairs': 'Currency pairs are the foundation of Forex trading. Learn about major pairs like EUR/USD, GBP/USD, and USD/JPY, as well as minor and exotic pairs. Master reading bid/ask prices and understanding pip values.',
  'How Forex Market Works': 'Learn how the Forex market operates, including the role of brokers, market makers, and ECNs. Understand spreads, slippage, and how orders are executed in the market.',
  'Reading Forex Charts': 'Charts are essential tools for Forex trading. Learn about different chart types (line, bar, candlestick), timeframes, and how to identify basic price patterns and trends.',
  'Basic Risk Management': 'Risk management is the most important aspect of trading. Learn about position sizing, risk-reward ratios, and how to calculate appropriate position sizes based on your account balance and risk tolerance.',
  'Trading Psychology Basics': 'Trading psychology is crucial for success. Learn about common emotional pitfalls like fear, greed, and revenge trading. Develop a disciplined mindset and trading plan.',
  
  // Course 2: Technical Basics
  'Candlestick Patterns': 'Candlestick patterns provide valuable insights into market psychology. Learn about common patterns like doji, hammer, engulfing, and shooting star, and how to use them in your trading.',
  'Support & Resistance': 'Support and resistance levels are crucial for identifying entry and exit points in trading. Learn how to identify these levels, understand their significance, and use them in your trading strategy.',
  'Trend Lines': 'Trend lines are simple yet powerful tools for identifying market trends. Learn how to draw trend lines correctly, identify uptrends and downtrends, and use trend line breaks as trading signals.',
  'Simple Moving Averages (SMA)': 'Moving averages smooth out price data to help identify trends. Learn about simple moving averages (SMA), how to calculate them, and how to use them in conjunction with price action for trading signals.',
  'Entry & Exit Points': 'Timing is everything in trading. Learn how to combine candlestick patterns, support/resistance, trend lines, and moving averages to identify high-probability entry and exit points.',
  
  // Course 3: Forex Basics
  'Market Hours and Sessions': 'The Forex market operates 24 hours a day, five days a week. Learn about the different trading sessions: Asian, European, and North American sessions.',
  
  // Course 4: Technical Analysis
  'Advanced Candlestick Patterns': 'Take your candlestick analysis to the next level. Learn about advanced patterns like three-line strikes, morning/evening stars, and how to combine multiple patterns for stronger signals.',
  'Indicators & Oscillators (RSI, MACD)': 'Technical indicators help confirm price action and identify trading opportunities. Learn about RSI (Relative Strength Index), MACD (Moving Average Convergence Divergence), and how to interpret their signals.',
  'Fibonacci Retracement & Extensions': 'Fibonacci retracements and extensions are powerful tools for identifying potential reversal points and price targets. Learn how to draw Fibonacci levels correctly and use them in your trading strategy.',
  'Chart Patterns (Head & Shoulders, Triangles)': 'Chart patterns provide visual clues about future price movement. Learn to identify and trade patterns like head and shoulders, triangles, flags, pennants, and double tops/bottoms.',
  'Swing Trading Strategies': 'Swing trading involves holding positions for several days to weeks. Learn how to identify swing trading opportunities, set up swing trades, and manage positions for optimal risk-reward ratios.',
  
  // Course 5: Trading Strategies
  'Risk-Reward Ratio': 'A positive risk-reward ratio is essential for long-term profitability. Learn how to calculate risk-reward ratios, identify trades with favorable ratios, and why a 1:2 or 1:3 ratio is often recommended.',
  'Position Sizing': 'Position sizing determines how much capital to risk on each trade. Learn different position sizing methods including fixed lot size, percentage risk, and Kelly Criterion, and how to apply them to your trading.',
  'Stop Loss & Take Profit': 'Stop loss and take profit orders are essential for managing risk and locking in profits. Learn how to set these levels based on support/resistance, ATR, and percentage-based methods.',
  'Automated Trading Tools': 'Automated trading tools can help execute trades based on predefined rules. Learn about Expert Advisors (EAs), trading robots, and how to use them effectively while understanding their limitations.',
  'Intermediate Trading Psychology': 'Take your trading psychology to the next level. Learn about cognitive biases, emotional control techniques, journaling, and how to develop a professional trading mindset.',
  
  // Course 6: Algorithmic Trading
  'Introduction to Algorithmic Trading': 'Algorithmic trading uses computer programs to execute trades based on predefined rules. Learn about the advantages, disadvantages, and different types of algorithmic trading strategies.',
  'Forex Bots & Scripts': 'Learn about different types of Forex bots, how they work, and how to evaluate their performance. Understand the basics of MQL4/MQL5 programming for creating custom trading scripts.',
  'Backtesting Strategies': 'Backtesting allows you to test trading strategies on historical data. Learn how to properly backtest strategies, interpret results, and avoid common pitfalls like overfitting and curve fitting.',
  'Optimizing Trading Algorithms': 'Learn how to optimize trading algorithms using walk-forward analysis, parameter optimization, and machine learning techniques. Understand the balance between optimization and overfitting.',
  'Advanced Risk Management': 'Advanced risk management for algorithmic trading includes portfolio-level risk, correlation analysis, drawdown management, and dynamic position sizing based on market conditions.',
  
  // Course 7: Professional Forex Trading
  'Market Sentiment Analysis': 'Market sentiment analysis helps identify when markets are overbought or oversold. Learn to use Commitment of Traders (COT) reports, sentiment indicators, and news sentiment analysis in your trading.',
  'Hedging & Leverage Strategies': 'Learn professional hedging strategies to protect positions and manage risk. Understand how to use leverage effectively, calculate margin requirements, and avoid margin calls.',
  'Portfolio Management': 'Portfolio management involves diversifying across multiple currency pairs and strategies. Learn about correlation analysis, portfolio optimization, and how to balance risk across different trading strategies.',
  'Macro Economics & Forex': 'Macroeconomic factors like interest rates, inflation, GDP, and central bank policies significantly impact currency markets. Learn how to analyze these factors and incorporate fundamental analysis into your trading.',
  'Advanced Trading Psychology': 'Advanced trading psychology covers mental models, performance optimization, dealing with large drawdowns, maintaining consistency, and developing the mindset of a professional trader.',
  
  // Course 8: Advanced Forex Trading
  'Risk Management Strategies': 'Risk management is the most important aspect of trading. Learn advanced techniques to protect your account, manage drawdowns, and preserve capital for long-term success.',
};

async function addSummaries() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI not found in .env.local');
      return;
    }

    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB Atlas\n');

    const db = client.db('Forex_elearning');
    const lessons = db.collection('lessons');
    
    const allLessons = await lessons.find({}).toArray();
    console.log(`📚 Found ${allLessons.length} lessons in database\n`);
    
    let updated = 0;
    let skipped = 0;

    for (const lesson of allLessons) {
      const summary = lessonSummaries[lesson.title];
      
      if (summary) {
        const updateData = {
          summary: summary,
          lessonSummary: {
            overview: summary,
            updatedAt: new Date(),
          },
          updatedAt: new Date(),
        };

        await lessons.updateOne(
          { _id: lesson._id },
          { $set: updateData }
        );
        
        console.log(`✓ Updated: ${lesson.title}`);
        updated++;
      } else {
        console.log(`⚠ Skipped (no summary found): ${lesson.title}`);
        skipped++;
      }
    }

    console.log(`\n✅ Summary update completed!`);
    console.log(`   - Updated: ${updated} lessons`);
    console.log(`   - Skipped: ${skipped} lessons`);

    await client.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

addSummaries();

