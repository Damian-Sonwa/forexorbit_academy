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
    console.log('🗑️  Clearing existing collections...');
    await db.collection('users').deleteMany({});
    await db.collection('courses').deleteMany({});
    await db.collection('lessons').deleteMany({});
    await db.collection('quizzes').deleteMany({});
    await db.collection('progress').deleteMany({});
    await db.collection('messages').deleteMany({});
    await db.collection('quizScores').deleteMany({});
    await db.collection('instructors').deleteMany({});
    
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
      points: student.points || 0,
      region: student.region,
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
        points: 1500,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Demo Instructor',
        email: 'instructor@demo.com',
        password: hashedPassword,
        role: 'instructor',
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'Admin User',
        email: 'admin@demo.com',
        password: hashedPassword,
        role: 'admin',
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    
    const studentIds = Object.values(users.insertedIds).slice(0, studentNames.length).map(id => id.toString());
    const demoStudentId = users.insertedIds[studentNames.length].toString();
    const instructorId = users.insertedIds[studentNames.length + 1].toString();
    const adminId = users.insertedIds[studentNames.length + 2].toString();
    
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
      {
        courseId: course1Id,
        title: 'Introduction to Forex',
        description: 'What is Forex trading and how does it work?',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
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
      
      // Course 1 progress
      if (rank < 25) {
        const course1Progress = rank < 15 ? 100 : Math.max(50, baseProgress);
        progressData.push({
          userId,
          courseId: course1Id,
          progress: course1Progress,
          completedLessons: course1Progress === 100 ? [lesson1Id, lesson2Id, lessons.insertedIds[2].toString()] : [lesson1Id],
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
            completedLessons: 3,
            totalLessons: 3,
          });
        }
      }
      
      // Course 2 progress (intermediate)
      if (rank < 20) {
        const course2Progress = rank < 10 ? 100 : Math.max(40, baseProgress - 20);
        progressData.push({
          userId,
          courseId: course2Id,
          progress: course2Progress,
          completedLessons: course2Progress === 100 ? [lesson4Id, lessons.insertedIds[4].toString()] : [lesson4Id],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Add quiz scores for course 2
        if (rank < 15) {
          quizScoresData.push({
            userId,
            lessonId: lesson4Id,
            courseId: course2Id,
            score: 80 + (rank % 20), // Scores between 80-100
            answers: [0],
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
            completedLessons: 2,
            totalLessons: 2,
          });
        }
      }
      
      // Course 3 progress (advanced - fewer students)
      if (rank < 12) {
        const course3Progress = rank < 5 ? 100 : Math.max(30, baseProgress - 40);
        progressData.push({
          userId,
          courseId: course3Id,
          progress: course3Progress,
          completedLessons: course3Progress === 100 ? [lessons.insertedIds[5].toString()] : [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        // Create certificates for completed course 3
        if (course3Progress === 100) {
          certificatesData.push({
            userId,
            courseId: course3Id,
            certificateId: `CERT-${userId.substring(0, 8)}-${course3Id.substring(0, 8)}`,
            issuedAt: new Date(Date.now() - (rank * 86400000)),
            progress: 100,
            completedLessons: 1,
            totalLessons: 1,
          });
        }
      }
    });
    
    // Add demo student progress
    progressData.push({
      userId: demoStudentId,
      courseId: course1Id,
      progress: 33.33,
      completedLessons: [lesson1Id],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    await db.collection('progress').insertMany(progressData);
    await db.collection('quizScores').insertMany(quizScoresData);
    await db.collection('certificates').insertMany(certificatesData);
    
    console.log('✅ Database seeded successfully!');
    console.log('\n📋 Summary:');
    console.log(`   - Users: ${studentNames.length + 3} (${studentNames.length} diverse students, instructor, admin)`);
    console.log(`   - Courses: 3`);
    console.log(`   - Lessons: 6`);
    console.log(`   - Quizzes: 3`);
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

