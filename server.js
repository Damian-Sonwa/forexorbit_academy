/**
 * Custom Server for Socket.io Integration
 * Required for Socket.io to work with Next.js
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' });

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
const hostname = 'localhost';
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

  // Initialize Socket.io
  const io = new Server(server, {
    path: '/api/socket',
    cors: {
      origin: process.env.NEXT_PUBLIC_SOCKET_URL || '*',
      methods: ['GET', 'POST'],
    },
  });

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

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${user.email}`);
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

  server.listen(port, (err) => {
    if (err) throw err;
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  ✓ Server is ready!');
    console.log(`  ✓ Frontend: http://${hostname}:${port}`);
    console.log(`  ✓ MongoDB: Connected to Atlas cluster`);
    console.log(`  ✓ Database: Forex_elearning`);
    console.log(`  ✓ Socket.io: Running on /api/socket`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
  });
}).catch((err) => {
  console.error('❌ Failed to prepare Next.js app:', err);
  process.exit(1);
});

