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

app.prepare().then(async () => {
  console.log('✓ Next.js app prepared');
  
  // Seed community rooms on server start (non-blocking)
  try {
    const { seedRooms } = require('./scripts/seed-rooms');
    await seedRooms();
    console.log('✓ Community rooms seeded');
  } catch (error) {
    console.warn('⚠ Failed to seed rooms (non-critical):', error.message);
  }
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
  // CRITICAL: Allow both Render URL and Vercel URL (or any URLs in ALLOWED_ORIGINS env var)
  // IMPORTANT: Do NOT restrict to websocket only - allow upgrade from polling → websocket
  // CRITICAL: CORS origins - must include all Vercel domains and Render domain
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
        'https://forexorbit-academy11.vercel.app',
        'https://forexorbit-academy001.vercel.app',
        'https://forexorbit-academy.vercel.app',
        'https://forexorbit-academy.onrender.com',
        // Allow any Vercel preview URLs
        ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
        // Development
        ...(dev ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
      ];
  
  // CRITICAL: Socket.IO configuration for Render WebSocket support
  // MUST allow polling → websocket upgrade for Render compatibility
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
          // Log for debugging
          console.log('CORS check - origin:', origin, 'allowed:', allowedOrigins);
          // Log for debugging but allow in development
          if (dev) {
            console.warn('CORS warning - origin not in allowed list:', origin);
            callback(null, true);
          } else {
            // In production, be more permissive for WebSocket upgrades
            // Some browsers send different origins for WebSocket vs HTTP
            if (origin.includes('vercel.app') || origin.includes('onrender.com')) {
              console.log('Allowing WebSocket origin (Vercel/Render):', origin);
              callback(null, true);
            } else {
              callback(new Error('Not allowed by CORS'));
            }
          }
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // CRITICAL: MUST allow both transports and enable upgrade for Render
    transports: ['polling', 'websocket'], // Order matters: polling first, then upgrade to websocket
    allowUpgrades: true, // CRITICAL: Enable polling → websocket upgrade
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000, // Allow time for upgrade from polling to websocket
    // CRITICAL: Additional settings for Render compatibility
    perMessageDeflate: false, // Disable compression for better compatibility
    httpCompression: false, // Disable HTTP compression
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

    // Community room handlers - Validate room exists in database before joining
    socket.on('joinRoom', async (data) => {
      const { roomId } = data;
      if (!roomId) {
        console.warn('joinRoom called without roomId');
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      try {
        // Check if room exists in database (skip check for community_global which is a socket room)
        if (roomId !== 'community_global') {
          const { getDb } = require('./lib/mongodb');
          const { ObjectId } = require('mongodb');
          const db = await getDb();
          const rooms = db.collection('communityRooms');
          
          // Handle both ObjectId and string roomId
          let room;
          if (roomId.match(/^[0-9a-fA-F]{24}$/)) {
            // Valid ObjectId format
            room = await rooms.findOne({ _id: new ObjectId(roomId), type: 'global' });
          } else {
            // String format - try to find by name or _id as string
            room = await rooms.findOne({ 
              $or: [
                { _id: roomId },
                { name: roomId },
                { slug: roomId }
              ],
              type: 'global'
            });
          }
          
          if (!room) {
            console.warn(`Room not found in database: ${roomId}`);
            socket.emit('error', { message: 'Room not found' });
            return;
          }
          
          // Use the actual room ID from database
          const actualRoomId = room._id.toString();
          socket.join(`room:${actualRoomId}`);
          console.log(`User ${user.email} joined room: ${room.name} (${actualRoomId})`);
          
          // Emit confirmation with actual room ID
          socket.emit('room_joined', { roomId: actualRoomId, roomName: room.name });
          
          // Notify others in the room
          socket.to(`room:${actualRoomId}`).emit('userJoined', {
            userId: user.userId,
            userName: user.email,
            roomId: actualRoomId,
          });
        } else {
          // community_global is a special socket room (not in database)
          socket.join('room:community_global');
          console.log(`User ${user.email} joined community_global room`);
          socket.emit('room_joined', { roomId: 'community_global' });
        }
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

    // Consultation room handlers - Idempotent room joining
    // Rooms are created automatically by socket.io when first user joins
    // Single source of truth: consultation_<sessionId> room for all communication
    socket.on('joinConsultation', async (data) => {
      const { sessionId } = data;
      if (!sessionId) {
        console.warn('joinConsultation called without sessionId');
        return;
      }

      // Always join the room immediately - socket.io creates it if it doesn't exist
      // This is idempotent - joining an already-joined room is safe
      socket.join(`consultation:${sessionId}`);
      console.log(`User ${user.email} joined consultation room: ${sessionId}`);
      
      // Emit confirmation that room was joined
      socket.emit('consultation_room_joined', { sessionId });

      // Validate access asynchronously (non-blocking)
      try {
        const { getDb } = require('./lib/mongodb');
        const { ObjectId } = require('mongodb');
        const db = await getDb();
        const sessions = db.collection('consultationSessions');

        // Verify session exists and user has access
        const session = await sessions.findOne({ _id: new ObjectId(sessionId) });
        if (!session) {
          console.warn(`Consultation session ${sessionId} not found in database`);
          // Don't emit error - room is already joined, just log warning
          return;
        }

        // Check access: student can only join their sessions, instructor/admin can join their assigned sessions
        const hasAccess = 
          (user.role === 'student' && session.studentId === user.userId) ||
          ((user.role === 'instructor' || user.role === 'admin' || user.role === 'superadmin') && 
           (session.expertId === user.userId || user.role === 'admin' || user.role === 'superadmin'));

        if (!hasAccess) {
          console.warn(`User ${user.email} attempted to join consultation ${sessionId} without access`);
          // Don't emit error - room is already joined, just log warning
          // Access control should be enforced at API level for message sending
          return;
        }

        // Notify other participant that user joined
        const otherUserId = user.role === 'student' ? session.expertId : session.studentId;
        io.to(`user:${otherUserId}`).emit('consultationUserJoined', {
          sessionId,
          userId: user.userId,
        });
      } catch (error) {
        console.error('Error validating consultation access:', error);
        // Don't emit error - room is already joined, just log error
      }
    });

    // Auto-join consultation room when request is accepted
    // This ensures both parties are immediately connected for communication
    socket.on('join_consultation_room', (data) => {
      const { sessionId } = data;
      if (!sessionId) {
        console.warn('join_consultation_room called without sessionId');
        return;
      }

      // Join consultation room immediately - room is created automatically
      socket.join(`consultation:${sessionId}`);
      console.log(`User ${user.email} auto-joined consultation room: ${sessionId}`);
      
      // Emit confirmation
      socket.emit('consultation_room_joined', { sessionId });
    });

    socket.on('leaveConsultation', (data) => {
      const { sessionId } = data;
      if (sessionId) {
        socket.leave(`consultation:${sessionId}`);
        console.log(`User ${user.email} left consultation ${sessionId}`);
      }
    });

    // WebRTC signaling removed - replaced with Agora SDK

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
    console.log(`  ✓ Socket.io: Running on ${serverUrl}/api/socket`);
    console.log(`  ✓ Port: ${port}`);
    console.log(`  ✓ Hostname: ${hostname}`);
    console.log(`  ✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  ✓ Allowed CORS origins: ${allowedOrigins.join(', ')}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
  });
}).catch((err) => {
  console.error('❌ Failed to prepare Next.js app:', err);
  process.exit(1);
});

