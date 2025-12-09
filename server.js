/**
 * Custom Server for Socket.io Integration
 * Required for Socket.io to work with Next.js
 */

// Load environment variables
// Try .env.local first (for local development), then fall back to .env (for production)
if (require('fs').existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
} else {
  require('dotenv').config();
}

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Validate environment variables
if (!process.env.MONGO_URI) {
  console.error('❌ Error: MONGO_URI not defined in .env.local');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('❌ Error: JWT_SECRET not defined in .env.local');
  process.exit(1);
}

// JWT verification for Socket.io
function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

const dev = process.env.NODE_ENV !== 'production';
// Use 0.0.0.0 for production (allows external connections) or localhost for dev
const hostname = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  console.log('✓ Next.js app prepared');
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize Socket.io with CORS support for multiple origins
  // Allow both Render URL and Vercel URL (or any URLs in ALLOWED_ORIGINS env var)
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
        process.env.NEXT_PUBLIC_SOCKET_URL || 
        (dev ? 'http://localhost:3000' : process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'),
        'https://forexorbit-academy001.vercel.app',
        'https://forexorbit-academy.onrender.com'
      ];
  
  const io = new Server(server, {
    path: '/api/socket',
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Export io instance for API routes
  const { setSocketServer } = require('./lib/socket-server.js');
  setSocketServer(io);

  // Socket.io authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }
      const payload = verifyToken(token);
      socket.data.user = payload;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  // Socket.io connection handler
  io.on('connection', async (socket) => {
    const user = socket.data.user;
    console.log(`User connected: ${user.email}`);

    // Join lesson room
    socket.on('joinLesson', (lessonId) => {
      socket.join(`lesson:${lessonId}`);
    });

    // Leave lesson room
    socket.on('leaveLesson', (lessonId) => {
      socket.leave(`lesson:${lessonId}`);
    });

    // Handle chat messages
    socket.on('chatMessage', async (data) => {
      try {
        const { getDb } = require('./lib/mongodb');
        const db = await getDb();
        const messages = db.collection('messages');
        const { ObjectId } = require('mongodb');
        const users = db.collection('users');

        const userDoc = await users.findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { name: 1 } }
        );

        const message = {
          lessonId: data.lessonId,
          userId: user.userId,
          senderName: userDoc?.name || 'Anonymous',
          text: data.text,
          createdAt: new Date(),
        };

        const result = await messages.insertOne(message);

        io.to(`lesson:${data.lessonId}`).emit('chatMessage', {
          id: result.insertedId.toString(),
          ...message,
        });
      } catch (error) {
        console.error('Chat message error:', error);
      }
    });

    // Handle progress updates
    socket.on('progressUpdate', async (data) => {
      try {
        const { getDb } = require('./lib/mongodb');
        const db = await getDb();
        const progress = db.collection('progress');
        const lessons = db.collection('lessons');

        let courseProgress = await progress.findOne({
          userId: user.userId,
          courseId: data.courseId,
        });

        const completedLessons = courseProgress?.completedLessons || [];
        if (!completedLessons.includes(data.lessonId)) {
          completedLessons.push(data.lessonId);
        }

        const courseLessons = await lessons.find({ courseId: data.courseId }).toArray();
        const progressPercent = courseLessons.length > 0 
          ? (completedLessons.length / courseLessons.length) * 100 
          : 0;

        if (courseProgress) {
          await progress.updateOne(
            { userId: user.userId, courseId: data.courseId },
            {
              $set: {
                completedLessons,
                progress: progressPercent,
                updatedAt: new Date(),
              },
            }
          );
        } else {
          await progress.insertOne({
            userId: user.userId,
            courseId: data.courseId,
            completedLessons,
            progress: progressPercent,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        socket.emit('progressUpdated', {
          courseId: data.courseId,
          progress: progressPercent,
        });
      } catch (error) {
        console.error('Progress update error:', error);
      }
    });

    // Handle lesson updates (from instructor dashboard)
    socket.on('lessonUpdated', async (data) => {
      try {
        // Broadcast to all users watching this course/lesson
        io.to(`course:${data.courseId}`).emit('lessonUpdated', {
          lessonId: data.lessonId,
          courseId: data.courseId,
        });
        io.to(`lesson:${data.lessonId}`).emit('lessonUpdated', {
          lessonId: data.lessonId,
          courseId: data.courseId,
        });
        console.log(`Lesson ${data.lessonId} updated in course ${data.courseId}`);
      } catch (error) {
        console.error('Lesson update notification error:', error);
      }
    });

    // Handle quiz updates (from instructor dashboard)
    socket.on('quizUpdated', async (data) => {
      try {
        // Broadcast to all users watching this lesson
        io.to(`lesson:${data.lessonId}`).emit('quizUpdated', {
          lessonId: data.lessonId,
        });
        console.log(`Quiz updated for lesson ${data.lessonId}`);
      } catch (error) {
        console.error('Quiz update notification error:', error);
      }
    });

    // Community room handlers
    socket.on('joinRoom', async (data) => {
      const { roomId } = data;
      
      try {
        const { getDb } = require('./lib/mongodb');
        const { canAccessRoom } = require('./lib/learning-level');
        const db = await getDb();
        const rooms = db.collection('communityRooms');
        const users = db.collection('users');
        const { ObjectId } = require('mongodb');

        // Get room info
        const room = await rooms.findOne({ _id: new ObjectId(roomId) });
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Get user's learning level
        const userDoc = await users.findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { learningLevel: 1, role: 1 } }
        );

        // Determine user's learning level
        let userLevel = 'beginner';
        if (userDoc?.role !== 'student') {
          userLevel = 'advanced';
        } else {
          userLevel = userDoc?.learningLevel || 'beginner';
        }

        // Check access for global rooms - BLOCK access to locked rooms
        if (room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name)) {
          if (!canAccessRoom(userLevel, room.name)) {
            socket.emit('error', { 
              message: 'Access denied. This group unlocks when you complete the previous level.' 
            });
            return; // Don't allow joining locked rooms
          }
        }

        // Check access for direct messages
        if (room.type === 'direct' && !room.participants.includes(user.userId)) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Join the room - user can now receive messages for this level-specific room
        socket.join(`room:${roomId}`);
        console.log(`User ${user.email} joined room ${roomId}`);
        // Notify others in the room that a new user joined
        socket.to(`room:${roomId}`).emit('userJoined', {
          userId: user.userId,
          userName: user.email,
          roomId: roomId,
        });
      } catch (error) {
        console.error('Error joining room:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('leaveRoom', (data) => {
      const { roomId } = data;
      socket.leave(`room:${roomId}`);
      console.log(`User ${user.email} left room ${roomId}`);
      socket.to(`room:${roomId}`).emit('userLeft', {
        userId: user.userId,
        roomId: roomId,
      });
    });

    // Typing indicators
    socket.on('typing', (data) => {
      const { roomId } = data;
      socket.to(`room:${roomId}`).emit('typing', {
        roomId,
        userId: user.userId,
        userName: user.email,
      });
    });

    // Consultation handlers
    socket.on('joinConsultation', async (data) => {
      const { sessionId } = data;
      try {
        const { getDb } = require('./lib/mongodb');
        const db = await getDb();
        const sessions = db.collection('consultationSessions');
        const { ObjectId } = require('mongodb');

        const session = await sessions.findOne({ _id: new ObjectId(sessionId) });
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        // Verify user has access
        if (user.userId !== session.studentId && user.userId !== session.expertId) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Join user-specific room and session room
        socket.join(`user:${user.userId}`);
        socket.join(`consultation:${sessionId}`);
        console.log(`User ${user.email} joined consultation ${sessionId}`);
      } catch (error) {
        console.error('Error joining consultation:', error);
        socket.emit('error', { message: 'Failed to join consultation' });
      }
    });

    socket.on('leaveConsultation', (data) => {
      const { sessionId } = data;
      socket.leave(`consultation:${sessionId}`);
      console.log(`User ${user.email} left consultation ${sessionId}`);
    });

    socket.on('consultationTyping', (data) => {
      const { sessionId } = data;
      socket.to(`consultation:${sessionId}`).emit('consultationTyping', {
        sessionId,
        userId: user.userId,
        userName: user.email,
      });
    });

    socket.on('consultationStopTyping', (data) => {
      const { sessionId } = data;
      socket.to(`consultation:${sessionId}`).emit('consultationStopTyping', {
        sessionId,
        userId: user.userId,
      });
    });

    socket.on('stopTyping', (data) => {
      const { roomId } = data;
      socket.to(`room:${roomId}`).emit('stopTyping', {
        roomId,
        userId: user.userId,
      });
    });

    // User online/offline status
    socket.on('userOnline', () => {
      // Broadcast to all rooms user is in
      socket.broadcast.emit('userOnline', {
        userId: user.userId,
      });
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${user.email}`);
      // Broadcast offline status
      socket.broadcast.emit('userOffline', {
        userId: user.userId,
        lastSeen: new Date(),
      });
    });
  });

  // Market signals emitter
  const symbols = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'];
  const types = ['buy', 'sell'];

  setInterval(() => {
    const signal = {
      symbol: symbols[Math.floor(Math.random() * symbols.length)],
      price: (Math.random() * 2 + 0.5).toFixed(5),
      type: types[Math.floor(Math.random() * types.length)],
      timestamp: new Date().toISOString(),
    };
    io.emit('marketSignal', signal);
  }, 3000);

  server.listen(port, hostname, (err) => {
    if (err) throw err;
    const serverUrl = process.env.NODE_ENV === 'production' 
      ? (process.env.RENDER_EXTERNAL_URL || `http://${hostname}:${port}`)
      : `http://${hostname}:${port}`;
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  ✓ Server is ready!');
    console.log(`  ✓ Frontend: ${serverUrl}`);
    console.log(`  ✓ MongoDB: Connected to Atlas cluster`);
    console.log(`  ✓ Database: Forex_elearning`);
    console.log(`  ✓ Socket.io: Running on /api/socket`);
    console.log(`  ✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
  });
}).catch((err) => {
  console.error('❌ Failed to prepare Next.js app:', err);
  process.exit(1);
});

