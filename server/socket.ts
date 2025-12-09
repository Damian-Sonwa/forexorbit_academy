/**
 * Socket.io Server Setup
 * Handles real-time features: chat, progress updates, market signals
 */

import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyToken } from '@/lib/jwt';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

interface SocketAuth {
  userId: string;
  email: string;
  role: string;
}

export function initializeSocket(server: HTTPServer) {
  const io = new SocketIOServer(server, {
    path: '/api/socket',
    cors: {
      origin: process.env.NEXT_PUBLIC_SOCKET_URL || '*',
      methods: ['GET', 'POST'],
    },
  });

  // JWT Authentication Middleware
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

  io.on('connection', async (socket) => {
    const user = socket.data.user as SocketAuth;
    console.log(`User connected: ${user.email}`);

    // Join lesson room for chat
    socket.on('joinLesson', async (lessonId: string) => {
      socket.join(`lesson:${lessonId}`);
      console.log(`User ${user.email} joined lesson ${lessonId}`);
    });

    // Leave lesson room
    socket.on('leaveLesson', (lessonId: string) => {
      socket.leave(`lesson:${lessonId}`);
    });

    // Handle chat messages
    socket.on('chatMessage', async (data: { lessonId: string; text: string }) => {
      try {
        const db = await getDb();
        const messages = db.collection('messages');
        const users = db.collection('users');

        const userDoc = await users.findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { name: 1 } }
        );

        const message: any = {
          lessonId: data.lessonId,
          userId: user.userId,
          senderName: userDoc?.name || 'Anonymous',
          text: data.text,
          createdAt: new Date(),
        };

        // Save to database
        const result = await messages.insertOne(message);
        message._id = result.insertedId;

        // Broadcast to room
        const messageToEmit = {
          id: result.insertedId.toString(),
          lessonId: message.lessonId,
          userId: message.userId,
          senderName: message.senderName,
          text: message.text,
          createdAt: message.createdAt,
        };
        io.to(`lesson:${data.lessonId}`).emit('chatMessage', messageToEmit);
      } catch (error) {
        console.error('Chat message error:', error);
      }
    });

    // Handle progress updates
    socket.on('progressUpdate', async (data: { courseId: string; lessonId: string }) => {
      try {
        const db = await getDb();
        const progress = db.collection('progress');
        const lessons = db.collection('lessons');

        // Update progress
        let courseProgress = await progress.findOne({
          userId: user.userId,
          courseId: data.courseId,
        });

        const completedLessons = courseProgress?.completedLessons || [];
        if (!completedLessons.includes(data.lessonId)) {
          completedLessons.push(data.lessonId);
        }

        const courseLessons = await lessons.find({ courseId: data.courseId }).toArray();
        const progressPercent = (completedLessons.length / courseLessons.length) * 100;

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

        // Emit to user's dashboard
        socket.emit('progressUpdated', {
          courseId: data.courseId,
          progress: progressPercent,
        });

        // Emit to instructor/admin panels if they're watching
        io.to(`course:${data.courseId}`).emit('studentProgress', {
          userId: user.userId,
          courseId: data.courseId,
          progress: progressPercent,
        });

        // Check if course is completed (100%) and emit certificate eligibility
        if (progressPercent >= 100) {
          const db = await getDb();
          const certificates = db.collection('certificates');
          const existingCert = await certificates.findOne({
            userId: user.userId,
            courseId: data.courseId,
          });

          if (!existingCert) {
            socket.emit('courseCompleted', {
              courseId: data.courseId,
              progress: progressPercent,
              message: 'Course completed! You can now generate a certificate.',
            });
          }
        }
      } catch (error) {
        console.error('Progress update error:', error);
      }
    });

    // Handle certificate generation
    socket.on('certificateGenerated', async (data: { userId: string; courseId: string; certificateId: string }) => {
      try {
        // Emit to instructor/admin panels
        io.to(`course:${data.courseId}`).emit('certificateIssued', {
          userId: data.userId,
          courseId: data.courseId,
          certificateId: data.certificateId,
        });
      } catch (error) {
        console.error('Certificate generation notification error:', error);
      }
    });

    // Handle lesson updates (from instructor dashboard)
    socket.on('lessonUpdated', async (data: { lessonId: string; courseId: string }) => {
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
    socket.on('quizUpdated', async (data: { lessonId: string }) => {
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

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${user.email}`);
    });
  });

  // Market Signals Emitter (demo Forex signals)
  let signalInterval: NodeJS.Timeout;
  
  const startMarketSignals = () => {
    const symbols = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'];
    const types = ['buy', 'sell'];

    signalInterval = setInterval(() => {
      const signal = {
        symbol: symbols[Math.floor(Math.random() * symbols.length)],
        price: (Math.random() * 2 + 0.5).toFixed(5),
        type: types[Math.floor(Math.random() * types.length)],
        timestamp: new Date().toISOString(),
      };

      // Broadcast to all connected clients
      io.emit('marketSignal', signal);
    }, 3000); // Every 3 seconds
  };

  startMarketSignals();

  return io;
}

