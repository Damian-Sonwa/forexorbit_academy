/**
 * Database Seeder (JavaScript version)
 * Populates MongoDB Atlas with sample data for testing
 * Run with: node seed/seed.js
 */

const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Load .env.local file manually if dotenv doesn't find it
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  // Try current directory
  require('dotenv').config({ path: '.env.local' });
}

async function seed() {
  try {
    console.log('🌱 Starting database seed...');
    
    // Validate MONGO_URI
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGO_URI not defined in .env.local');
    }
    
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    const db = client.db('Forex_elearning');
    
    // Clear existing collections (optional - comment out if you want to keep existing data)
    // WARNING: Uncommenting these will DELETE ALL YOUR DATA!
    // Only uncomment if you want to start fresh with seed data
    /*
    console.log('🗑️  Clearing existing collections...');
    await db.collection('users').deleteMany({});
    await db.collection('courses').deleteMany({});
    await db.collection('lessons').deleteMany({});
    await db.collection('quizzes').deleteMany({});
    await db.collection('progress').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('quizScores').deleteMany({});
    await db.collection('instructors').deleteMany({});
    await db.collection('communityRooms').deleteMany({});
    await db.collection('communityMessages').deleteMany({});
    await db.collection('communityNews').deleteMany({});
    */
    
    // Hash password for demo users
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    // Seed Users with diverse names from different continents (especially Africa)
    console.log('👥 Seeding users...');
    
    // Create diverse student users with African and international names
    const studentNames = [
      // African Names
      { name: 'Amina Okafor', email: 'amina.okafor@demo.com', points: 2850, region: 'Nigeria' },
      { name: 'Kwame Mensah', email: 'kwame.mensah@demo.com', points: 3200, region: 'Ghana' },
      { name: 'Zainab Diallo', email: 'zainab.diallo@demo.com', points: 2750, region: 'Senegal' },
      { name: 'Thabo Mthembu', email: 'thabo.mthembu@demo.com', points: 3100, region: 'South Africa' },
      { name: 'Fatima Hassan', email: 'fatima.hassan@demo.com', points: 2900, region: 'Kenya' },
      { name: 'Kofi Asante', email: 'kofi.asante@demo.com', points: 2650, region: 'Ghana' },
      { name: 'Naledi Dlamini', email: 'naledi.dlamini@demo.com', points: 3000, region: 'South Africa' },
      { name: 'Ibrahim Sow', email: 'ibrahim.sow@demo.com', points: 2800, region: 'Mali' },
      { name: 'Aisha Kamau', email: 'aisha.kamau@demo.com', points: 2950, region: 'Kenya' },
      { name: 'Babatunde Adeyemi', email: 'babatunde.adeyemi@demo.com', points: 2700, region: 'Nigeria' },
      { name: 'Mariam Keita', email: 'mariam.keita@demo.com', points: 2550, region: 'Mali' },
      { name: 'Sipho Nkomo', email: 'sipho.nkomo@demo.com', points: 2400, region: 'Zimbabwe' },
      { name: 'Halima Bello', email: 'halima.bello@demo.com', points: 2600, region: 'Nigeria' },
      { name: 'Tendai Chikamhi', email: 'tendai.chikamhi@demo.com', points: 2500, region: 'Zimbabwe' },
      { name: 'Yemi Oladele', email: 'yemi.oladele@demo.com', points: 2450, region: 'Nigeria' },
      // Other Continents
      { name: 'Raj Patel', email: 'raj.patel@demo.com', points: 2200, region: 'India' },
      { name: 'Maria Santos', email: 'maria.santos@demo.com', points: 2100, region: 'Brazil' },
      { name: 'Chen Wei', email: 'chen.wei@demo.com', points: 2300, region: 'China' },
      { name: 'Ahmed Al-Mansouri', email: 'ahmed.almansouri@demo.com', points: 2150, region: 'UAE' },
      { name: 'Sofia Rodriguez', email: 'sofia.rodriguez@demo.com', points: 2000, region: 'Mexico' },
      { name: 'Hiroshi Tanaka', email: 'hiroshi.tanaka@demo.com', points: 2250, region: 'Japan' },
      { name: 'Priya Sharma', email: 'priya.sharma@demo.com', points: 2050, region: 'India' },
      { name: 'Carlos Mendez', email: 'carlos.mendez@demo.com', points: 1950, region: 'Colombia' },
      { name: 'Li Ming', email: 'li.ming@demo.com', points: 2350, region: 'China' },
      { name: 'Fatima Al-Zahra', email: 'fatima.alzahra@demo.com', points: 1900, region: 'Egypt' },
      { name: 'James Wilson', email: 'james.wilson@demo.com', points: 1800, region: 'USA' },
      { name: 'Emma Thompson', email: 'emma.thompson@demo.com', points: 1750, region: 'UK' },
      { name: 'Jean Dubois', email: 'jean.dubois@demo.com', points: 1850, region: 'France' },
      { name: 'Giulia Romano', email: 'giulia.romano@demo.com', points: 1700, region: 'Italy' },
    ];
    
    const studentUsers = studentNames.map(student => ({
      name: student.name,
      email: student.email,
      password: hashedPassword,
      role: 'student',
      status: 'approved', // Students are automatically approved
      points: student.points || 0,
      region: student.region,
      learningLevel: 'beginner', // All new students start at beginner level
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    
    const users = await db.collection('users').insertMany([
      ...studentUsers,
      {
        name: 'Demo Student',
      email: 'student@demo.com',
      password: hashedPassword,
      role: 'student',
      status: 'approved', // Students are automatically approved
      points: 1500,
      learningLevel: 'beginner', // Default to beginner
      createdAt: new Date(),
      updatedAt: new Date(),
      },
      {
        name: 'Super Admin',
        email: 'madudamian25@gmail.com',
        password: hashedPassword,
        role: 'superadmin',
        status: 'approved', // Super Admin is always approved
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Demo Instructor',
        email: 'instructor@demo.com',
        password: hashedPassword,
        role: 'instructor',
        status: 'approved', // Approved for demo purposes
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Admin User',
        email: 'admin@demo.com',
        password: hashedPassword,
        role: 'admin',
        status: 'approved', // Approved for demo purposes
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Pending Instructor',
        email: 'pending.instructor@demo.com',
        password: hashedPassword,
        role: 'instructor',
        status: 'pending', // Pending approval for demo
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Pending Admin',
        email: 'pending.admin@demo.com',
        password: hashedPassword,
        role: 'admin',
        status: 'pending', // Pending approval for demo
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    const studentIds = Object.values(users.insertedIds).slice(0, studentNames.length).map(id => id.toString());
    const demoStudentId = users.insertedIds[studentNames.length].toString();
    const superAdminId = users.insertedIds[studentNames.length + 1].toString();
    const instructorId = users.insertedIds[studentNames.length + 2].toString();
    const adminId = users.insertedIds[studentNames.length + 3].toString();
    
    // Seed Courses
    console.log('📚 Seeding courses...');
    const courses = await db.collection('courses').insertMany([
      // BEGINNER LEVEL COURSES
      {
        title: 'Forex Trading Fundamentals',
        description: 'Complete introduction to Forex trading covering market basics, currency pairs, market operations, chart reading, risk management, and trading psychology.',
        category: 'basics',
        difficulty: 'beginner',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Technical Basics',
        description: 'Learn essential technical analysis tools including candlestick patterns, support & resistance, trend lines, moving averages, and entry/exit strategies.',
        category: 'technical',
        difficulty: 'beginner',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Forex Basics',
        description: 'Learn the fundamentals of Forex trading, including currency pairs, market structure, and basic terminology.',
        category: 'basics',
        difficulty: 'beginner',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // INTERMEDIATE LEVEL COURSES
      {
        title: 'Technical Analysis',
        description: 'Master technical analysis techniques including advanced candlestick patterns, indicators, oscillators, Fibonacci, chart patterns, and swing trading strategies.',
        category: 'technical',
        difficulty: 'intermediate',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Trading Strategies',
        description: 'Learn intermediate trading strategies including risk-reward ratios, position sizing, stop loss & take profit, automated trading tools, and advanced psychology.',
        category: 'trading',
        difficulty: 'intermediate',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ADVANCED LEVEL COURSES
      {
        title: 'Algorithmic Trading & Automation',
        description: 'Master algorithmic trading, Forex bots, backtesting, strategy optimization, and advanced risk management for automated trading systems.',
        category: 'trading',
        difficulty: 'advanced',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Professional Forex Trading',
        description: 'Advanced professional trading covering market sentiment analysis, hedging & leverage, portfolio management, macro economics, and elite trading psychology.',
        category: 'trading',
        difficulty: 'advanced',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Advanced Forex Trading',
        description: 'Advanced trading strategies, risk management, and professional trading techniques.',
        category: 'trading',
        difficulty: 'advanced',
        instructorId: instructorId,
        thumbnail: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    // Course IDs for reference
    const course1Id = courses.insertedIds[0].toString(); // Forex Trading Fundamentals (Beginner)
    const course2Id = courses.insertedIds[1].toString(); // Technical Basics (Beginner)
    const course3Id = courses.insertedIds[2].toString(); // Forex Basics (Beginner)
    const course4Id = courses.insertedIds[3].toString(); // Technical Analysis (Intermediate)
    const course5Id = courses.insertedIds[4].toString(); // Trading Strategies (Intermediate)
    const course6Id = courses.insertedIds[5].toString(); // Algorithmic Trading & Automation (Advanced)
    const course7Id = courses.insertedIds[6].toString(); // Professional Forex Trading (Advanced)
    const course8Id = courses.insertedIds[7].toString(); // Advanced Forex Trading (Advanced)
    
    // Seed Lessons
    console.log('📖 Seeding lessons...');
    const lessons = await db.collection('lessons').insertMany([
      // ============================================
      // BEGINNER LEVEL: Forex Trading Fundamentals (Course 1)
      // ============================================
      {
        courseId: course1Id,
        title: 'Introduction to Forex',
        description: 'What is Forex trading and how does it work? Learn the fundamentals of the foreign exchange market.',
        summary: 'Forex, or Foreign Exchange, is the global marketplace where currencies are traded 24 hours a day, five days a week. This decentralized market is the largest financial market in the world, with daily trading volumes exceeding $7 trillion. Major participants include central banks, commercial banks, hedge funds, corporations, and retail traders. Unlike stock markets, Forex has no central exchange; instead, trading occurs electronically over-the-counter (OTC) through a network of banks and brokers. The market operates across three major trading sessions: Asian (Tokyo), European (London), and North American (New York), creating continuous trading opportunities. Key advantages include high liquidity, 24/5 accessibility, and the ability to profit from both rising and falling markets. Understanding how Forex markets operate is fundamental to becoming a successful trader, as it helps you identify the best times to trade and understand market dynamics.',
        lessonSummary: {
          overview: 'Forex, or Foreign Exchange, is the global marketplace where currencies are traded 24 hours a day, five days a week. This decentralized market is the largest financial market in the world, with daily trading volumes exceeding $7 trillion. Major participants include central banks, commercial banks, hedge funds, corporations, and retail traders. Unlike stock markets, Forex has no central exchange; instead, trading occurs electronically over-the-counter (OTC) through a network of banks and brokers. The market operates across three major trading sessions: Asian (Tokyo), European (London), and North American (New York), creating continuous trading opportunities. Key advantages include high liquidity, 24/5 accessibility, and the ability to profit from both rising and falling markets. Understanding how Forex markets operate is fundamental to becoming a successful trader, as it helps you identify the best times to trade and understand market dynamics.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Forex, or foreign exchange, is the global marketplace for trading currencies. In this lesson, you will learn the basics of how Forex markets operate, including market participants, trading volumes, and why Forex is the largest financial market in the world.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course1Id,
        title: 'Understanding Currency Pairs',
        description: 'Learn about major, minor, and exotic currency pairs and how to read currency quotes.',
        summary: 'Currency pairs are the foundation of Forex trading, representing the exchange rate between two currencies. A currency pair consists of a base currency (first) and a quote currency (second). For example, in EUR/USD, EUR is the base currency and USD is the quote currency. Major pairs include EUR/USD, GBP/USD, USD/JPY, and USD/CHF, which involve the US dollar and major world currencies. These pairs typically have the highest liquidity and tightest spreads. Minor pairs (cross pairs) don\'t include the US dollar, such as EUR/GBP or AUD/CAD. Exotic pairs combine a major currency with an emerging market currency, like USD/ZAR (US Dollar/South African Rand). The bid price is what buyers are willing to pay, while the ask price is what sellers want to receive. The difference between bid and ask is called the spread, which represents the broker\'s profit. A pip (Percentage in Point) is the smallest price movement, typically 0.0001 for most pairs. For example, if EUR/USD moves from 1.1000 to 1.1001, that\'s a 1-pip movement. Understanding currency pairs and how to read prices is essential for executing trades and calculating profits and losses accurately.',
        lessonSummary: {
          overview: 'Currency pairs are the foundation of Forex trading, representing the exchange rate between two currencies. A currency pair consists of a base currency (first) and a quote currency (second). For example, in EUR/USD, EUR is the base currency and USD is the quote currency. Major pairs include EUR/USD, GBP/USD, USD/JPY, and USD/CHF, which involve the US dollar and major world currencies. These pairs typically have the highest liquidity and tightest spreads. Minor pairs (cross pairs) don\'t include the US dollar, such as EUR/GBP or AUD/CAD. Exotic pairs combine a major currency with an emerging market currency, like USD/ZAR (US Dollar/South African Rand). The bid price is what buyers are willing to pay, while the ask price is what sellers want to receive. The difference between bid and ask is called the spread, which represents the broker\'s profit. A pip (Percentage in Point) is the smallest price movement, typically 0.0001 for most pairs. For example, if EUR/USD moves from 1.1000 to 1.1001, that\'s a 1-pip movement. Understanding currency pairs and how to read prices is essential for executing trades and calculating profits and losses accurately.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Currency pairs are the foundation of Forex trading. This lesson covers major pairs like EUR/USD, GBP/USD, and USD/JPY, as well as minor and exotic pairs. You will learn how to read bid/ask prices and understand pip values.</p>',
        order: 2,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course1Id,
        title: 'How Forex Market Works',
        description: 'Understanding the mechanics of Forex trading, including market structure, liquidity, and execution.',
        summary: 'The Forex market operates through a network of participants that facilitate currency trading. Brokers act as intermediaries between retail traders and the interbank market, providing trading platforms and access to currency pairs. Market makers are large financial institutions that quote both buy and sell prices, creating liquidity by being ready to trade at any time. ECNs (Electronic Communication Networks) connect traders directly with other market participants, matching buy and sell orders electronically. The spread is the difference between the bid (sell) and ask (buy) prices, which represents the cost of trading. For example, if EUR/USD is quoted at 1.1000/1.1002, the spread is 2 pips. Slippage occurs when your order is executed at a different price than expected, often during volatile market conditions or when trading large positions. Market orders execute immediately at the current market price, while limit orders wait for a specific price to be reached. Stop orders automatically close positions when prices reach predetermined levels. Understanding market mechanics helps you choose the right broker, minimize trading costs, and execute trades more effectively.',
        lessonSummary: {
          overview: 'The Forex market operates through a network of participants that facilitate currency trading. Brokers act as intermediaries between retail traders and the interbank market, providing trading platforms and access to currency pairs. Market makers are large financial institutions that quote both buy and sell prices, creating liquidity by being ready to trade at any time. ECNs (Electronic Communication Networks) connect traders directly with other market participants, matching buy and sell orders electronically. The spread is the difference between the bid (sell) and ask (buy) prices, which represents the cost of trading. For example, if EUR/USD is quoted at 1.1000/1.1002, the spread is 2 pips. Slippage occurs when your order is executed at a different price than expected, often during volatile market conditions or when trading large positions. Market orders execute immediately at the current market price, while limit orders wait for a specific price to be reached. Stop orders automatically close positions when prices reach predetermined levels. Understanding market mechanics helps you choose the right broker, minimize trading costs, and execute trades more effectively.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Learn how the Forex market operates, including the role of brokers, market makers, and ECNs. Understand spreads, slippage, and how orders are executed in the market.</p>',
        order: 3,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course1Id,
        title: 'Reading Forex Charts',
        description: 'Introduction to Forex charts, timeframes, and basic chart analysis techniques.',
        summary: 'Forex charts are visual representations of price movements over time and are essential tools for technical analysis. Line charts connect closing prices with a simple line, providing a clear view of overall price direction but lacking detail about price action within each period. Bar charts show open, high, low, and close (OHLC) prices for each time period, with vertical lines representing the price range and horizontal marks indicating open and close prices. Candlestick charts, the most popular among traders, display the same OHLC data but in a more visually intuitive format, with colored bodies (green/white for up, red/black for down) and wicks showing price extremes. Timeframes range from minutes (M1, M5, M15) for scalping to hours (H1, H4) for day trading, and daily/weekly charts for swing trading. An uptrend is characterized by higher highs and higher lows, while a downtrend shows lower highs and lower lows. Sideways or ranging markets occur when prices move within a horizontal channel. Charts help identify support (price floors where buying pressure increases) and resistance (price ceilings where selling pressure increases) levels. Learning to read charts effectively is crucial for identifying trading opportunities and making informed entry and exit decisions.',
        lessonSummary: {
          overview: 'Forex charts are visual representations of price movements over time and are essential tools for technical analysis. Line charts connect closing prices with a simple line, providing a clear view of overall price direction but lacking detail about price action within each period. Bar charts show open, high, low, and close (OHLC) prices for each time period, with vertical lines representing the price range and horizontal marks indicating open and close prices. Candlestick charts, the most popular among traders, display the same OHLC data but in a more visually intuitive format, with colored bodies (green/white for up, red/black for down) and wicks showing price extremes. Timeframes range from minutes (M1, M5, M15) for scalping to hours (H1, H4) for day trading, and daily/weekly charts for swing trading. An uptrend is characterized by higher highs and higher lows, while a downtrend shows lower highs and lower lows. Sideways or ranging markets occur when prices move within a horizontal channel. Charts help identify support (price floors where buying pressure increases) and resistance (price ceilings where selling pressure increases) levels. Learning to read charts effectively is crucial for identifying trading opportunities and making informed entry and exit decisions.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Charts are essential tools for Forex trading. Learn about different chart types (line, bar, candlestick), timeframes, and how to identify basic price patterns and trends.</p>',
        order: 4,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course1Id,
        title: 'Basic Risk Management',
        description: 'Learn fundamental risk management principles to protect your trading capital.',
        summary: 'Risk management is the most critical aspect of successful Forex trading, as it protects your capital and ensures long-term survival in the markets. Position sizing determines how much money you risk on each trade, typically expressed as a percentage of your account balance. Most professional traders risk only 1-2% of their account per trade, meaning with a $10,000 account, you would risk $100-$200 per trade. The risk-reward ratio compares the potential profit to the potential loss of a trade; a 1:2 ratio means you stand to make $2 for every $1 you risk. For example, if you enter a trade with a 50-pip stop loss and a 100-pip take profit, your risk-reward ratio is 1:2. Lot size determines the actual dollar value of each pip movement; a standard lot is 100,000 units, a mini lot is 10,000 units, and a micro lot is 1,000 units. If you trade one standard lot of EUR/USD, each pip movement equals approximately $10. To calculate position size, divide your risk amount by your stop loss in pips, then adjust for lot size. Proper risk management prevents catastrophic losses and allows you to recover from losing streaks, making it the foundation of profitable trading.',
        lessonSummary: {
          overview: 'Risk management is the most critical aspect of successful Forex trading, as it protects your capital and ensures long-term survival in the markets. Position sizing determines how much money you risk on each trade, typically expressed as a percentage of your account balance. Most professional traders risk only 1-2% of their account per trade, meaning with a $10,000 account, you would risk $100-$200 per trade. The risk-reward ratio compares the potential profit to the potential loss of a trade; a 1:2 ratio means you stand to make $2 for every $1 you risk. For example, if you enter a trade with a 50-pip stop loss and a 100-pip take profit, your risk-reward ratio is 1:2. Lot size determines the actual dollar value of each pip movement; a standard lot is 100,000 units, a mini lot is 10,000 units, and a micro lot is 1,000 units. If you trade one standard lot of EUR/USD, each pip movement equals approximately $10. To calculate position size, divide your risk amount by your stop loss in pips, then adjust for lot size. Proper risk management prevents catastrophic losses and allows you to recover from losing streaks, making it the foundation of profitable trading.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Risk management is the most important aspect of trading. Learn about position sizing, risk-reward ratios, and how to calculate appropriate position sizes based on your account balance and risk tolerance.</p>',
        order: 5,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course1Id,
        title: 'Trading Psychology Basics',
        description: 'Understanding the psychological aspects of trading and how emotions affect decision-making.',
        summary: 'Trading psychology is often the difference between successful and unsuccessful traders, as emotions can override even the best trading strategies. Fear causes traders to exit winning positions too early or avoid taking valid trades, while greed leads to holding positions too long or risking too much capital. Revenge trading occurs when traders try to recover losses immediately after a losing trade, often leading to even larger losses due to emotional decision-making. FOMO (Fear of Missing Out) drives traders to enter trades without proper analysis, while overtrading happens when traders take too many positions, often due to boredom or the need for action. A trading plan is a written document that outlines your trading strategy, risk management rules, entry and exit criteria, and psychological guidelines. Discipline means following your trading plan consistently, even when emotions tempt you to deviate. Keeping a trading journal helps identify psychological patterns and improve decision-making over time. Meditation, exercise, and proper sleep can improve mental clarity and emotional control. Understanding and managing your emotions is essential because even the best strategy will fail if you cannot execute it consistently due to psychological barriers.',
        lessonSummary: {
          overview: 'Trading psychology is often the difference between successful and unsuccessful traders, as emotions can override even the best trading strategies. Fear causes traders to exit winning positions too early or avoid taking valid trades, while greed leads to holding positions too long or risking too much capital. Revenge trading occurs when traders try to recover losses immediately after a losing trade, often leading to even larger losses due to emotional decision-making. FOMO (Fear of Missing Out) drives traders to enter trades without proper analysis, while overtrading happens when traders take too many positions, often due to boredom or the need for action. A trading plan is a written document that outlines your trading strategy, risk management rules, entry and exit criteria, and psychological guidelines. Discipline means following your trading plan consistently, even when emotions tempt you to deviate. Keeping a trading journal helps identify psychological patterns and improve decision-making over time. Meditation, exercise, and proper sleep can improve mental clarity and emotional control. Understanding and managing your emotions is essential because even the best strategy will fail if you cannot execute it consistently due to psychological barriers.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Trading psychology is crucial for success. Learn about common emotional pitfalls like fear, greed, and revenge trading. Develop a disciplined mindset and trading plan.</p>',
        order: 6,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ============================================
      // BEGINNER LEVEL: Technical Basics (Course 2)
      // ============================================
      {
        courseId: course2Id,
        title: 'Candlestick Patterns',
        description: 'Learn essential candlestick patterns for identifying market sentiment and potential reversals.',
        summary: 'Candlestick patterns are visual representations of price action that reveal market psychology and potential price reversals or continuations. Each candlestick shows the open, high, low, and close prices for a specific time period, with the body representing the price range between open and close, and wicks (shadows) showing price extremes. A doji pattern occurs when open and close prices are nearly equal, forming a cross-like shape that indicates market indecision and potential reversal. The hammer pattern has a small body at the top with a long lower wick, suggesting buyers are stepping in after a decline, often signaling a bullish reversal. An engulfing pattern happens when a larger candlestick completely covers the previous one; a bullish engulfing (green covering red) suggests upward momentum, while a bearish engulfing (red covering green) indicates downward pressure. The shooting star has a small body at the bottom with a long upper wick, appearing at the top of uptrends and warning of potential bearish reversal. These patterns work best when confirmed by other technical indicators and when they appear at key support or resistance levels. Learning to recognize candlestick patterns helps traders identify entry and exit points with higher probability, making them essential tools for technical analysis.',
        lessonSummary: {
          overview: 'Candlestick patterns are visual representations of price action that reveal market psychology and potential price reversals or continuations. Each candlestick shows the open, high, low, and close prices for a specific time period, with the body representing the price range between open and close, and wicks (shadows) showing price extremes. A doji pattern occurs when open and close prices are nearly equal, forming a cross-like shape that indicates market indecision and potential reversal. The hammer pattern has a small body at the top with a long lower wick, suggesting buyers are stepping in after a decline, often signaling a bullish reversal. An engulfing pattern happens when a larger candlestick completely covers the previous one; a bullish engulfing (green covering red) suggests upward momentum, while a bearish engulfing (red covering green) indicates downward pressure. The shooting star has a small body at the bottom with a long upper wick, appearing at the top of uptrends and warning of potential bearish reversal. These patterns work best when confirmed by other technical indicators and when they appear at key support or resistance levels. Learning to recognize candlestick patterns helps traders identify entry and exit points with higher probability, making them essential tools for technical analysis.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Candlestick patterns provide valuable insights into market psychology. Learn about common patterns like doji, hammer, engulfing, and shooting star, and how to use them in your trading.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course2Id,
        title: 'Support & Resistance',
        description: 'Understanding key price levels that act as barriers in the market.',
        summary: 'Support and resistance levels are fundamental concepts in technical analysis that represent price levels where buying or selling pressure is strong enough to halt or reverse price movement. Support is a price level where buying interest is strong enough to prevent prices from falling further, acting like a floor that bounces prices upward. Resistance is a price level where selling pressure is sufficient to stop prices from rising, acting like a ceiling that pushes prices downward. These levels can be identified by looking at historical price action where prices have repeatedly reversed direction, forming horizontal lines on your chart. For example, if EUR/USD has bounced off 1.1000 three times, that level becomes strong support. The more times a price level is tested, the stronger it becomes; however, if support is broken, it often becomes resistance, and vice versa. Psychological levels (round numbers like 1.1000, 1.2000) also act as support and resistance because traders tend to place orders at these levels. When price breaks through support or resistance, it often continues in that direction with momentum, creating trading opportunities. Using support and resistance levels helps traders identify optimal entry points (buying near support, selling near resistance) and set stop-loss orders just beyond these levels to manage risk effectively.',
        lessonSummary: {
          overview: 'Support and resistance levels are fundamental concepts in technical analysis that represent price levels where buying or selling pressure is strong enough to halt or reverse price movement. Support is a price level where buying interest is strong enough to prevent prices from falling further, acting like a floor that bounces prices upward. Resistance is a price level where selling pressure is sufficient to stop prices from rising, acting like a ceiling that pushes prices downward. These levels can be identified by looking at historical price action where prices have repeatedly reversed direction, forming horizontal lines on your chart. For example, if EUR/USD has bounced off 1.1000 three times, that level becomes strong support. The more times a price level is tested, the stronger it becomes; however, if support is broken, it often becomes resistance, and vice versa. Psychological levels (round numbers like 1.1000, 1.2000) also act as support and resistance because traders tend to place orders at these levels. When price breaks through support or resistance, it often continues in that direction with momentum, creating trading opportunities. Using support and resistance levels helps traders identify optimal entry points (buying near support, selling near resistance) and set stop-loss orders just beyond these levels to manage risk effectively.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Support and resistance levels are crucial for identifying entry and exit points in trading. Learn how to identify these levels, understand their significance, and use them in your trading strategy.</p>',
        order: 2,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course2Id,
        title: 'Trend Lines',
        description: 'How to draw and use trend lines to identify market direction and potential breakouts.',
        summary: 'Trend lines are diagonal lines drawn on price charts that connect significant price points, helping traders identify the direction and strength of market trends. An uptrend line is drawn by connecting two or more higher lows, creating a line that slopes upward and acts as dynamic support. A downtrend line connects two or more lower highs, sloping downward and acting as dynamic resistance. To draw a valid trend line, you need at least two touch points, but three or more touches make it more reliable. For example, if EUR/USD makes lows at 1.1000, 1.1050, and 1.1100, connecting these points creates an uptrend line showing the trend\'s trajectory. When price breaks through a trend line, it often signals a potential trend reversal or pause. A break of an uptrend line suggests the uptrend may be ending, while breaking a downtrend line indicates potential upward momentum. The angle of the trend line indicates trend strength; steeper lines suggest stronger trends but are more likely to break, while gentler slopes indicate more sustainable trends. Trend lines can also be used to identify entry points (buying when price touches an uptrend line) and exit points (selling when price breaks below an uptrend line). Combining trend lines with other technical tools like support/resistance and candlestick patterns increases the reliability of trading signals.',
        lessonSummary: {
          overview: 'Trend lines are diagonal lines drawn on price charts that connect significant price points, helping traders identify the direction and strength of market trends. An uptrend line is drawn by connecting two or more higher lows, creating a line that slopes upward and acts as dynamic support. A downtrend line connects two or more lower highs, sloping downward and acting as dynamic resistance. To draw a valid trend line, you need at least two touch points, but three or more touches make it more reliable. For example, if EUR/USD makes lows at 1.1000, 1.1050, and 1.1100, connecting these points creates an uptrend line showing the trend\'s trajectory. When price breaks through a trend line, it often signals a potential trend reversal or pause. A break of an uptrend line suggests the uptrend may be ending, while breaking a downtrend line indicates potential upward momentum. The angle of the trend line indicates trend strength; steeper lines suggest stronger trends but are more likely to break, while gentler slopes indicate more sustainable trends. Trend lines can also be used to identify entry points (buying when price touches an uptrend line) and exit points (selling when price breaks below an uptrend line). Combining trend lines with other technical tools like support/resistance and candlestick patterns increases the reliability of trading signals.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Trend lines are simple yet powerful tools for identifying market trends. Learn how to draw trend lines correctly, identify uptrends and downtrends, and use trend line breaks as trading signals.</p>',
        order: 3,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course2Id,
        title: 'Simple Moving Averages (SMA)',
        description: 'Introduction to moving averages and how to use them to identify trends and entry points.',
        summary: 'Moving averages are technical indicators that smooth out price fluctuations by calculating the average price over a specific number of periods, making it easier to identify trends and filter out market noise. A Simple Moving Average (SMA) calculates the average closing price over a set number of periods; for example, a 20-period SMA adds the last 20 closing prices and divides by 20. If EUR/USD closes at 1.1000, 1.1005, 1.1010 over three days, the 3-period SMA would be (1.1000 + 1.1005 + 1.1010) / 3 = 1.1005. When price is above the moving average, it generally indicates an uptrend, while price below the moving average suggests a downtrend. Shorter period moving averages (like 10 or 20) react faster to price changes but generate more false signals, while longer periods (50 or 200) are slower but more reliable for identifying major trends. The 200-day moving average is particularly important as many traders use it to determine long-term market direction. When a shorter moving average crosses above a longer one (golden cross), it signals potential upward momentum; when it crosses below (death cross), it suggests downward pressure. Moving averages also act as dynamic support in uptrends and dynamic resistance in downtrends, providing entry and exit points. Using moving averages helps traders stay aligned with the overall trend and avoid trading against the market direction.',
        lessonSummary: {
          overview: 'Moving averages are technical indicators that smooth out price fluctuations by calculating the average price over a specific number of periods, making it easier to identify trends and filter out market noise. A Simple Moving Average (SMA) calculates the average closing price over a set number of periods; for example, a 20-period SMA adds the last 20 closing prices and divides by 20. If EUR/USD closes at 1.1000, 1.1005, 1.1010 over three days, the 3-period SMA would be (1.1000 + 1.1005 + 1.1010) / 3 = 1.1005. When price is above the moving average, it generally indicates an uptrend, while price below the moving average suggests a downtrend. Shorter period moving averages (like 10 or 20) react faster to price changes but generate more false signals, while longer periods (50 or 200) are slower but more reliable for identifying major trends. The 200-day moving average is particularly important as many traders use it to determine long-term market direction. When a shorter moving average crosses above a longer one (golden cross), it signals potential upward momentum; when it crosses below (death cross), it suggests downward pressure. Moving averages also act as dynamic support in uptrends and dynamic resistance in downtrends, providing entry and exit points. Using moving averages helps traders stay aligned with the overall trend and avoid trading against the market direction.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Moving averages smooth out price data to help identify trends. Learn about simple moving averages (SMA), how to calculate them, and how to use them in conjunction with price action for trading signals.</p>',
        order: 4,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course2Id,
        title: 'Entry & Exit Points',
        description: 'Learn how to identify optimal entry and exit points for your trades using technical analysis.',
        summary: 'Identifying optimal entry and exit points is crucial for profitable trading, and the best results come from combining multiple technical analysis tools rather than relying on a single indicator. A high-probability entry occurs when multiple signals align; for example, buying when price bounces off support, forms a bullish candlestick pattern (like a hammer), is above a rising moving average, and the trend line confirms upward momentum. Exit points can be set at resistance levels, when bearish reversal patterns appear, when price breaks below a trend line, or when the risk-reward target is reached. For instance, if you enter a long position at support (1.1000) with a stop loss at 1.0950 (50 pips risk) and take profit at resistance (1.1100), you achieve a 1:2 risk-reward ratio. Confluence occurs when multiple technical tools point to the same price level, significantly increasing the probability of a successful trade. Divergence between indicators can signal weakening trends; for example, if price makes new highs but the RSI makes lower highs, it suggests the uptrend may be losing strength. Timeframe analysis is important; use higher timeframes (daily, weekly) to identify the overall trend, then use lower timeframes (1-hour, 4-hour) to find precise entry points. Patience is key—waiting for multiple confirmations before entering reduces false signals and improves win rates. Mastering entry and exit timing separates profitable traders from those who struggle, as proper timing maximizes profits while minimizing losses.',
        lessonSummary: {
          overview: 'Identifying optimal entry and exit points is crucial for profitable trading, and the best results come from combining multiple technical analysis tools rather than relying on a single indicator. A high-probability entry occurs when multiple signals align; for example, buying when price bounces off support, forms a bullish candlestick pattern (like a hammer), is above a rising moving average, and the trend line confirms upward momentum. Exit points can be set at resistance levels, when bearish reversal patterns appear, when price breaks below a trend line, or when the risk-reward target is reached. For instance, if you enter a long position at support (1.1000) with a stop loss at 1.0950 (50 pips risk) and take profit at resistance (1.1100), you achieve a 1:2 risk-reward ratio. Confluence occurs when multiple technical tools point to the same price level, significantly increasing the probability of a successful trade. Divergence between indicators can signal weakening trends; for example, if price makes new highs but the RSI makes lower highs, it suggests the uptrend may be losing strength. Timeframe analysis is important; use higher timeframes (daily, weekly) to identify the overall trend, then use lower timeframes (1-hour, 4-hour) to find precise entry points. Patience is key—waiting for multiple confirmations before entering reduces false signals and improves win rates. Mastering entry and exit timing separates profitable traders from those who struggle, as proper timing maximizes profits while minimizing losses.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Timing is everything in trading. Learn how to combine candlestick patterns, support/resistance, trend lines, and moving averages to identify high-probability entry and exit points.</p>',
        order: 5,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ============================================
      // BEGINNER LEVEL: Forex Basics (Course 3) - Existing course, keep existing lessons
      // ============================================
      {
        courseId: course3Id,
        title: 'Introduction to Forex',
        description: 'What is Forex trading and how does it work?',
        summary: 'Forex trading involves buying and selling currencies in pairs, with the goal of profiting from exchange rate fluctuations. When you buy EUR/USD, you are buying euros while simultaneously selling US dollars, betting that the euro will strengthen against the dollar. The exchange rate tells you how much of the quote currency you need to buy one unit of the base currency; if EUR/USD is 1.1000, it means 1 euro equals 1.10 US dollars. Currency values fluctuate based on economic factors, political events, interest rates, and market sentiment. Unlike stocks, Forex markets operate 24 hours a day during weekdays, allowing traders worldwide to participate at any time. Leverage allows traders to control larger positions with smaller amounts of capital; for example, with 100:1 leverage, you can control $100,000 with just $1,000. However, leverage amplifies both profits and losses, making risk management essential. Understanding these basics is the first step toward becoming a successful Forex trader, as it provides the foundation for all advanced trading concepts and strategies.',
        lessonSummary: {
          overview: 'Forex trading involves buying and selling currencies in pairs, with the goal of profiting from exchange rate fluctuations. When you buy EUR/USD, you are buying euros while simultaneously selling US dollars, betting that the euro will strengthen against the dollar. The exchange rate tells you how much of the quote currency you need to buy one unit of the base currency; if EUR/USD is 1.1000, it means 1 euro equals 1.10 US dollars. Currency values fluctuate based on economic factors, political events, interest rates, and market sentiment. Unlike stocks, Forex markets operate 24 hours a day during weekdays, allowing traders worldwide to participate at any time. Leverage allows traders to control larger positions with smaller amounts of capital; for example, with 100:1 leverage, you can control $100,000 with just $1,000. However, leverage amplifies both profits and losses, making risk management essential. Understanding these basics is the first step toward becoming a successful Forex trader, as it provides the foundation for all advanced trading concepts and strategies.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Forex, or foreign exchange, is the global marketplace for trading currencies. In this lesson, you will learn the basics of how Forex markets operate.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course3Id,
        title: 'Understanding Currency Pairs',
        description: 'Learn about major, minor, and exotic currency pairs.',
        summary: 'Currency pairs represent the relative value of one currency against another and form the basis of all Forex trading. Major pairs always include the US dollar paired with another major currency, such as EUR/USD (Euro/US Dollar), GBP/USD (British Pound/US Dollar), USD/JPY (US Dollar/Japanese Yen), and USD/CHF (US Dollar/Swiss Franc). These pairs account for approximately 80% of all Forex trading volume and typically have the tightest spreads (the difference between buy and sell prices), making them ideal for beginners. EUR/USD is the most traded pair globally, often called "the fiber," and is known for its liquidity and relatively predictable movements. GBP/USD, known as "cable," tends to be more volatile due to economic and political factors affecting the UK. USD/JPY is popular among Asian session traders and is influenced by Bank of Japan policies and Japanese economic data. When trading these pairs, you are essentially speculating on which currency will strengthen or weaken relative to the other. Understanding the characteristics of major pairs helps traders choose appropriate pairs based on their trading style, risk tolerance, and the time of day they prefer to trade.',
        lessonSummary: {
          overview: 'Currency pairs represent the relative value of one currency against another and form the basis of all Forex trading. Major pairs always include the US dollar paired with another major currency, such as EUR/USD (Euro/US Dollar), GBP/USD (British Pound/US Dollar), USD/JPY (US Dollar/Japanese Yen), and USD/CHF (US Dollar/Swiss Franc). These pairs account for approximately 80% of all Forex trading volume and typically have the tightest spreads (the difference between buy and sell prices), making them ideal for beginners. EUR/USD is the most traded pair globally, often called "the fiber," and is known for its liquidity and relatively predictable movements. GBP/USD, known as "cable," tends to be more volatile due to economic and political factors affecting the UK. USD/JPY is popular among Asian session traders and is influenced by Bank of Japan policies and Japanese economic data. When trading these pairs, you are essentially speculating on which currency will strengthen or weaken relative to the other. Understanding the characteristics of major pairs helps traders choose appropriate pairs based on their trading style, risk tolerance, and the time of day they prefer to trade.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Currency pairs are the foundation of Forex trading. This lesson covers major pairs like EUR/USD, GBP/USD, and USD/JPY.</p>',
        order: 2,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course3Id,
        title: 'Market Hours and Sessions',
        description: 'Understanding when Forex markets are open.',
        summary: 'The Forex market operates 24 hours a day, five days a week, divided into three major trading sessions that overlap at certain times, creating continuous trading opportunities. The Asian session begins with the Tokyo market opening (around 11 PM GMT) and includes Sydney, Tokyo, and Singapore markets, typically showing lower volatility and smaller price movements. Major pairs like USD/JPY, AUD/USD, and NZD/USD are most active during this session. The European session starts when London opens (around 7 AM GMT) and is the most liquid session, accounting for the highest trading volume, especially when it overlaps with the Asian session. EUR/USD, GBP/USD, and EUR/GBP pairs are most active during European hours. The North American session begins with New York opening (around 12 PM GMT) and sees high volatility, especially during the first few hours when it overlaps with the European session (12 PM to 4 PM GMT), creating the most active trading period of the day. USD pairs are most liquid during this time. Session overlaps provide the best trading opportunities due to increased liquidity and volatility. Understanding session characteristics helps traders choose the best times to trade based on their preferred pairs and trading style, as different sessions offer different market conditions and opportunities.',
        lessonSummary: {
          overview: 'The Forex market operates 24 hours a day, five days a week, divided into three major trading sessions that overlap at certain times, creating continuous trading opportunities. The Asian session begins with the Tokyo market opening (around 11 PM GMT) and includes Sydney, Tokyo, and Singapore markets, typically showing lower volatility and smaller price movements. Major pairs like USD/JPY, AUD/USD, and NZD/USD are most active during this session. The European session starts when London opens (around 7 AM GMT) and is the most liquid session, accounting for the highest trading volume, especially when it overlaps with the Asian session. EUR/USD, GBP/USD, and EUR/GBP pairs are most active during European hours. The North American session begins with New York opening (around 12 PM GMT) and sees high volatility, especially during the first few hours when it overlaps with the European session (12 PM to 4 PM GMT), creating the most active trading period of the day. USD pairs are most liquid during this time. Session overlaps provide the best trading opportunities due to increased liquidity and volatility. Understanding session characteristics helps traders choose the best times to trade based on their preferred pairs and trading style, as different sessions offer different market conditions and opportunities.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>The Forex market operates 24 hours a day, five days a week. Learn about the different trading sessions.</p>',
        order: 3,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ============================================
      // INTERMEDIATE LEVEL: Technical Analysis (Course 4)
      // ============================================
      {
        courseId: course4Id,
        title: 'Advanced Candlestick Patterns',
        description: 'Master complex candlestick patterns and their implications for price movement.',
        summary: 'Advanced candlestick patterns consist of multiple candles that form specific shapes, providing stronger reversal or continuation signals than single-candle patterns. The morning star is a three-candle bullish reversal pattern appearing at the bottom of downtrends: first a large bearish candle, then a small-bodied candle (doji or spinning top) that gaps down, followed by a large bullish candle that gaps up and closes well into the first candle\'s body. The evening star is the bearish opposite, appearing at the top of uptrends and signaling potential downward reversal. Three white soldiers consist of three consecutive long bullish candles with small wicks, each closing higher than the previous, indicating strong buying pressure and continuation of an uptrend. Three black crows are the bearish counterpart, showing three consecutive bearish candles signaling strong selling pressure. The three-line strike pattern shows three candles moving in one direction, followed by a fourth candle that "strikes" back, engulfing the previous three and potentially reversing the trend. These patterns are more reliable when they appear at key support/resistance levels, when confirmed by volume (in other markets) or other indicators, and when they align with the overall market trend. Combining multiple patterns increases signal strength; for example, a morning star pattern at a major support level with bullish divergence on the RSI provides a very high-probability entry signal. Mastering advanced patterns helps traders identify significant market turning points and improves the accuracy of entry and exit decisions.',
        lessonSummary: {
          overview: 'Advanced candlestick patterns consist of multiple candles that form specific shapes, providing stronger reversal or continuation signals than single-candle patterns. The morning star is a three-candle bullish reversal pattern appearing at the bottom of downtrends: first a large bearish candle, then a small-bodied candle (doji or spinning top) that gaps down, followed by a large bullish candle that gaps up and closes well into the first candle\'s body. The evening star is the bearish opposite, appearing at the top of uptrends and signaling potential downward reversal. Three white soldiers consist of three consecutive long bullish candles with small wicks, each closing higher than the previous, indicating strong buying pressure and continuation of an uptrend. Three black crows are the bearish counterpart, showing three consecutive bearish candles signaling strong selling pressure. The three-line strike pattern shows three candles moving in one direction, followed by a fourth candle that "strikes" back, engulfing the previous three and potentially reversing the trend. These patterns are more reliable when they appear at key support/resistance levels, when confirmed by volume (in other markets) or other indicators, and when they align with the overall market trend. Combining multiple patterns increases signal strength; for example, a morning star pattern at a major support level with bullish divergence on the RSI provides a very high-probability entry signal. Mastering advanced patterns helps traders identify significant market turning points and improves the accuracy of entry and exit decisions.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Take your candlestick analysis to the next level. Learn about advanced patterns like three-line strikes, morning/evening stars, and how to combine multiple patterns for stronger signals.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course4Id,
        title: 'Indicators & Oscillators (RSI, MACD)',
        description: 'Learn to use technical indicators like RSI and MACD to identify overbought/oversold conditions and momentum.',
        summary: 'Technical indicators are mathematical calculations based on price and volume data that help traders identify trends, momentum, and potential reversal points. The Relative Strength Index (RSI) is an oscillator that measures the speed and magnitude of price changes, ranging from 0 to 100. RSI above 70 typically indicates overbought conditions (potential sell signal), while RSI below 30 suggests oversold conditions (potential buy signal). For example, if EUR/USD has been rising strongly and RSI reaches 75, it may be overbought and due for a pullback. The MACD (Moving Average Convergence Divergence) consists of two lines: the MACD line (difference between 12-period and 26-period EMAs) and the signal line (9-period EMA of the MACD line). When the MACD line crosses above the signal line, it generates a bullish signal; when it crosses below, it creates a bearish signal. The histogram (the difference between MACD and signal lines) shows the strength of momentum—taller bars indicate stronger momentum. Divergence occurs when price makes new highs but the indicator makes lower highs (bearish divergence) or when price makes new lows but the indicator makes higher lows (bullish divergence), often signaling potential trend reversals. These indicators work best when used together; for instance, RSI showing oversold conditions combined with MACD bullish crossover provides a stronger buy signal than either indicator alone. Understanding how to interpret these indicators helps traders confirm price action, identify entry/exit points, and avoid false signals.',
        lessonSummary: {
          overview: 'Technical indicators are mathematical calculations based on price and volume data that help traders identify trends, momentum, and potential reversal points. The Relative Strength Index (RSI) is an oscillator that measures the speed and magnitude of price changes, ranging from 0 to 100. RSI above 70 typically indicates overbought conditions (potential sell signal), while RSI below 30 suggests oversold conditions (potential buy signal). For example, if EUR/USD has been rising strongly and RSI reaches 75, it may be overbought and due for a pullback. The MACD (Moving Average Convergence Divergence) consists of two lines: the MACD line (difference between 12-period and 26-period EMAs) and the signal line (9-period EMA of the MACD line). When the MACD line crosses above the signal line, it generates a bullish signal; when it crosses below, it creates a bearish signal. The histogram (the difference between MACD and signal lines) shows the strength of momentum—taller bars indicate stronger momentum. Divergence occurs when price makes new highs but the indicator makes lower highs (bearish divergence) or when price makes new lows but the indicator makes higher lows (bullish divergence), often signaling potential trend reversals. These indicators work best when used together; for instance, RSI showing oversold conditions combined with MACD bullish crossover provides a stronger buy signal than either indicator alone. Understanding how to interpret these indicators helps traders confirm price action, identify entry/exit points, and avoid false signals.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Technical indicators help confirm price action and identify trading opportunities. Learn about RSI (Relative Strength Index), MACD (Moving Average Convergence Divergence), and how to interpret their signals.</p>',
        order: 2,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course4Id,
        title: 'Fibonacci Retracement & Extensions',
        description: 'Using Fibonacci levels to identify potential support, resistance, and price targets.',
        summary: 'Fibonacci retracements and extensions are based on the Fibonacci sequence, a mathematical pattern found throughout nature, and are used to identify potential support, resistance, and price target levels. Fibonacci retracement levels (23.6%, 38.2%, 50%, 61.8%, and 78.6%) are drawn from a significant swing high to a swing low (in uptrends) or from swing low to swing high (in downtrends). These levels represent potential areas where price may retrace before continuing in the original direction. For example, if EUR/USD rises from 1.1000 to 1.1200 and then retraces, the 38.2% Fibonacci level at 1.1124 and the 61.8% level at 1.1076 often act as support where buyers may step in. The 61.8% level, also called the "golden ratio," is considered the most significant retracement level. Fibonacci extensions (127.2%, 161.8%, 200%, 261.8%) are used to project potential price targets beyond the original swing, helping traders set take-profit levels. To draw Fibonacci correctly, identify the most significant swing point in the current trend; in an uptrend, draw from the lowest low to the highest high before the retracement begins. These levels work because many traders watch and place orders at these psychological levels, creating self-fulfilling prophecies. Fibonacci levels are most effective when they coincide with other technical levels like support/resistance, trend lines, or moving averages, creating areas of confluence. Using Fibonacci retracements helps traders identify high-probability entry points during pullbacks, while extensions help set realistic profit targets based on mathematical relationships in price movements.',
        lessonSummary: {
          overview: 'Fibonacci retracements and extensions are based on the Fibonacci sequence, a mathematical pattern found throughout nature, and are used to identify potential support, resistance, and price target levels. Fibonacci retracement levels (23.6%, 38.2%, 50%, 61.8%, and 78.6%) are drawn from a significant swing high to a swing low (in uptrends) or from swing low to swing high (in downtrends). These levels represent potential areas where price may retrace before continuing in the original direction. For example, if EUR/USD rises from 1.1000 to 1.1200 and then retraces, the 38.2% Fibonacci level at 1.1124 and the 61.8% level at 1.1076 often act as support where buyers may step in. The 61.8% level, also called the "golden ratio," is considered the most significant retracement level. Fibonacci extensions (127.2%, 161.8%, 200%, 261.8%) are used to project potential price targets beyond the original swing, helping traders set take-profit levels. To draw Fibonacci correctly, identify the most significant swing point in the current trend; in an uptrend, draw from the lowest low to the highest high before the retracement begins. These levels work because many traders watch and place orders at these psychological levels, creating self-fulfilling prophecies. Fibonacci levels are most effective when they coincide with other technical levels like support/resistance, trend lines, or moving averages, creating areas of confluence. Using Fibonacci retracements helps traders identify high-probability entry points during pullbacks, while extensions help set realistic profit targets based on mathematical relationships in price movements.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Fibonacci retracements and extensions are powerful tools for identifying potential reversal points and price targets. Learn how to draw Fibonacci levels correctly and use them in your trading strategy.</p>',
        order: 3,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course4Id,
        title: 'Chart Patterns (Head & Shoulders, Triangles)',
        description: 'Identifying and trading classic chart patterns for trend continuation and reversal signals.',
        summary: 'Chart patterns are recognizable formations on price charts that indicate potential future price movements based on historical price behavior and market psychology. The head and shoulders pattern is a bearish reversal pattern consisting of three peaks: a left shoulder, a higher head, and a right shoulder at approximately the same height as the left shoulder, with a neckline connecting the lows between peaks. When price breaks below the neckline, it typically signals a significant downward move, with a price target equal to the distance from the head to the neckline. Triangles are continuation patterns that form when price consolidates between converging trend lines; ascending triangles (flat top, rising bottom) are typically bullish, descending triangles (flat bottom, falling top) are bearish, and symmetrical triangles can break either direction. Flags and pennants are short-term continuation patterns that occur after strong price moves; flags are rectangular, while pennants are small symmetrical triangles, both suggesting the previous trend will resume. Double tops form when price reaches a resistance level twice and fails to break through, signaling potential reversal, while double bottoms (the inverse) indicate potential upward reversal. These patterns work because they reflect the battle between buyers and sellers, and when one side wins decisively (pattern completion), price often moves strongly in that direction. Pattern reliability increases when they appear at key support/resistance levels, when volume confirms the pattern (in other markets), and when they align with the overall trend. Learning to identify and trade chart patterns helps traders anticipate price movements and enter trades with favorable risk-reward ratios.',
        lessonSummary: {
          overview: 'Chart patterns are recognizable formations on price charts that indicate potential future price movements based on historical price behavior and market psychology. The head and shoulders pattern is a bearish reversal pattern consisting of three peaks: a left shoulder, a higher head, and a right shoulder at approximately the same height as the left shoulder, with a neckline connecting the lows between peaks. When price breaks below the neckline, it typically signals a significant downward move, with a price target equal to the distance from the head to the neckline. Triangles are continuation patterns that form when price consolidates between converging trend lines; ascending triangles (flat top, rising bottom) are typically bullish, descending triangles (flat bottom, falling top) are bearish, and symmetrical triangles can break either direction. Flags and pennants are short-term continuation patterns that occur after strong price moves; flags are rectangular, while pennants are small symmetrical triangles, both suggesting the previous trend will resume. Double tops form when price reaches a resistance level twice and fails to break through, signaling potential reversal, while double bottoms (the inverse) indicate potential upward reversal. These patterns work because they reflect the battle between buyers and sellers, and when one side wins decisively (pattern completion), price often moves strongly in that direction. Pattern reliability increases when they appear at key support/resistance levels, when volume confirms the pattern (in other markets), and when they align with the overall trend. Learning to identify and trade chart patterns helps traders anticipate price movements and enter trades with favorable risk-reward ratios.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Chart patterns provide visual clues about future price movement. Learn to identify and trade patterns like head and shoulders, triangles, flags, pennants, and double tops/bottoms.</p>',
        order: 4,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course4Id,
        title: 'Swing Trading Strategies',
        description: 'Learn swing trading techniques to capture medium-term price movements.',
        summary: 'Swing trading is a trading style that aims to capture price swings over several days to weeks, making it ideal for traders who cannot monitor markets constantly but want to participate in medium-term trends. Unlike day trading, which involves multiple trades per day, swing traders typically hold positions for 2-10 days, allowing them to capture larger price movements while avoiding the stress of constant monitoring. Swing trading opportunities are identified on daily or 4-hour charts, looking for clear trends, chart patterns, or breakouts from consolidation areas. For example, if EUR/USD breaks above a resistance level at 1.1200 after forming a bullish flag pattern, a swing trader might enter a long position with a stop loss below the flag and a take profit at the next resistance level. Entry points are often found at pullbacks to support levels, Fibonacci retracements, or moving averages within an established trend. Position management involves setting wider stop losses (typically 100-200 pips) to account for normal market fluctuations, while take-profit targets are set at the next significant resistance level or using Fibonacci extensions. Risk-reward ratios of 1:2 or higher are essential for swing trading success, as not all trades will be winners. Swing traders use fundamental analysis to understand the broader market context and technical analysis for precise entry/exit timing. This approach requires patience and discipline, as positions may move against you temporarily before reaching profit targets. Swing trading suits traders who prefer a balanced lifestyle while still actively participating in Forex markets, offering the potential for substantial profits without the intensity of day trading.',
        lessonSummary: {
          overview: 'Swing trading is a trading style that aims to capture price swings over several days to weeks, making it ideal for traders who cannot monitor markets constantly but want to participate in medium-term trends. Unlike day trading, which involves multiple trades per day, swing traders typically hold positions for 2-10 days, allowing them to capture larger price movements while avoiding the stress of constant monitoring. Swing trading opportunities are identified on daily or 4-hour charts, looking for clear trends, chart patterns, or breakouts from consolidation areas. For example, if EUR/USD breaks above a resistance level at 1.1200 after forming a bullish flag pattern, a swing trader might enter a long position with a stop loss below the flag and a take profit at the next resistance level. Entry points are often found at pullbacks to support levels, Fibonacci retracements, or moving averages within an established trend. Position management involves setting wider stop losses (typically 100-200 pips) to account for normal market fluctuations, while take-profit targets are set at the next significant resistance level or using Fibonacci extensions. Risk-reward ratios of 1:2 or higher are essential for swing trading success, as not all trades will be winners. Swing traders use fundamental analysis to understand the broader market context and technical analysis for precise entry/exit timing. This approach requires patience and discipline, as positions may move against you temporarily before reaching profit targets. Swing trading suits traders who prefer a balanced lifestyle while still actively participating in Forex markets, offering the potential for substantial profits without the intensity of day trading.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Swing trading involves holding positions for several days to weeks. Learn how to identify swing trading opportunities, set up swing trades, and manage positions for optimal risk-reward ratios.</p>',
        order: 5,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ============================================
      // INTERMEDIATE LEVEL: Trading Strategies (Course 5)
      // ============================================
      {
        courseId: course5Id,
        title: 'Risk-Reward Ratio',
        description: 'Understanding and calculating risk-reward ratios to ensure profitable trading over time.',
        summary: 'The risk-reward ratio is a fundamental concept that compares the potential profit of a trade to its potential loss, and maintaining favorable ratios is crucial for long-term trading success. To calculate the risk-reward ratio, divide your potential profit (distance to take-profit) by your potential loss (distance to stop-loss). For example, if you enter a trade with a 50-pip stop loss and a 100-pip take profit, your risk-reward ratio is 1:2, meaning you stand to make $2 for every $1 you risk. A 1:2 ratio means you only need to win 34% of your trades to break even, while a 1:3 ratio requires just 25% win rate to be profitable. Professional traders typically aim for minimum 1:2 ratios, with 1:3 or higher being ideal, as this allows profitability even with a win rate below 50%. To achieve good risk-reward ratios, traders must be selective, only entering trades where the potential reward significantly outweighs the risk, which often means waiting for high-probability setups. Setting take-profit levels at the next significant resistance (for longs) or support (for shorts) helps ensure realistic profit targets. Conversely, placing stop-losses too close reduces the risk-reward ratio and increases the likelihood of being stopped out by normal market fluctuations. The key is finding the balance between tight stops (better risk-reward) and realistic stops (less likely to be hit prematurely). Maintaining discipline to only take trades with favorable risk-reward ratios is essential, as it ensures that even a series of losses won\'t devastate your account, while winners will more than compensate for the losses.',
        lessonSummary: {
          overview: 'The risk-reward ratio is a fundamental concept that compares the potential profit of a trade to its potential loss, and maintaining favorable ratios is crucial for long-term trading success. To calculate the risk-reward ratio, divide your potential profit (distance to take-profit) by your potential loss (distance to stop-loss). For example, if you enter a trade with a 50-pip stop loss and a 100-pip take profit, your risk-reward ratio is 1:2, meaning you stand to make $2 for every $1 you risk. A 1:2 ratio means you only need to win 34% of your trades to break even, while a 1:3 ratio requires just 25% win rate to be profitable. Professional traders typically aim for minimum 1:2 ratios, with 1:3 or higher being ideal, as this allows profitability even with a win rate below 50%. To achieve good risk-reward ratios, traders must be selective, only entering trades where the potential reward significantly outweighs the risk, which often means waiting for high-probability setups. Setting take-profit levels at the next significant resistance (for longs) or support (for shorts) helps ensure realistic profit targets. Conversely, placing stop-losses too close reduces the risk-reward ratio and increases the likelihood of being stopped out by normal market fluctuations. The key is finding the balance between tight stops (better risk-reward) and realistic stops (less likely to be hit prematurely). Maintaining discipline to only take trades with favorable risk-reward ratios is essential, as it ensures that even a series of losses won\'t devastate your account, while winners will more than compensate for the losses.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>A positive risk-reward ratio is essential for long-term profitability. Learn how to calculate risk-reward ratios, identify trades with favorable ratios, and why a 1:2 or 1:3 ratio is often recommended.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course5Id,
        title: 'Position Sizing',
        description: 'Learn how to calculate appropriate position sizes based on account balance and risk tolerance.',
        summary: 'Position sizing is the process of determining how many lots or units to trade on each position, directly impacting both potential profits and the risk to your trading account. Fixed lot sizing uses the same position size for every trade (e.g., always trading 0.1 lots), which is simple but doesn\'t account for varying risk levels or account growth. Percentage risk sizing calculates position size based on a fixed percentage of your account balance that you\'re willing to risk per trade; if you have $10,000 and risk 2% ($200), and your stop loss is 50 pips, you would trade approximately 0.4 standard lots (assuming $10 per pip). The percentage risk method automatically adjusts position size as your account grows or shrinks, maintaining consistent risk levels. The Kelly Criterion is a mathematical formula that calculates optimal position size based on win rate and average win/loss ratio: Kelly % = (Win Rate × Average Win - Loss Rate × Average Loss) / Average Win. However, most traders use half-Kelly (50% of the calculated amount) to reduce risk, as full Kelly can be too aggressive. For example, with a 60% win rate, average win of $200, and average loss of $100, Kelly would suggest risking about 40% per trade, but half-Kelly (20%) is more practical. Position size also depends on the currency pair and stop-loss distance; pairs with higher pip values or wider stops require smaller position sizes to maintain the same dollar risk. Proper position sizing ensures that no single trade can significantly damage your account, allowing you to survive losing streaks and continue trading. This discipline is essential for long-term success, as it protects your capital while allowing for compound growth over time.',
        lessonSummary: {
          overview: 'Position sizing is the process of determining how many lots or units to trade on each position, directly impacting both potential profits and the risk to your trading account. Fixed lot sizing uses the same position size for every trade (e.g., always trading 0.1 lots), which is simple but doesn\'t account for varying risk levels or account growth. Percentage risk sizing calculates position size based on a fixed percentage of your account balance that you\'re willing to risk per trade; if you have $10,000 and risk 2% ($200), and your stop loss is 50 pips, you would trade approximately 0.4 standard lots (assuming $10 per pip). The percentage risk method automatically adjusts position size as your account grows or shrinks, maintaining consistent risk levels. The Kelly Criterion is a mathematical formula that calculates optimal position size based on win rate and average win/loss ratio: Kelly % = (Win Rate × Average Win - Loss Rate × Average Loss) / Average Win. However, most traders use half-Kelly (50% of the calculated amount) to reduce risk, as full Kelly can be too aggressive. For example, with a 60% win rate, average win of $200, and average loss of $100, Kelly would suggest risking about 40% per trade, but half-Kelly (20%) is more practical. Position size also depends on the currency pair and stop-loss distance; pairs with higher pip values or wider stops require smaller position sizes to maintain the same dollar risk. Proper position sizing ensures that no single trade can significantly damage your account, allowing you to survive losing streaks and continue trading. This discipline is essential for long-term success, as it protects your capital while allowing for compound growth over time.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Position sizing determines how much capital to risk on each trade. Learn different position sizing methods including fixed lot size, percentage risk, and Kelly Criterion, and how to apply them to your trading.</p>',
        order: 2,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course5Id,
        title: 'Stop Loss & Take Profit',
        description: 'Master the art of setting stop loss and take profit levels for optimal trade management.',
        summary: 'Stop loss and take profit orders are automated trade management tools that protect your capital and secure profits without requiring constant market monitoring. A stop loss is a pre-set order that automatically closes your position at a specific price to limit losses if the market moves against you. For example, if you buy EUR/USD at 1.1000 and place a stop loss at 1.0950, your maximum loss is limited to 50 pips regardless of how far price falls. Take profit orders automatically close positions when price reaches your profit target, locking in gains and preventing greed from causing you to hold too long. Setting stop losses below support levels (for long positions) or above resistance levels (for short positions) protects against false breakouts while giving trades room to develop. The Average True Range (ATR) indicator measures market volatility and helps set stop losses based on current market conditions; if ATR is 80 pips, setting a stop 1.5x ATR (120 pips) away accounts for normal volatility. Percentage-based stops set risk as a fixed percentage of entry price, but this method doesn\'t consider market structure and may place stops at illogical levels. Support/resistance-based stops are generally preferred because they respect market structure and are less likely to be hit by normal price fluctuations. Take profit levels should be set at the next significant resistance (for longs) or support (for shorts), or using Fibonacci extensions to identify realistic targets. Trailing stop losses automatically adjust as price moves in your favor, locking in profits while allowing for further gains. Using these orders removes emotion from trade management and ensures consistent risk control, which is essential for long-term trading success.',
        lessonSummary: {
          overview: 'Stop loss and take profit orders are automated trade management tools that protect your capital and secure profits without requiring constant market monitoring. A stop loss is a pre-set order that automatically closes your position at a specific price to limit losses if the market moves against you. For example, if you buy EUR/USD at 1.1000 and place a stop loss at 1.0950, your maximum loss is limited to 50 pips regardless of how far price falls. Take profit orders automatically close positions when price reaches your profit target, locking in gains and preventing greed from causing you to hold too long. Setting stop losses below support levels (for long positions) or above resistance levels (for short positions) protects against false breakouts while giving trades room to develop. The Average True Range (ATR) indicator measures market volatility and helps set stop losses based on current market conditions; if ATR is 80 pips, setting a stop 1.5x ATR (120 pips) away accounts for normal volatility. Percentage-based stops set risk as a fixed percentage of entry price, but this method doesn\'t consider market structure and may place stops at illogical levels. Support/resistance-based stops are generally preferred because they respect market structure and are less likely to be hit by normal price fluctuations. Take profit levels should be set at the next significant resistance (for longs) or support (for shorts), or using Fibonacci extensions to identify realistic targets. Trailing stop losses automatically adjust as price moves in your favor, locking in profits while allowing for further gains. Using these orders removes emotion from trade management and ensures consistent risk control, which is essential for long-term trading success.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Stop loss and take profit orders are essential for managing risk and locking in profits. Learn how to set these levels based on support/resistance, ATR, and percentage-based methods.</p>',
        order: 3,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course5Id,
        title: 'Automated Trading Tools',
        description: 'Introduction to automated trading tools, Expert Advisors (EAs), and trading robots.',
        summary: 'Automated trading tools, including Expert Advisors (EAs) and trading robots, are computer programs that execute trades automatically based on predefined rules and algorithms, removing human emotion from trading decisions. Expert Advisors are programs written in MQL4 or MQL5 programming languages that run on MetaTrader platforms, monitoring markets 24/7 and executing trades when specific conditions are met. For example, an EA might be programmed to buy EUR/USD when the 50-day moving average crosses above the 200-day moving average and RSI is below 70. Trading robots can backtest strategies on historical data, allowing traders to evaluate performance before risking real capital, though past performance doesn\'t guarantee future results. Advantages include the ability to trade multiple pairs simultaneously, execute trades instantly without hesitation, and maintain discipline by following rules consistently. However, EAs have limitations: they cannot adapt to changing market conditions as well as human traders, may over-optimize to historical data (curve fitting), and can fail during unexpected market events or when internet connections are lost. Market conditions change, and strategies that worked in trending markets may fail in ranging markets, requiring regular monitoring and adjustment. Successful EA usage requires understanding the underlying strategy, proper risk management settings, regular performance review, and having realistic expectations. Many profitable traders use EAs to execute their strategies while maintaining oversight, combining the speed and discipline of automation with human judgment for strategy refinement. Learning to use automated tools effectively can enhance your trading, but they should complement rather than replace your understanding of market dynamics.',
        lessonSummary: {
          overview: 'Automated trading tools, including Expert Advisors (EAs) and trading robots, are computer programs that execute trades automatically based on predefined rules and algorithms, removing human emotion from trading decisions. Expert Advisors are programs written in MQL4 or MQL5 programming languages that run on MetaTrader platforms, monitoring markets 24/7 and executing trades when specific conditions are met. For example, an EA might be programmed to buy EUR/USD when the 50-day moving average crosses above the 200-day moving average and RSI is below 70. Trading robots can backtest strategies on historical data, allowing traders to evaluate performance before risking real capital, though past performance doesn\'t guarantee future results. Advantages include the ability to trade multiple pairs simultaneously, execute trades instantly without hesitation, and maintain discipline by following rules consistently. However, EAs have limitations: they cannot adapt to changing market conditions as well as human traders, may over-optimize to historical data (curve fitting), and can fail during unexpected market events or when internet connections are lost. Market conditions change, and strategies that worked in trending markets may fail in ranging markets, requiring regular monitoring and adjustment. Successful EA usage requires understanding the underlying strategy, proper risk management settings, regular performance review, and having realistic expectations. Many profitable traders use EAs to execute their strategies while maintaining oversight, combining the speed and discipline of automation with human judgment for strategy refinement. Learning to use automated tools effectively can enhance your trading, but they should complement rather than replace your understanding of market dynamics.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Automated trading tools can help execute trades based on predefined rules. Learn about Expert Advisors (EAs), trading robots, and how to use them effectively while understanding their limitations.</p>',
        order: 4,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course5Id,
        title: 'Intermediate Trading Psychology',
        description: 'Advanced psychological techniques for maintaining discipline and managing emotions in trading.',
        summary: 'Advanced trading psychology involves understanding and overcoming cognitive biases, developing emotional resilience, and cultivating the disciplined mindset of a professional trader. Cognitive biases are systematic errors in thinking that affect trading decisions; confirmation bias leads traders to seek information that supports their existing beliefs while ignoring contradictory evidence, while anchoring bias causes traders to rely too heavily on the first piece of information they receive (like entry price). Loss aversion makes traders feel the pain of losses more strongly than the pleasure of equivalent gains, leading to holding losing trades too long and cutting winners too early. The sunk cost fallacy keeps traders in losing positions because they\'ve already invested time and money, even when the trade no longer makes sense. Emotional control techniques include meditation and mindfulness practices that help traders remain calm during market volatility, breathing exercises to manage stress during trades, and taking breaks after losses to prevent revenge trading. Trading journaling involves recording every trade with entry/exit reasons, emotional state, market conditions, and outcomes, helping identify patterns in both successful and unsuccessful trades. Reviewing your journal reveals psychological patterns like overtrading after wins or becoming overly cautious after losses. A professional trading mindset treats trading as a business, focusing on process over outcomes, accepting losses as part of the business, and maintaining consistency regardless of recent results. Professional traders understand that not every trade will be a winner and focus on maintaining positive expectancy over many trades rather than individual trade outcomes. Developing this mindset requires time, self-awareness, and commitment to continuous improvement, but it is essential for long-term trading success.',
        lessonSummary: {
          overview: 'Advanced trading psychology involves understanding and overcoming cognitive biases, developing emotional resilience, and cultivating the disciplined mindset of a professional trader. Cognitive biases are systematic errors in thinking that affect trading decisions; confirmation bias leads traders to seek information that supports their existing beliefs while ignoring contradictory evidence, while anchoring bias causes traders to rely too heavily on the first piece of information they receive (like entry price). Loss aversion makes traders feel the pain of losses more strongly than the pleasure of equivalent gains, leading to holding losing trades too long and cutting winners too early. The sunk cost fallacy keeps traders in losing positions because they\'ve already invested time and money, even when the trade no longer makes sense. Emotional control techniques include meditation and mindfulness practices that help traders remain calm during market volatility, breathing exercises to manage stress during trades, and taking breaks after losses to prevent revenge trading. Trading journaling involves recording every trade with entry/exit reasons, emotional state, market conditions, and outcomes, helping identify patterns in both successful and unsuccessful trades. Reviewing your journal reveals psychological patterns like overtrading after wins or becoming overly cautious after losses. A professional trading mindset treats trading as a business, focusing on process over outcomes, accepting losses as part of the business, and maintaining consistency regardless of recent results. Professional traders understand that not every trade will be a winner and focus on maintaining positive expectancy over many trades rather than individual trade outcomes. Developing this mindset requires time, self-awareness, and commitment to continuous improvement, but it is essential for long-term trading success.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Take your trading psychology to the next level. Learn about cognitive biases, emotional control techniques, journaling, and how to develop a professional trading mindset.</p>',
        order: 5,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ============================================
      // ADVANCED LEVEL: Algorithmic Trading & Automation (Course 6)
      // ============================================
      {
        courseId: course6Id,
        title: 'Introduction to Algorithmic Trading',
        description: 'Learn the fundamentals of algorithmic trading and how automated systems work in Forex markets.',
        summary: 'Algorithmic trading, also known as algo trading or automated trading, uses computer programs and mathematical models to execute trades automatically based on predefined rules and conditions, eliminating human emotion and reaction time from the trading process. These algorithms can analyze multiple currency pairs simultaneously, process vast amounts of market data in milliseconds, and execute trades at speeds impossible for human traders. Trend-following algorithms identify and trade in the direction of established trends using moving averages or momentum indicators, while mean reversion algorithms bet that prices will return to their average after deviating too far. Arbitrage algorithms exploit price differences between markets or brokers, though these opportunities are rare and short-lived in Forex. High-frequency trading (HFT) algorithms execute thousands of trades per second, profiting from tiny price movements, but require sophisticated infrastructure and are typically used by large institutions. Advantages include 24/7 market monitoring, instant execution, elimination of emotional trading, ability to backtest strategies, and consistency in following rules. Disadvantages include the risk of over-optimization (curve fitting) to historical data, inability to adapt to unexpected market events, technical failures or internet outages, and the need for programming knowledge or costs to hire developers. Algorithms work best in specific market conditions; a trend-following algorithm may struggle in ranging markets, while a mean reversion algorithm may fail during strong trends. Successful algorithmic trading requires understanding the underlying strategy, proper risk management, regular monitoring, and realistic expectations. While algorithms can enhance trading performance, they should be viewed as tools that require human oversight and adjustment rather than completely autonomous profit generators.',
        lessonSummary: {
          overview: 'Algorithmic trading, also known as algo trading or automated trading, uses computer programs and mathematical models to execute trades automatically based on predefined rules and conditions, eliminating human emotion and reaction time from the trading process. These algorithms can analyze multiple currency pairs simultaneously, process vast amounts of market data in milliseconds, and execute trades at speeds impossible for human traders. Trend-following algorithms identify and trade in the direction of established trends using moving averages or momentum indicators, while mean reversion algorithms bet that prices will return to their average after deviating too far. Arbitrage algorithms exploit price differences between markets or brokers, though these opportunities are rare and short-lived in Forex. High-frequency trading (HFT) algorithms execute thousands of trades per second, profiting from tiny price movements, but require sophisticated infrastructure and are typically used by large institutions. Advantages include 24/7 market monitoring, instant execution, elimination of emotional trading, ability to backtest strategies, and consistency in following rules. Disadvantages include the risk of over-optimization (curve fitting) to historical data, inability to adapt to unexpected market events, technical failures or internet outages, and the need for programming knowledge or costs to hire developers. Algorithms work best in specific market conditions; a trend-following algorithm may struggle in ranging markets, while a mean reversion algorithm may fail during strong trends. Successful algorithmic trading requires understanding the underlying strategy, proper risk management, regular monitoring, and realistic expectations. While algorithms can enhance trading performance, they should be viewed as tools that require human oversight and adjustment rather than completely autonomous profit generators.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Algorithmic trading uses computer programs to execute trades based on predefined rules. Learn about the advantages, disadvantages, and different types of algorithmic trading strategies.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course6Id,
        title: 'Forex Bots & Scripts',
        description: 'Understanding Forex trading bots, Expert Advisors, and how to develop or customize trading scripts.',
        summary: 'Forex bots, also called Expert Advisors (EAs) or trading robots, are automated trading systems that execute trades on your behalf based on programmed strategies, and understanding their types and evaluation methods is crucial for successful automated trading. Signal-based bots follow signals from other traders or services, automatically copying their trades, while strategy bots implement specific trading methodologies like moving average crossovers, grid trading, or scalping strategies. Arbitrage bots look for price discrepancies between brokers, though these are rare in modern Forex markets. Grid trading bots place multiple buy and sell orders at regular intervals, profiting from market oscillations, but can be risky during strong trends. MQL4 (MetaQuotes Language 4) and MQL5 are programming languages used to create EAs for MetaTrader 4 and MetaTrader 5 platforms, allowing traders to code custom strategies, indicators, and automated systems. Basic MQL programming involves defining entry conditions (like "buy when RSI < 30 and price crosses above moving average"), exit conditions (stop loss, take profit), and risk management rules. Evaluating bot performance requires analyzing metrics beyond just profitability: maximum drawdown (largest peak-to-trough decline) shows risk, win rate indicates consistency, profit factor (gross profit / gross loss) should be above 1.5, and the Sharpe ratio measures risk-adjusted returns. Be wary of bots with unrealistic claims, those that only show backtested results without live trading proof, or systems that require large upfront payments. Testing bots on demo accounts first is essential, as real market conditions differ from backtests due to slippage, spreads, and execution delays. Understanding bot mechanics helps you choose appropriate systems, customize them for your risk tolerance, and maintain realistic expectations about automated trading performance.',
        lessonSummary: {
          overview: 'Forex bots, also called Expert Advisors (EAs) or trading robots, are automated trading systems that execute trades on your behalf based on programmed strategies, and understanding their types and evaluation methods is crucial for successful automated trading. Signal-based bots follow signals from other traders or services, automatically copying their trades, while strategy bots implement specific trading methodologies like moving average crossovers, grid trading, or scalping strategies. Arbitrage bots look for price discrepancies between brokers, though these are rare in modern Forex markets. Grid trading bots place multiple buy and sell orders at regular intervals, profiting from market oscillations, but can be risky during strong trends. MQL4 (MetaQuotes Language 4) and MQL5 are programming languages used to create EAs for MetaTrader 4 and MetaTrader 5 platforms, allowing traders to code custom strategies, indicators, and automated systems. Basic MQL programming involves defining entry conditions (like "buy when RSI < 30 and price crosses above moving average"), exit conditions (stop loss, take profit), and risk management rules. Evaluating bot performance requires analyzing metrics beyond just profitability: maximum drawdown (largest peak-to-trough decline) shows risk, win rate indicates consistency, profit factor (gross profit / gross loss) should be above 1.5, and the Sharpe ratio measures risk-adjusted returns. Be wary of bots with unrealistic claims, those that only show backtested results without live trading proof, or systems that require large upfront payments. Testing bots on demo accounts first is essential, as real market conditions differ from backtests due to slippage, spreads, and execution delays. Understanding bot mechanics helps you choose appropriate systems, customize them for your risk tolerance, and maintain realistic expectations about automated trading performance.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Learn about different types of Forex bots, how they work, and how to evaluate their performance. Understand the basics of MQL4/MQL5 programming for creating custom trading scripts.</p>',
        order: 2,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course6Id,
        title: 'Backtesting Strategies',
        description: 'Learn how to backtest trading strategies using historical data to evaluate performance.',
        summary: 'Backtesting is the process of testing a trading strategy on historical market data to evaluate its potential performance before risking real capital, but it must be done correctly to provide meaningful insights. To backtest properly, use high-quality historical data that includes realistic spreads, slippage, and commission costs, as testing on "perfect" data without these costs will show inflated results. The testing period should be long enough to include various market conditions (trending, ranging, volatile) to ensure the strategy works across different environments, not just during favorable periods. Overfitting, also called curve fitting, occurs when a strategy is optimized too closely to historical data, creating rules that work perfectly in the past but fail in live trading. For example, if you optimize a moving average crossover to use exactly 13.7 and 27.3 periods because those numbers worked best historically, you\'ve likely overfitted. To avoid overfitting, use out-of-sample testing: divide your data into two periods, optimize on the first period, then test on the second period to see if results hold. Walk-forward analysis involves repeatedly optimizing on a rolling window of data and testing on the following period, providing more realistic performance expectations. Key metrics to evaluate include total return, maximum drawdown (should be acceptable relative to returns), win rate, profit factor (should be above 1.5), and the number of trades (too few trades may indicate overfitting). Be skeptical of strategies showing unrealistic returns (like 500% annually) or perfect win rates, as these are red flags for overfitting. Remember that past performance doesn\'t guarantee future results, and real trading will differ from backtests due to execution delays, emotional factors, and changing market conditions. Proper backtesting helps validate strategies and build confidence, but it should be followed by forward testing (paper trading) before risking real money.',
        lessonSummary: {
          overview: 'Backtesting is the process of testing a trading strategy on historical market data to evaluate its potential performance before risking real capital, but it must be done correctly to provide meaningful insights. To backtest properly, use high-quality historical data that includes realistic spreads, slippage, and commission costs, as testing on "perfect" data without these costs will show inflated results. The testing period should be long enough to include various market conditions (trending, ranging, volatile) to ensure the strategy works across different environments, not just during favorable periods. Overfitting, also called curve fitting, occurs when a strategy is optimized too closely to historical data, creating rules that work perfectly in the past but fail in live trading. For example, if you optimize a moving average crossover to use exactly 13.7 and 27.3 periods because those numbers worked best historically, you\'ve likely overfitted. To avoid overfitting, use out-of-sample testing: divide your data into two periods, optimize on the first period, then test on the second period to see if results hold. Walk-forward analysis involves repeatedly optimizing on a rolling window of data and testing on the following period, providing more realistic performance expectations. Key metrics to evaluate include total return, maximum drawdown (should be acceptable relative to returns), win rate, profit factor (gross profit / gross loss, should be above 1.5), and the number of trades (too few trades may indicate overfitting). Be skeptical of strategies showing unrealistic returns (like 500% annually) or perfect win rates, as these are red flags for overfitting. Remember that past performance doesn\'t guarantee future results, and real trading will differ from backtests due to execution delays, emotional factors, and changing market conditions. Proper backtesting helps validate strategies and build confidence, but it should be followed by forward testing (paper trading) before risking real money.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Backtesting allows you to test trading strategies on historical data. Learn how to properly backtest strategies, interpret results, and avoid common pitfalls like overfitting and curve fitting.</p>',
        order: 3,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course6Id,
        title: 'Optimizing Trading Algorithms',
        description: 'Advanced techniques for optimizing algorithmic trading strategies and improving performance.',
        summary: 'Optimizing trading algorithms involves fine-tuning strategy parameters to improve performance, but requires careful techniques to avoid overfitting and ensure robustness. Parameter optimization tests different values for strategy inputs (like moving average periods, RSI levels, or stop-loss distances) to find the combination that produces the best historical results. However, simply finding the "best" parameters often leads to overfitting, where the strategy works perfectly on historical data but fails in live trading. Walk-forward analysis is a robust optimization technique that divides data into multiple periods, optimizes parameters on one period, tests on the next, then rolls forward to the next period, repeating this process. This method ensures the strategy works across different timeframes and market conditions, not just one specific historical period. For example, optimize on January-March data, test on April-June, then optimize on April-June and test on July-September, continuing this rolling process. Machine learning techniques like neural networks can identify complex patterns in market data, but they also risk overfitting if not properly validated with out-of-sample testing and cross-validation. The key to successful optimization is finding parameters that work across multiple market conditions and time periods, not just the ones that maximize historical profits. A well-optimized strategy should show consistent performance with reasonable parameter values (avoiding extreme numbers like 137.3-period moving averages), maintain profitability across different market regimes, and have a stable equity curve without extreme drawdowns. The balance between optimization and overfitting requires discipline: accept "good enough" parameters rather than perfect ones, prioritize robustness over maximum returns, and always validate with forward testing. Remember that markets evolve, and even well-optimized strategies require periodic review and adjustment to remain effective.',
        lessonSummary: {
          overview: 'Optimizing trading algorithms involves fine-tuning strategy parameters to improve performance, but requires careful techniques to avoid overfitting and ensure robustness. Parameter optimization tests different values for strategy inputs (like moving average periods, RSI levels, or stop-loss distances) to find the combination that produces the best historical results. However, simply finding the "best" parameters often leads to overfitting, where the strategy works perfectly on historical data but fails in live trading. Walk-forward analysis is a robust optimization technique that divides data into multiple periods, optimizes parameters on one period, tests on the next, then rolls forward to the next period, repeating this process. This method ensures the strategy works across different timeframes and market conditions, not just one specific historical period. For example, optimize on January-March data, test on April-June, then optimize on April-June and test on July-September, continuing this rolling process. Machine learning techniques like neural networks can identify complex patterns in market data, but they also risk overfitting if not properly validated with out-of-sample testing and cross-validation. The key to successful optimization is finding parameters that work across multiple market conditions and time periods, not just the ones that maximize historical profits. A well-optimized strategy should show consistent performance with reasonable parameter values (avoiding extreme numbers like 137.3-period moving averages), maintain profitability across different market regimes, and have a stable equity curve without extreme drawdowns. The balance between optimization and overfitting requires discipline: accept "good enough" parameters rather than perfect ones, prioritize robustness over maximum returns, and always validate with forward testing. Remember that markets evolve, and even well-optimized strategies require periodic review and adjustment to remain effective.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Learn how to optimize trading algorithms using walk-forward analysis, parameter optimization, and machine learning techniques. Understand the balance between optimization and overfitting.</p>',
        order: 4,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course6Id,
        title: 'Advanced Risk Management',
        description: 'Professional risk management techniques for algorithmic trading systems.',
        summary: 'Advanced risk management for algorithmic trading extends beyond individual trade risk to encompass portfolio-level considerations, correlation analysis, drawdown control, and adaptive position sizing. Portfolio-level risk management views all open positions as a single portfolio, ensuring that total exposure doesn\'t exceed acceptable limits even when multiple trades are active simultaneously. For example, if you risk 2% per trade and have 5 open positions, your total portfolio risk could be 10%, which may be too high; limiting total portfolio risk to 5-6% prevents overexposure. Correlation analysis examines how different currency pairs move relative to each other; highly correlated pairs (like EUR/USD and GBP/USD, which often move together) increase portfolio risk because losses in one pair likely mean losses in the other. Diversifying across uncorrelated or negatively correlated pairs (like USD/JPY and EUR/USD, which sometimes move inversely) reduces overall portfolio risk. Drawdown management involves setting maximum acceptable drawdown limits and reducing position sizes or pausing trading when drawdowns approach these limits. For instance, if your maximum acceptable drawdown is 20% and your account drops 15%, you might reduce position sizes by 50% until recovery. Dynamic position sizing adjusts trade sizes based on recent performance, market volatility (using ATR), or account equity, with larger sizes during winning streaks and smaller sizes after losses or during high volatility. The Kelly Criterion or fractional Kelly can be used to calculate optimal position sizes based on win rate and risk-reward ratios, though most traders use conservative fractions (25-50% of full Kelly). Risk parity approaches allocate risk equally across all positions rather than allocating capital equally, ensuring no single trade dominates portfolio risk. Advanced risk management also includes scenario analysis (stress testing) to understand how the portfolio would perform under extreme market conditions. Implementing these techniques protects capital during difficult periods and allows algorithmic systems to survive and recover from drawdowns, which is essential for long-term algorithmic trading success.',
        lessonSummary: {
          overview: 'Advanced risk management for algorithmic trading extends beyond individual trade risk to encompass portfolio-level considerations, correlation analysis, drawdown control, and adaptive position sizing. Portfolio-level risk management views all open positions as a single portfolio, ensuring that total exposure doesn\'t exceed acceptable limits even when multiple trades are active simultaneously. For example, if you risk 2% per trade and have 5 open positions, your total portfolio risk could be 10%, which may be too high; limiting total portfolio risk to 5-6% prevents overexposure. Correlation analysis examines how different currency pairs move relative to each other; highly correlated pairs (like EUR/USD and GBP/USD, which often move together) increase portfolio risk because losses in one pair likely mean losses in the other. Diversifying across uncorrelated or negatively correlated pairs (like USD/JPY and EUR/USD, which sometimes move inversely) reduces overall portfolio risk. Drawdown management involves setting maximum acceptable drawdown limits and reducing position sizes or pausing trading when drawdowns approach these limits. For instance, if your maximum acceptable drawdown is 20% and your account drops 15%, you might reduce position sizes by 50% until recovery. Dynamic position sizing adjusts trade sizes based on recent performance, market volatility (using ATR), or account equity, with larger sizes during winning streaks and smaller sizes after losses or during high volatility. The Kelly Criterion or fractional Kelly can be used to calculate optimal position sizes based on win rate and risk-reward ratios, though most traders use conservative fractions (25-50% of full Kelly). Risk parity approaches allocate risk equally across all positions rather than allocating capital equally, ensuring no single trade dominates portfolio risk. Advanced risk management also includes scenario analysis (stress testing) to understand how the portfolio would perform under extreme market conditions. Implementing these techniques protects capital during difficult periods and allows algorithmic systems to survive and recover from drawdowns, which is essential for long-term algorithmic trading success.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Advanced risk management for algorithmic trading includes portfolio-level risk, correlation analysis, drawdown management, and dynamic position sizing based on market conditions.</p>',
        order: 5,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ============================================
      // ADVANCED LEVEL: Professional Forex Trading (Course 7)
      // ============================================
      {
        courseId: course7Id,
        title: 'Market Sentiment Analysis',
        description: 'Learn to analyze market sentiment using COT reports, sentiment indicators, and news analysis.',
        summary: 'Market sentiment analysis examines the overall mood and attitude of traders toward a particular currency or market, helping identify when prices may be overextended and due for reversal. The Commitment of Traders (COT) report, published weekly by the Commodity Futures Trading Commission (CFTC), shows the positions of commercial traders (banks, corporations), large speculators (hedge funds), and small speculators (retail traders). When commercial traders are heavily long and small speculators are heavily short, it often signals potential upward movement, as commercial traders typically have better information and timing. Sentiment indicators like the Speculative Sentiment Index (SSI) show the ratio of long to short positions among retail traders; when the majority are long (bullish), contrarian traders may look for short opportunities, as retail traders are often wrong at extremes. News sentiment analysis involves monitoring economic news, central bank statements, and geopolitical events to gauge market mood, with positive news typically strengthening currencies and negative news weakening them. For example, if the Federal Reserve hints at interest rate hikes, it generally strengthens the US dollar as higher rates attract foreign investment. Extreme sentiment readings (like 90% of traders being bullish) often signal potential reversals, as markets tend to move against the crowd when sentiment reaches extremes. Combining sentiment analysis with technical analysis provides a more complete picture; if sentiment is extremely bullish but price is showing bearish divergence on the RSI, it may indicate an impending reversal. Understanding market sentiment helps traders avoid buying at the top (when everyone is bullish) and selling at the bottom (when everyone is bearish), improving entry and exit timing.',
        lessonSummary: {
          overview: 'Market sentiment analysis examines the overall mood and attitude of traders toward a particular currency or market, helping identify when prices may be overextended and due for reversal. The Commitment of Traders (COT) report, published weekly by the Commodity Futures Trading Commission (CFTC), shows the positions of commercial traders (banks, corporations), large speculators (hedge funds), and small speculators (retail traders). When commercial traders are heavily long and small speculators are heavily short, it often signals potential upward movement, as commercial traders typically have better information and timing. Sentiment indicators like the Speculative Sentiment Index (SSI) show the ratio of long to short positions among retail traders; when the majority are long (bullish), contrarian traders may look for short opportunities, as retail traders are often wrong at extremes. News sentiment analysis involves monitoring economic news, central bank statements, and geopolitical events to gauge market mood, with positive news typically strengthening currencies and negative news weakening them. For example, if the Federal Reserve hints at interest rate hikes, it generally strengthens the US dollar as higher rates attract foreign investment. Extreme sentiment readings (like 90% of traders being bullish) often signal potential reversals, as markets tend to move against the crowd when sentiment reaches extremes. Combining sentiment analysis with technical analysis provides a more complete picture; if sentiment is extremely bullish but price is showing bearish divergence on the RSI, it may indicate an impending reversal. Understanding market sentiment helps traders avoid buying at the top (when everyone is bullish) and selling at the bottom (when everyone is bearish), improving entry and exit timing.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Market sentiment analysis helps identify when markets are overbought or oversold. Learn to use Commitment of Traders (COT) reports, sentiment indicators, and news sentiment analysis in your trading.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course7Id,
        title: 'Hedging & Leverage Strategies',
        description: 'Advanced hedging techniques and how to use leverage effectively while managing risk.',
        summary: 'Hedging is a risk management technique that involves opening positions to offset potential losses in existing positions, protecting capital during uncertain market conditions. A simple hedge involves opening an opposite position in the same currency pair; for example, if you have a long EUR/USD position and are concerned about downside risk, you could open a short EUR/USD position to limit losses. However, this also limits profits, so hedging is typically used when protecting capital is more important than maximizing gains. Cross-hedging involves using correlated pairs; if you\'re long GBP/USD and want to hedge, you might short EUR/GBP since these pairs often move inversely. Leverage allows traders to control larger positions with less capital; with 100:1 leverage, you can control $100,000 with just $1,000 margin. While leverage amplifies profits, it also amplifies losses, making risk management crucial. Margin is the amount of money required to open and maintain a leveraged position, calculated as a percentage of the total position size. For example, with 1% margin requirement (100:1 leverage), a $100,000 position requires $1,000 margin. A margin call occurs when your account equity falls below the required margin level, forcing the broker to close positions to protect themselves. To avoid margin calls, maintain sufficient account equity (at least 2-3x your margin requirement), use appropriate position sizing, and avoid over-leveraging. Free margin is the amount available to open new positions, calculated as equity minus used margin. Effective leverage management means using leverage conservatively (10:1 to 50:1 for most traders), never risking more than you can afford to lose, and maintaining adequate margin buffers. Professional traders use hedging and leverage strategically to protect capital and optimize returns while managing risk, but these tools require understanding and discipline to use effectively.',
        lessonSummary: {
          overview: 'Hedging is a risk management technique that involves opening positions to offset potential losses in existing positions, protecting capital during uncertain market conditions. A simple hedge involves opening an opposite position in the same currency pair; for example, if you have a long EUR/USD position and are concerned about downside risk, you could open a short EUR/USD position to limit losses. However, this also limits profits, so hedging is typically used when protecting capital is more important than maximizing gains. Cross-hedging involves using correlated pairs; if you\'re long GBP/USD and want to hedge, you might short EUR/GBP since these pairs often move inversely. Leverage allows traders to control larger positions with less capital; with 100:1 leverage, you can control $100,000 with just $1,000 margin. While leverage amplifies profits, it also amplifies losses, making risk management crucial. Margin is the amount of money required to open and maintain a leveraged position, calculated as a percentage of the total position size. For example, with 1% margin requirement (100:1 leverage), a $100,000 position requires $1,000 margin. A margin call occurs when your account equity falls below the required margin level, forcing the broker to close positions to protect themselves. To avoid margin calls, maintain sufficient account equity (at least 2-3x your margin requirement), use appropriate position sizing, and avoid over-leveraging. Free margin is the amount available to open new positions, calculated as equity minus used margin. Effective leverage management means using leverage conservatively (10:1 to 50:1 for most traders), never risking more than you can afford to lose, and maintaining adequate margin buffers. Professional traders use hedging and leverage strategically to protect capital and optimize returns while managing risk, but these tools require understanding and discipline to use effectively.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Learn professional hedging strategies to protect positions and manage risk. Understand how to use leverage effectively, calculate margin requirements, and avoid margin calls.</p>',
        order: 2,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course7Id,
        title: 'Portfolio Management',
        description: 'Professional portfolio management techniques for managing multiple currency pairs and strategies.',
        summary: 'Portfolio management in Forex trading involves treating all your positions and strategies as a unified portfolio, optimizing risk and return across multiple currency pairs and trading approaches. Diversification spreads risk across different currency pairs, reducing the impact of losses in any single position, but effective diversification requires understanding correlations between pairs. Correlation measures how currency pairs move relative to each other, ranging from +1 (perfect positive correlation, moving together) to -1 (perfect negative correlation, moving opposite) to 0 (no correlation). For example, EUR/USD and GBP/USD often have high positive correlation (around 0.7-0.9), meaning they tend to move in the same direction, so holding both doesn\'t provide much diversification. True diversification comes from trading pairs with low or negative correlations, such as combining EUR/USD with USD/JPY or AUD/USD, which may move independently. Portfolio optimization involves allocating capital across positions to maximize returns while minimizing risk, considering not just individual trade risk but total portfolio exposure. Risk parity is an approach that allocates equal risk to each position rather than equal capital, ensuring no single trade dominates portfolio risk. For instance, if one pair is more volatile, you might trade smaller position sizes to equalize risk contribution. Strategy diversification involves using different trading approaches (trend following, mean reversion, breakout) simultaneously, as different strategies perform well in different market conditions. Monitoring portfolio metrics like total exposure, correlation matrix, and portfolio drawdown helps maintain balanced risk. Rebalancing involves adjusting positions periodically to maintain desired risk levels and correlations. Effective portfolio management reduces overall risk while maintaining profit potential, making it essential for traders managing multiple positions or strategies simultaneously.',
        lessonSummary: {
          overview: 'Portfolio management in Forex trading involves treating all your positions and strategies as a unified portfolio, optimizing risk and return across multiple currency pairs and trading approaches. Diversification spreads risk across different currency pairs, reducing the impact of losses in any single position, but effective diversification requires understanding correlations between pairs. Correlation measures how currency pairs move relative to each other, ranging from +1 (perfect positive correlation, moving together) to -1 (perfect negative correlation, moving opposite) to 0 (no correlation). For example, EUR/USD and GBP/USD often have high positive correlation (around 0.7-0.9), meaning they tend to move in the same direction, so holding both doesn\'t provide much diversification. True diversification comes from trading pairs with low or negative correlations, such as combining EUR/USD with USD/JPY or AUD/USD, which may move independently. Portfolio optimization involves allocating capital across positions to maximize returns while minimizing risk, considering not just individual trade risk but total portfolio exposure. Risk parity is an approach that allocates equal risk to each position rather than equal capital, ensuring no single trade dominates portfolio risk. For instance, if one pair is more volatile, you might trade smaller position sizes to equalize risk contribution. Strategy diversification involves using different trading approaches (trend following, mean reversion, breakout) simultaneously, as different strategies perform well in different market conditions. Monitoring portfolio metrics like total exposure, correlation matrix, and portfolio drawdown helps maintain balanced risk. Rebalancing involves adjusting positions periodically to maintain desired risk levels and correlations. Effective portfolio management reduces overall risk while maintaining profit potential, making it essential for traders managing multiple positions or strategies simultaneously.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Portfolio management involves diversifying across multiple currency pairs and strategies. Learn about correlation analysis, portfolio optimization, and how to balance risk across different trading strategies.</p>',
        order: 3,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course7Id,
        title: 'Macro Economics & Forex',
        description: 'Understanding how macroeconomic factors influence currency markets and exchange rates.',
        summary: 'Fundamental analysis in Forex examines macroeconomic factors that influence currency values, providing the "why" behind price movements that technical analysis alone cannot explain. Interest rates are among the most important fundamental factors, as higher interest rates attract foreign investment, increasing demand for that currency and typically strengthening its value. For example, when the Federal Reserve raises US interest rates, the US dollar often strengthens because investors seek higher returns on dollar-denominated assets. Inflation measures the rate at which prices for goods and services rise, and moderate inflation (2-3% annually) is generally healthy, while high inflation erodes purchasing power and can weaken a currency. Central banks use monetary policy tools like interest rate adjustments and quantitative easing to control inflation and stimulate economic growth, with their decisions significantly impacting currency markets. GDP (Gross Domestic Product) measures a country\'s total economic output, and strong GDP growth typically strengthens a currency as it indicates a healthy economy attracting investment. Employment data, particularly non-farm payrolls in the US, provides insights into economic health, with strong employment numbers often strengthening the currency. Trade balance (exports minus imports) affects currency values; countries with trade surpluses (exporting more than importing) typically see currency appreciation, while trade deficits can weaken currencies. Political stability and geopolitical events also impact currencies, as uncertainty often leads investors to seek safe-haven currencies like the US dollar, Swiss franc, or Japanese yen. Economic calendars list important data releases and events, helping traders anticipate volatility and plan trades around major announcements. Combining fundamental analysis (understanding the economic backdrop) with technical analysis (identifying entry/exit points) provides a comprehensive trading approach, as fundamentals drive long-term trends while technicals help with precise timing.',
        lessonSummary: {
          overview: 'Fundamental analysis in Forex examines macroeconomic factors that influence currency values, providing the "why" behind price movements that technical analysis alone cannot explain. Interest rates are among the most important fundamental factors, as higher interest rates attract foreign investment, increasing demand for that currency and typically strengthening its value. For example, when the Federal Reserve raises US interest rates, the US dollar often strengthens because investors seek higher returns on dollar-denominated assets. Inflation measures the rate at which prices for goods and services rise, and moderate inflation (2-3% annually) is generally healthy, while high inflation erodes purchasing power and can weaken a currency. Central banks use monetary policy tools like interest rate adjustments and quantitative easing to control inflation and stimulate economic growth, with their decisions significantly impacting currency markets. GDP (Gross Domestic Product) measures a country\'s total economic output, and strong GDP growth typically strengthens a currency as it indicates a healthy economy attracting investment. Employment data, particularly non-farm payrolls in the US, provides insights into economic health, with strong employment numbers often strengthening the currency. Trade balance (exports minus imports) affects currency values; countries with trade surpluses (exporting more than importing) typically see currency appreciation, while trade deficits can weaken currencies. Political stability and geopolitical events also impact currencies, as uncertainty often leads investors to seek safe-haven currencies like the US dollar, Swiss franc, or Japanese yen. Economic calendars list important data releases and events, helping traders anticipate volatility and plan trades around major announcements. Combining fundamental analysis (understanding the economic backdrop) with technical analysis (identifying entry/exit points) provides a comprehensive trading approach, as fundamentals drive long-term trends while technicals help with precise timing.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Macroeconomic factors like interest rates, inflation, GDP, and central bank policies significantly impact currency markets. Learn how to analyze these factors and incorporate fundamental analysis into your trading.</p>',
        order: 4,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course7Id,
        title: 'Advanced Trading Psychology',
        description: 'Elite psychological techniques for professional traders, including mental models and performance optimization.',
        summary: 'Advanced trading psychology involves developing mental frameworks, optimizing performance through systematic approaches, managing psychological challenges during difficult periods, and cultivating the professional mindset necessary for long-term success. Mental models are frameworks for understanding how markets and trading work; for example, viewing trading as a probability game rather than a quest for certainty helps accept losses as part of the process. The "edge" mental model recognizes that profitable trading comes from having a statistical advantage over many trades, not from winning every individual trade. Performance optimization involves systematic approaches to improvement: regular strategy review, identifying and eliminating weaknesses, tracking key performance metrics, and continuously refining your approach based on data rather than emotions. Dealing with large drawdowns requires psychological resilience, as drawdowns are inevitable in trading and can test even experienced traders\' confidence. During drawdowns, professional traders focus on process over outcomes, maintain discipline to their trading plan, reduce position sizes if necessary, and avoid the temptation to "make it back" quickly through revenge trading. Maintaining consistency means following your trading plan regardless of recent results, avoiding the trap of changing strategies after losses or becoming overconfident after wins. A professional trader\'s mindset treats trading as a business with expenses (losses), revenue (wins), and the goal of positive expectancy over time. This mindset includes accepting that not all trades will be winners, focusing on risk management over profits, maintaining emotional detachment from individual trades, and viewing losses as tuition fees for learning. Developing this mindset requires self-awareness, regular psychological self-assessment, and commitment to continuous improvement. The difference between successful and unsuccessful traders often lies not in strategy but in psychological discipline and the ability to execute consistently despite emotional challenges.',
        lessonSummary: {
          overview: 'Advanced trading psychology involves developing mental frameworks, optimizing performance through systematic approaches, managing psychological challenges during difficult periods, and cultivating the professional mindset necessary for long-term success. Mental models are frameworks for understanding how markets and trading work; for example, viewing trading as a probability game rather than a quest for certainty helps accept losses as part of the process. The "edge" mental model recognizes that profitable trading comes from having a statistical advantage over many trades, not from winning every individual trade. Performance optimization involves systematic approaches to improvement: regular strategy review, identifying and eliminating weaknesses, tracking key performance metrics, and continuously refining your approach based on data rather than emotions. Dealing with large drawdowns requires psychological resilience, as drawdowns are inevitable in trading and can test even experienced traders\' confidence. During drawdowns, professional traders focus on process over outcomes, maintain discipline to their trading plan, reduce position sizes if necessary, and avoid the temptation to "make it back" quickly through revenge trading. Maintaining consistency means following your trading plan regardless of recent results, avoiding the trap of changing strategies after losses or becoming overconfident after wins. A professional trader\'s mindset treats trading as a business with expenses (losses), revenue (wins), and the goal of positive expectancy over time. This mindset includes accepting that not all trades will be winners, focusing on risk management over profits, maintaining emotional detachment from individual trades, and viewing losses as tuition fees for learning. Developing this mindset requires self-awareness, regular psychological self-assessment, and commitment to continuous improvement. The difference between successful and unsuccessful traders often lies not in strategy but in psychological discipline and the ability to execute consistently despite emotional challenges.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Advanced trading psychology covers mental models, performance optimization, dealing with large drawdowns, maintaining consistency, and developing the mindset of a professional trader.</p>',
        order: 5,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // ============================================
      // ADVANCED LEVEL: Advanced Forex Trading (Course 8) - Existing course
      // ============================================
      {
        courseId: course8Id,
        title: 'Risk Management Strategies',
        description: 'Protecting your capital with proper risk management.',
        summary: 'Advanced risk management is the cornerstone of professional trading, encompassing techniques that protect capital, control drawdowns, and ensure long-term survival in the markets. Capital preservation is the primary goal, as you cannot trade if you lose your account, making risk management more important than profit maximization. Advanced techniques include using correlation analysis to avoid overexposure to similar positions, implementing portfolio-level risk limits that cap total exposure across all trades, and using dynamic position sizing that adjusts based on account performance and market volatility. Drawdown management involves setting maximum acceptable drawdown limits (typically 15-20% for most traders) and implementing circuit breakers that reduce position sizes or pause trading when drawdowns approach these limits. For example, if your account drops 10% from its peak, you might reduce position sizes by 25% until recovery. The "risk of ruin" calculation helps determine the probability of losing your entire account based on win rate, risk-reward ratio, and position sizing, allowing you to adjust parameters to ensure survival. Risk-adjusted returns measure performance relative to risk taken, with metrics like the Sharpe ratio helping evaluate whether returns justify the risk. Advanced traders also use scenario analysis to stress-test their strategies under extreme market conditions, understanding how their portfolio would perform during market crashes or high volatility periods. Position correlation management ensures that multiple open positions don\'t all move against you simultaneously, as highly correlated pairs increase portfolio risk. Implementing these advanced techniques requires discipline and systematic application, but they are essential for transitioning from amateur to professional trading, as they protect capital during inevitable difficult periods and allow for compound growth over time.',
        lessonSummary: {
          overview: 'Advanced risk management is the cornerstone of professional trading, encompassing techniques that protect capital, control drawdowns, and ensure long-term survival in the markets. Capital preservation is the primary goal, as you cannot trade if you lose your account, making risk management more important than profit maximization. Advanced techniques include using correlation analysis to avoid overexposure to similar positions, implementing portfolio-level risk limits that cap total exposure across all trades, and using dynamic position sizing that adjusts based on account performance and market volatility. Drawdown management involves setting maximum acceptable drawdown limits (typically 15-20% for most traders) and implementing circuit breakers that reduce position sizes or pause trading when drawdowns approach these limits. For example, if your account drops 10% from its peak, you might reduce position sizes by 25% until recovery. The "risk of ruin" calculation helps determine the probability of losing your entire account based on win rate, risk-reward ratio, and position sizing, allowing you to adjust parameters to ensure survival. Risk-adjusted returns measure performance relative to risk taken, with metrics like the Sharpe ratio helping evaluate whether returns justify the risk. Advanced traders also use scenario analysis to stress-test their strategies under extreme market conditions, understanding how their portfolio would perform during market crashes or high volatility periods. Position correlation management ensures that multiple open positions don\'t all move against you simultaneously, as highly correlated pairs increase portfolio risk. Implementing these advanced techniques requires discipline and systematic application, but they are essential for transitioning from amateur to professional trading, as they protect capital during inevitable difficult periods and allow for compound growth over time.',
          updatedAt: new Date(),
        },
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Risk management is the most important aspect of trading. Learn how to protect your account.</p>',
        order: 1,
        type: 'video',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    // Get lesson IDs for quizzes (using first lessons from each course)
    // Course 1 (Forex Trading Fundamentals): lessons 0-5 (6 lessons)
    // Course 2 (Technical Basics): lessons 6-10 (5 lessons)
    // Course 3 (Forex Basics): lessons 11-13 (3 lessons)
    // Course 4 (Technical Analysis): lessons 14-18 (5 lessons)
    // Course 5 (Trading Strategies): lessons 19-23 (5 lessons)
    // Course 6 (Algorithmic Trading): lessons 24-28 (5 lessons)
    // Course 7 (Professional Forex Trading): lessons 29-33 (5 lessons)
    // Course 8 (Advanced Forex Trading): lesson 34 (1 lesson)
    const lesson1Id = lessons.insertedIds[0].toString(); // Forex Trading Fundamentals - Lesson 1
    const lesson2Id = lessons.insertedIds[1].toString(); // Forex Trading Fundamentals - Lesson 2
    const lesson7Id = lessons.insertedIds[6].toString(); // Technical Basics - Lesson 1 (Candlestick Patterns)
    const lesson14Id = lessons.insertedIds[13].toString(); // Technical Analysis - Lesson 1 (Advanced Candlestick)
    const lesson19Id = lessons.insertedIds[18].toString(); // Trading Strategies - Lesson 1 (Risk-Reward)
    const lesson24Id = lessons.insertedIds[23].toString(); // Algorithmic Trading - Lesson 1
    const lesson29Id = lessons.insertedIds[28].toString(); // Professional Forex Trading - Lesson 1
    
    // Seed Quizzes
    console.log('❓ Seeding quizzes...');
    await db.collection('quizzes').insertMany([
      // Forex Trading Fundamentals - Introduction to Forex
      {
        lessonId: lesson1Id,
        courseId: course1Id,
        questions: [
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
            question: 'What is the typical lot size in Forex trading?',
            options: ['100 units', '1,000 units', '10,000 units', '100,000 units'],
            correctAnswer: 3,
          },
          {
            question: 'The Forex market is primarily:',
            options: ['Centralized', 'Decentralized (OTC)', 'Regulated by one authority', 'Only accessible to banks'],
            correctAnswer: 1,
          },
          {
            question: 'What is a pip in Forex trading?',
            options: ['A type of currency', 'The smallest price movement', 'A trading strategy', 'A broker fee'],
            correctAnswer: 1,
          },
          {
            question: 'Which session has the highest trading volume?',
            options: ['Asian session', 'European session', 'London session', 'New York session'],
            correctAnswer: 2,
          },
          {
            question: 'Forex trading involves:',
            options: ['Buying and selling currencies', 'Only buying currencies', 'Only selling currencies', 'Holding currencies long-term'],
            correctAnswer: 0,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Forex Trading Fundamentals - Understanding Currency Pairs
      {
        lessonId: lesson2Id,
        courseId: course1Id,
        questions: [
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
            question: 'Exotic pairs typically include:',
            options: ['Only major currencies', 'One major and one emerging market currency', 'Two emerging market currencies', 'Only European currencies'],
            correctAnswer: 1,
          },
          {
            question: 'What does a bid price represent?',
            options: ['The price at which you can sell', 'The price at which you can buy', 'The average price', 'The closing price'],
            correctAnswer: 0,
          },
          {
            question: 'The spread is the difference between:',
            options: ['Bid and ask prices', 'High and low prices', 'Open and close prices', 'Buy and sell orders'],
            correctAnswer: 0,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Technical Basics - Candlestick Patterns
      {
        lessonId: lesson7Id,
        courseId: course2Id,
        questions: [
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
            question: 'A hammer candlestick pattern is typically:',
            options: ['A bullish reversal signal', 'A bearish reversal signal', 'A continuation pattern', 'A neutral pattern'],
            correctAnswer: 0,
          },
          {
            question: 'The body of a candlestick shows:',
            options: ['High and low prices', 'Opening and closing prices', 'Volume', 'Spread'],
            correctAnswer: 1,
          },
          {
            question: 'A long upper wick suggests:',
            options: ['Strong buying pressure', 'Strong selling pressure at highs', 'No trading activity', 'Market consolidation'],
            correctAnswer: 1,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Technical Analysis - Advanced Candlestick Patterns
      {
        lessonId: lesson14Id,
        courseId: course4Id,
        questions: [
          {
            question: 'The morning star pattern is typically:',
            options: ['A bullish reversal pattern', 'A bearish reversal pattern', 'A continuation pattern', 'A neutral pattern'],
            correctAnswer: 0,
          },
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
            question: 'The evening star pattern consists of:',
            options: ['One candlestick', 'Two candlesticks', 'Three candlesticks', 'Four candlesticks'],
            correctAnswer: 2,
          },
          {
            question: 'What does MACD stand for?',
            options: ['Moving Average Convergence Divergence', 'Market Analysis Chart Data', 'Maximum Average Change Direction', 'Multiple Asset Chart Display'],
            correctAnswer: 0,
          },
          {
            question: 'A bearish engulfing pattern occurs when:',
            options: ['A small bearish candle is followed by a larger bullish candle', 'A small bullish candle is followed by a larger bearish candle', 'Two equal candles form', 'No pattern is visible'],
            correctAnswer: 1,
          },
          {
            question: 'Support and resistance levels are:',
            options: ['Price levels where buying/selling pressure is strong', 'Time-based indicators', 'Volume indicators', 'Moving averages'],
            correctAnswer: 0,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Trading Strategies - Risk-Reward Ratio
      {
        lessonId: lesson19Id,
        courseId: course5Id,
        questions: [
          {
            question: 'A favorable risk-reward ratio is typically:',
            options: ['1:1', '1:2 or higher', '2:1', '1:0.5'],
            correctAnswer: 1,
          },
          {
            question: 'Position sizing should be based on:',
            options: ['Account balance only', 'Risk tolerance and account balance', 'Gut feeling', 'Maximum leverage available'],
            correctAnswer: 1,
          },
          {
            question: 'What is a stop-loss order?',
            options: ['An order to take profits', 'An order to limit losses', 'An order to enter a trade', 'An order to close all positions'],
            correctAnswer: 1,
          },
          {
            question: 'Risk management involves:',
            options: ['Maximizing profits only', 'Protecting capital and managing risk', 'Ignoring losses', 'Trading with maximum leverage'],
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
            question: 'Diversification in trading means:',
            options: ['Trading only one currency pair', 'Spreading risk across different trades/pairs', 'Using maximum leverage', 'Ignoring market analysis'],
            correctAnswer: 1,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Algorithmic Trading - Introduction
      {
        lessonId: lesson24Id,
        courseId: course6Id,
        questions: [
          {
            question: 'Algorithmic trading uses:',
            options: ['Human intuition', 'Computer programs with predefined rules', 'Random signals', 'Only technical indicators'],
            correctAnswer: 1,
          },
          {
            question: 'Backtesting allows you to:',
            options: ['Predict future prices', 'Test strategies on historical data', 'Guarantee profits', 'Avoid all risks'],
            correctAnswer: 1,
          },
          {
            question: 'What is an Expert Advisor (EA)?',
            options: ['A human trading advisor', 'An automated trading system', 'A market analysis tool', 'A broker service'],
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
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Professional Forex Trading - Market Sentiment
      {
        lessonId: lesson29Id,
        courseId: course7Id,
        questions: [
          {
            question: 'COT reports show:',
            options: ['Currency prices', 'Commitment of Traders positions', 'Interest rates', 'GDP data'],
            correctAnswer: 1,
          },
          {
            question: 'Hedging is used to:',
            options: ['Increase profits', 'Protect existing positions from adverse moves', 'Leverage positions', 'Time the market'],
            correctAnswer: 1,
          },
          {
            question: 'What is market sentiment?',
            options: ['The overall attitude of traders toward a market', 'The price of a currency', 'The volume of trades', 'The spread between currencies'],
            correctAnswer: 0,
          },
          {
            question: 'COT reports are released:',
            options: ['Daily', 'Weekly', 'Monthly', 'Quarterly'],
            correctAnswer: 1,
          },
          {
            question: 'Fundamental analysis focuses on:',
            options: ['Chart patterns only', 'Economic indicators and news', 'Technical indicators only', 'Price movements only'],
            correctAnswer: 1,
          },
          {
            question: 'What is carry trade?',
            options: ['A short-term trading strategy', 'Borrowing in a low-interest currency to invest in a high-interest currency', 'Trading only major pairs', 'A risk-free strategy'],
            correctAnswer: 1,
          },
          {
            question: 'Market sentiment can be:',
            options: ['Only bullish', 'Only bearish', 'Bullish, bearish, or neutral', 'Always neutral'],
            correctAnswer: 2,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    // Seed Instructors (for landing page)
    console.log('👨‍🏫 Seeding instructors...');
    await db.collection('instructors').insertMany([
      {
        name: 'John Smith',
        title: 'Senior Forex Analyst',
        description: '15+ years of trading experience, specializing in technical analysis and risk management. Former hedge fund manager with a proven track record.',
        imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=faces',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Sarah Johnson',
        title: 'Fundamental Analysis Expert',
        description: 'Expert in economic indicators and market fundamentals with a proven track record. PhD in Economics from Harvard University.',
        imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=faces',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Michael Chen',
        title: 'Algorithmic Trading Specialist',
        description: 'Master of automated trading systems and algorithmic strategies for advanced traders. Built trading bots managing $50M+ in assets.',
        imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=faces',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    // Seed Progress for multiple students
    console.log('📊 Seeding progress and quiz scores...');
    const progressData = [];
    const quizScoresData = [];
    const certificatesData = [];
    
    // Create progress entries for top students (high points = more completions)
    const sortedStudentIds = studentIds.map((id, index) => ({
      id,
      points: studentNames[index].points,
      index
    })).sort((a, b) => b.points - a.points);
    
    sortedStudentIds.forEach((student, rank) => {
      const userId = student.id;
      const baseProgress = Math.min(100, 30 + (rank * 2)); // Top students have more progress
      
      // Course 1 (Forex Trading Fundamentals - Beginner) - 6 lessons
      if (rank < 25) {
        const course1Progress = rank < 15 ? 100 : Math.max(50, baseProgress);
        const completedLessons = course1Progress === 100 
          ? [lesson1Id, lesson2Id, lessons.insertedIds[2].toString(), lessons.insertedIds[3].toString(), lessons.insertedIds[4].toString(), lessons.insertedIds[5].toString()]
          : [lesson1Id];
        progressData.push({
          userId,
          courseId: course1Id,
          progress: course1Progress,
          completedLessons,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Add quiz scores for course 1
        if (rank < 20) {
          quizScoresData.push({
            userId,
            lessonId: lesson1Id,
            courseId: course1Id,
            score: 85 + (rank % 15), // Scores between 85-100
            answers: [0, 1, 1],
            createdAt: new Date(),
          });
        }
        
        // Create certificates for completed courses
        if (course1Progress === 100) {
          certificatesData.push({
            userId,
            courseId: course1Id,
            certificateId: `CERT-${userId.substring(0, 8)}-${course1Id.substring(0, 8)}`,
            issuedAt: new Date(Date.now() - (rank * 86400000)), // Staggered dates
            progress: 100,
            completedLessons: 6,
            totalLessons: 6,
          });
        }
      }
      
      // Course 2 (Technical Basics - Beginner) - 5 lessons
      if (rank < 20) {
        const course2Progress = rank < 10 ? 100 : Math.max(40, baseProgress - 20);
        const completedLessons = course2Progress === 100
          ? [lesson7Id, lessons.insertedIds[7].toString(), lessons.insertedIds[8].toString(), lessons.insertedIds[9].toString(), lessons.insertedIds[10].toString()]
          : [lesson7Id];
        progressData.push({
          userId,
          courseId: course2Id,
          progress: course2Progress,
          completedLessons,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Add quiz scores for course 2
        if (rank < 15) {
          quizScoresData.push({
            userId,
            lessonId: lesson7Id,
            courseId: course2Id,
            score: 80 + (rank % 20), // Scores between 80-100
            answers: [0, 2],
            createdAt: new Date(),
          });
        }
        
        // Create certificates for completed course 2
        if (course2Progress === 100) {
          certificatesData.push({
            userId,
            courseId: course2Id,
            certificateId: `CERT-${userId.substring(0, 8)}-${course2Id.substring(0, 8)}`,
            issuedAt: new Date(Date.now() - (rank * 86400000)),
            progress: 100,
            completedLessons: 5,
            totalLessons: 5,
          });
        }
      }
      
      // Course 4 (Technical Analysis - Intermediate) - 5 lessons
      if (rank < 15) {
        const course4Progress = rank < 8 ? 100 : Math.max(30, baseProgress - 30);
        const completedLessons = course4Progress === 100
          ? [lesson14Id, lessons.insertedIds[14].toString(), lessons.insertedIds[15].toString(), lessons.insertedIds[16].toString(), lessons.insertedIds[17].toString()]
          : [lesson14Id];
        progressData.push({
          userId,
          courseId: course4Id,
          progress: course4Progress,
          completedLessons,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Add quiz scores for course 4
        if (rank < 12) {
          quizScoresData.push({
            userId,
            lessonId: lesson14Id,
            courseId: course4Id,
            score: 75 + (rank % 25), // Scores between 75-100
            answers: [0, 0],
            createdAt: new Date(),
          });
        }
        
        // Create certificates for completed course 4
        if (course4Progress === 100) {
          certificatesData.push({
            userId,
            courseId: course4Id,
            certificateId: `CERT-${userId.substring(0, 8)}-${course4Id.substring(0, 8)}`,
            issuedAt: new Date(Date.now() - (rank * 86400000)),
            progress: 100,
            completedLessons: 5,
            totalLessons: 5,
          });
        }
      }
      
      // Course 5 (Trading Strategies - Intermediate) - 5 lessons
      if (rank < 12) {
        const course5Progress = rank < 6 ? 100 : Math.max(25, baseProgress - 35);
        const completedLessons = course5Progress === 100
          ? [lesson19Id, lessons.insertedIds[19].toString(), lessons.insertedIds[20].toString(), lessons.insertedIds[21].toString(), lessons.insertedIds[22].toString()]
          : [lesson19Id];
        progressData.push({
          userId,
          courseId: course5Id,
          progress: course5Progress,
          completedLessons,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Add quiz scores for course 5
        if (rank < 10) {
          quizScoresData.push({
            userId,
            lessonId: lesson19Id,
            courseId: course5Id,
            score: 70 + (rank % 30), // Scores between 70-100
            answers: [1, 1],
            createdAt: new Date(),
          });
        }
      }
      
      // Course 6 (Algorithmic Trading - Advanced) - 5 lessons
      if (rank < 10) {
        const course6Progress = rank < 5 ? 100 : Math.max(20, baseProgress - 40);
        const completedLessons = course6Progress === 100
          ? [lesson24Id, lessons.insertedIds[24].toString(), lessons.insertedIds[25].toString(), lessons.insertedIds[26].toString(), lessons.insertedIds[27].toString()]
          : [lesson24Id];
        progressData.push({
          userId,
          courseId: course6Id,
          progress: course6Progress,
          completedLessons,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Add quiz scores for course 6
        if (rank < 8) {
          quizScoresData.push({
            userId,
            lessonId: lesson24Id,
            courseId: course6Id,
            score: 65 + (rank % 35), // Scores between 65-100
            answers: [1, 1],
            createdAt: new Date(),
          });
        }
      }
      
      // Course 7 (Professional Forex Trading - Advanced) - 5 lessons
      if (rank < 8) {
        const course7Progress = rank < 4 ? 100 : Math.max(15, baseProgress - 45);
        const completedLessons = course7Progress === 100
          ? [lesson29Id, lessons.insertedIds[29].toString(), lessons.insertedIds[30].toString(), lessons.insertedIds[31].toString(), lessons.insertedIds[32].toString()]
          : [lesson29Id];
        progressData.push({
          userId,
          courseId: course7Id,
          progress: course7Progress,
          completedLessons,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Add quiz scores for course 7
        if (rank < 6) {
          quizScoresData.push({
            userId,
            lessonId: lesson29Id,
            courseId: course7Id,
            score: 60 + (rank % 40), // Scores between 60-100
            answers: [1, 1],
            createdAt: new Date(),
          });
        }
      }
    });
    
    // Add demo student progress
    progressData.push({
      userId: demoStudentId,
      courseId: course1Id,
      progress: 33.33, // 2 out of 6 lessons completed
      completedLessons: [lesson1Id, lesson2Id],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    await db.collection('progress').insertMany(progressData);
    await db.collection('quizScores').insertMany(quizScoresData);
    await db.collection('certificates').insertMany(certificatesData);
    
    // Create three community rooms (Beginner, Intermediate, Advanced)
    const communityRooms = [
      {
        name: 'Beginner',
        description: 'Perfect for newcomers learning basic concepts, market introductions, and simple analysis.',
        type: 'global',
        participants: [], // All users can access
        avatar: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Intermediate',
        description: 'For mid-level traders sharing strategies, chart analysis, and trading setups.',
        type: 'global',
        participants: [],
        avatar: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Advanced',
        description: 'For experienced traders discussing deep technical analysis, macro news, and advanced strategies.',
        type: 'global',
        participants: [],
        avatar: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    await db.collection('communityRooms').insertMany(communityRooms);
    console.log('✓ Created 3 community rooms (Beginner, Intermediate, Advanced)');
    
    // Seed community news
    const { seedCommunityNews } = require('./communityNews');
    await seedCommunityNews();
    console.log('✓ Seeded community news');
    
    console.log('✅ Database seeded successfully!');
    console.log('\n📋 Summary:');
    console.log(`   - Users: ${studentNames.length + 5} (${studentNames.length} diverse students, superadmin, instructor, admin, 2 pending)`);
    console.log(`   - Courses: 8 (3 Beginner, 2 Intermediate, 3 Advanced)`);
    console.log(`   - Lessons: 35 (6+5+3 Beginner, 5+5 Intermediate, 5+5+1 Advanced)`);
    console.log(`   - Quizzes: 7 (one per course)`);
    console.log(`   - Instructors: 3`);
    console.log(`   - Progress entries: ${progressData.length}`);
    console.log(`   - Quiz scores: ${quizScoresData.length}`);
    console.log(`   - Certificates: ${certificatesData.length}`);
    console.log('\n🌍 Students from:');
    console.log('   - Africa: Nigeria, Ghana, Senegal, South Africa, Kenya, Mali, Zimbabwe');
    console.log('   - Asia: India, China, Japan, UAE, Egypt');
    console.log('   - Americas: Brazil, Mexico, Colombia, USA');
    console.log('   - Europe: UK, France, Italy');
    // Find top student by points
    const topStudent = studentNames.reduce((max, student) => 
      student.points > max.points ? student : max
    );
    
    console.log('\n🏆 Leaderboard Features:');
    console.log('   - Points-based rankings (top student: ' + topStudent.name + ' with ' + topStudent.points + ' points)');
    console.log('   - Course completion rankings');
    console.log('   - Quiz score rankings');
    console.log('\n🔑 Demo Login Credentials:');
    console.log('   Student: student@demo.com / password123');
    console.log('   Instructor: instructor@demo.com / password123');
    console.log('   Admin: admin@demo.com / password123');
    
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seed();

