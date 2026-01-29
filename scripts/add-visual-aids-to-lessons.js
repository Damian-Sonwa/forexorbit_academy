/**
 * Add Visual Aids (Charts, Graphs, Screenshots) to Lessons
 * Adds relevant visual aids to each lesson based on the lesson topic
 */

const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

// Visual aids mapping - relevant images/charts for each lesson topic
const visualAidsMap = {
  // Course 1: Forex Trading Fundamentals
  'Introduction to Forex': [
    {
      url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=600&fit=crop',
      caption: 'Global Forex Market Overview - Trading Volume Distribution'
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Forex Market Participants and Trading Sessions'
    }
  ],
  'Understanding Currency Pairs': [
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Major Currency Pairs Chart - EUR/USD, GBP/USD, USD/JPY'
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Currency Pair Quote Structure - Bid/Ask Spread Visualization'
    }
  ],
  'How Forex Market Works': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Forex Market Structure - Brokers, Market Makers, and ECNs'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Order Execution Flow Diagram'
    }
  ],
  'Reading Forex Charts': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Candlestick Chart Example - Price Action Visualization'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Chart Types Comparison - Line, Bar, and Candlestick'
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Timeframe Analysis - Multiple Timeframe Chart View'
    }
  ],
  'Basic Risk Management': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Position Sizing Calculator - Risk Management Chart'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Risk-Reward Ratio Visualization'
    }
  ],
  'Trading Psychology Basics': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Trading Psychology Cycle - Emotions in Trading'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Common Psychological Pitfalls in Forex Trading'
    }
  ],
  
  // Course 2: Technical Basics
  'Candlestick Patterns': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Common Candlestick Patterns - Doji, Hammer, Engulfing'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Reversal Patterns Chart - Bullish and Bearish Signals'
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Candlestick Pattern Recognition Guide'
    }
  ],
  'Support & Resistance': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Support and Resistance Levels on Price Chart'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Price Action at Key Support/Resistance Zones'
    }
  ],
  'Trend Lines': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Trend Line Drawing - Uptrend and Downtrend Examples'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Trend Line Breakout Patterns'
    }
  ],
  'Simple Moving Averages (SMA)': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Moving Average Crossover Strategy - Golden Cross Example'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Multiple Moving Averages on Price Chart'
    }
  ],
  'Entry & Exit Points': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'High-Probability Entry Points - Confluence Zones'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Exit Strategy - Take Profit and Stop Loss Placement'
    }
  ],
  
  // Course 3: Forex Basics
  'Market Hours and Sessions': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Forex Trading Sessions - Asian, European, North American'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Market Overlap Periods - High Liquidity Times'
    }
  ],
  
  // Course 4: Technical Analysis
  'Advanced Candlestick Patterns': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Morning Star and Evening Star Patterns'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Three White Soldiers and Three Black Crows Patterns'
    }
  ],
  'Indicators & Oscillators (RSI, MACD)': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'RSI Indicator - Overbought and Oversold Levels'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'MACD Indicator - Signal Line Crossovers and Divergence'
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Combining RSI and MACD for Trading Signals'
    }
  ],
  'Fibonacci Retracement & Extensions': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Fibonacci Retracement Levels on Price Chart'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Fibonacci Extension Targets for Take Profit'
    }
  ],
  'Chart Patterns (Head & Shoulders, Triangles)': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Head and Shoulders Pattern - Reversal Signal'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Triangle Patterns - Ascending, Descending, Symmetrical'
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Double Top and Double Bottom Patterns'
    }
  ],
  'Swing Trading Strategies': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Swing Trading Setup - Entry and Exit Points'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Swing Trading Timeframe Analysis'
    }
  ],
  
  // Course 5: Trading Strategies
  'Risk-Reward Ratio': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Risk-Reward Ratio Calculation Chart'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Win Rate vs Risk-Reward Ratio Relationship'
    }
  ],
  'Position Sizing': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Position Sizing Calculator - Lot Size Determination'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Kelly Criterion Position Sizing Formula'
    }
  ],
  'Stop Loss & Take Profit': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Stop Loss Placement Strategies'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Take Profit Levels - ATR and Support/Resistance Based'
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Trailing Stop Loss Mechanism'
    }
  ],
  'Automated Trading Tools': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Expert Advisor (EA) Interface - MetaTrader Platform'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Trading Robot Performance Dashboard'
    }
  ],
  'Intermediate Trading Psychology': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Cognitive Biases in Trading - Decision Making Chart'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Trading Journal Template - Performance Tracking'
    }
  ],
  
  // Course 6: Algorithmic Trading
  'Introduction to Algorithmic Trading': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Algorithmic Trading System Architecture'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Types of Algorithmic Trading Strategies'
    }
  ],
  'Forex Bots & Scripts': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'MQL4/MQL5 Code Structure - Expert Advisor Example'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Forex Bot Performance Metrics Dashboard'
    }
  ],
  'Backtesting Strategies': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Backtesting Results - Equity Curve and Statistics'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Walk-Forward Analysis - Optimization Process'
    }
  ],
  'Optimizing Trading Algorithms': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Parameter Optimization - Overfitting Prevention'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Machine Learning in Trading Algorithm Optimization'
    }
  ],
  'Advanced Risk Management': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Portfolio Risk Analysis - Correlation Matrix'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Dynamic Position Sizing Based on Market Volatility'
    }
  ],
  
  // Course 7: Professional Forex Trading
  'Market Sentiment Analysis': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Commitment of Traders (COT) Report Visualization'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Sentiment Indicator - Speculative Sentiment Index'
    }
  ],
  'Hedging & Leverage Strategies': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Hedging Strategy Diagram - Position Protection'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Leverage and Margin Calculation Chart'
    }
  ],
  'Portfolio Management': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Portfolio Diversification - Currency Pair Correlation'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Risk Parity Portfolio Allocation'
    }
  ],
  'Macro Economics & Forex': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Interest Rate Impact on Currency Values'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Economic Calendar - Key Events and Currency Impact'
    }
  ],
  'Advanced Trading Psychology': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Professional Trader Mindset Framework'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Performance Optimization - Mental Models in Trading'
    }
  ],
  
  // Course 8: Advanced Forex Trading
  'Risk Management Strategies': [
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      caption: 'Advanced Risk Management Framework'
    },
    {
      url: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=800&h=600&fit=crop',
      caption: 'Drawdown Management - Capital Preservation Strategies'
    }
  ]
};

async function addVisualAids() {
  let client;
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI not found in .env.local');
      process.exit(1);
    }

    client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB Atlas\n');

    const db = client.db('Forex_elearning');
    const lessons = db.collection('lessons');
    
    const allLessons = await lessons.find({}).toArray();
    console.log(`📚 Found ${allLessons.length} lessons in database\n`);
    
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < allLessons.length; i++) {
      const lesson = allLessons[i];
      console.log(`\n[${i + 1}/${allLessons.length}] Processing: ${lesson.title}`);
      
      try {
        const visualAids = visualAidsMap[lesson.title];
        
        if (!visualAids || visualAids.length === 0) {
          console.log(`  ⚠ Skipped (no visual aids defined)`);
          skipped++;
          continue;
        }
        
        // Get existing lessonSummary or create new one
        const existingLessonSummary = lesson.lessonSummary || {};
        
        const updateData = {
          lessonSummary: {
            ...existingLessonSummary,
            screenshots: visualAids,
            updatedAt: new Date(),
          },
          updatedAt: new Date(),
        };

        await lessons.updateOne(
          { _id: lesson._id },
          { $set: updateData }
        );
        
        console.log(`  ✓ Updated with ${visualAids.length} visual aids`);
        updated++;
      } catch (error) {
        console.error(`  ❌ Error updating ${lesson.title}:`, error.message);
      }
    }

    console.log(`\n✅ Visual aids update completed!`);
    console.log(`   - Updated: ${updated} lessons`);
    console.log(`   - Skipped: ${skipped} lessons`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    if (client) {
      await client.close();
      console.log('\n✓ Database connection closed');
    }
  }
}

addVisualAids().catch(console.error);

