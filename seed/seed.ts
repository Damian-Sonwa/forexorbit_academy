/**
 * Database Seeder
 * Populates MongoDB Atlas with sample data for testing
 * Run with: npx ts-node seed/seed.ts
 */

import clientPromise from '../db/mongoClient';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

async function seed() {
  try {
    console.log('🌱 Starting database seed...');
    
    const client = await clientPromise;
    const db = client.db('Forex_elearning');
    
    // Clear existing collections (optional - comment out if you want to keep existing data)
    console.log('🗑️  Clearing existing collections...');
    await db.collection('users').deleteMany({});
    await db.collection('courses').deleteMany({});
    await db.collection('lessons').deleteMany({});
    await db.collection('quizzes').deleteMany({});
    await db.collection('progress').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('quizScores').deleteMany({});
    
    // Hash password for demo users
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    // Seed Users
    console.log('👥 Seeding users...');
    const users = await db.collection('users').insertMany([
      {
        name: 'Demo Student',
        email: 'student@demo.com',
        password: hashedPassword,
        role: 'student',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Demo Instructor',
        email: 'instructor@demo.com',
        password: hashedPassword,
        role: 'instructor',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Admin User',
        email: 'admin@demo.com',
        password: hashedPassword,
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    const studentId = users.insertedIds[0].toString();
    const instructorId = users.insertedIds[1].toString();
    const adminId = users.insertedIds[2].toString();
    
    // Seed Courses
    console.log('📚 Seeding courses...');
    const courses = await db.collection('courses').insertMany([
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
      {
        title: 'Technical Analysis',
        description: 'Master technical analysis techniques including chart patterns, indicators, and trading signals.',
        category: 'technical',
        difficulty: 'intermediate',
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
    
    const course1Id = courses.insertedIds[0].toString();
    const course2Id = courses.insertedIds[1].toString();
    const course3Id = courses.insertedIds[2].toString();
    
    // Seed Lessons
    console.log('📖 Seeding lessons...');
    const lessons = await db.collection('lessons').insertMany([
      // Course 1: Forex Basics
      {
        courseId: course1Id,
        title: 'Introduction to Forex',
        description: 'What is Forex trading and how does it work?',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // Demo URL
        content: '<p>Forex, or foreign exchange, is the global marketplace for trading currencies. In this lesson, you will learn the basics of how Forex markets operate.</p>',
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course1Id,
        title: 'Understanding Currency Pairs',
        description: 'Learn about major, minor, and exotic currency pairs.',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Currency pairs are the foundation of Forex trading. This lesson covers major pairs like EUR/USD, GBP/USD, and USD/JPY.</p>',
        order: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course1Id,
        title: 'Market Hours and Sessions',
        description: 'Understanding when Forex markets are open.',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>The Forex market operates 24 hours a day, five days a week. Learn about the different trading sessions.</p>',
        order: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Course 2: Technical Analysis
      {
        courseId: course2Id,
        title: 'Reading Charts',
        description: 'Introduction to candlestick charts and price action.',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Charts are essential tools for technical analysis. Learn how to read and interpret price charts.</p>',
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        courseId: course2Id,
        title: 'Support and Resistance',
        description: 'Understanding key price levels.',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Support and resistance levels are crucial for identifying entry and exit points in trading.</p>',
        order: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Course 3: Advanced Trading
      {
        courseId: course3Id,
        title: 'Risk Management Strategies',
        description: 'Protecting your capital with proper risk management.',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<p>Risk management is the most important aspect of trading. Learn how to protect your account.</p>',
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    const lesson1Id = lessons.insertedIds[0].toString();
    const lesson2Id = lessons.insertedIds[1].toString();
    const lesson4Id = lessons.insertedIds[3].toString();
    
    // Seed Quizzes
    console.log('❓ Seeding quizzes...');
    await db.collection('quizzes').insertMany([
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
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
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
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        lessonId: lesson4Id,
        courseId: course2Id,
        questions: [
          {
            question: 'What is a candlestick chart?',
            options: [
              'A type of price chart',
              'A trading strategy',
              'A currency pair',
              'A market indicator',
            ],
            correctAnswer: 0,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    // Seed Progress (student enrolled in course 1)
    console.log('📊 Seeding progress...');
    await db.collection('progress').insertOne({
      userId: studentId,
      courseId: course1Id,
      progress: 33.33, // 1 out of 3 lessons completed
      completedLessons: [lesson1Id],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    console.log('✅ Database seeded successfully!');
    console.log('\n📋 Summary:');
    console.log(`   - Users: 3 (student, instructor, admin)`);
    console.log(`   - Courses: 3`);
    console.log(`   - Lessons: 6`);
    console.log(`   - Quizzes: 3`);
    console.log(`   - Progress: 1 enrollment`);
    console.log('\n🔑 Demo Login Credentials:');
    console.log('   Student: student@demo.com / password123');
    console.log('   Instructor: instructor@demo.com / password123');
    console.log('   Admin: admin@demo.com / password123');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seed();


