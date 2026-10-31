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
const { readSessionCookie, resolveSession } = require('./lib/session-core');
const { appOriginConfig, decideSocketOrigin, trustedOrigins } = require('./lib/request-guard');
const { registerSessionSocketServer } = require('./lib/session-sockets');
const {
  decideAccountAccess,
  decideCommunityRoomJoin,
  decideCommunityTyping,
  decideConsultationTyping,
  decideLessonRoomAccess,
  decideLessonChat,
  decideLessonStaffNotify,
  decideProgressUpdate,
  decideCommunityPresence,
  presenceOfflineTargets,
  canJoinConsultation,
} = require('./lib/account-access');
const { recordLessonCompletion } = require('./lib/course-progress');

// Validate environment variables (same URI as Next API: .env.local)
const mongoUri = (process.env.MONGO_URI || process.env.MONGODB_URI)?.trim();
if (!mongoUri) {
  console.error('❌ Error: MONGO_URI or MONGODB_URI not defined (e.g. in .env.local)');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('❌ Error: JWT_SECRET not defined in .env.local');
  process.exit(1);
}

// Log AI configuration status (without exposing the key)
if (process.env.AI_API_KEY) {
  console.log('AI API key is configured');
} else {
  console.warn('AI API key is not configured. AI features will be disabled.');
}

// Cookie sessions need the one canonical HTTPS origin (lib/request-guard.js). Refuse to start in
// production without it, rather than accept or refuse requests from unknown origins.
const appOrigin = appOriginConfig(process.env);
if (!appOrigin.ok) {
  console.error(`❌ Error: ${appOrigin.error}`);
  process.exit(1);
}

const dev = process.env.NODE_ENV !== 'production';
// Use 0.0.0.0 for production (allows external connections) or localhost for dev
const hostname = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  console.log('✓ Next.js app prepared');
  
  // Room seeding hits Mongo and must not delay the port becoming ready.
  try {
    const { seedRooms } = require('./scripts/seed-rooms');
    seedRooms()
      .then(() => console.log('✓ Community rooms seeded'))
      .catch(() => console.warn('Failed to seed rooms'));
  } catch (error) {
    console.warn('Failed to seed rooms');
  }
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling request');
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Pages, API and sockets share one canonical origin (APP_ORIGIN). Only that exact origin (and,
  // outside production, the local dev server) may open a socket: the session cookie travels with
  // the handshake, so a foreign page must never be able to open one (cross-site WebSocket hijacking).
  const allowedOrigins = trustedOrigins(process.env);

  // Canonical Socket.IO server. The package scripts start this file.
  // A Next.js API route must not attach another server.
  const io = new Server(server, {
    path: '/api/socket',
    allowRequest: (req, callback) => {
      const decision = decideSocketOrigin({ header: (name) => req.headers[name] });
      if (!decision.ok) console.warn(JSON.stringify({ event: 'socketOrigin', result: 'refused', code: decision.code }));
      callback(null, decision.ok);
    },
    cors: {
      origin: allowedOrigins,
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
  // Lets API routes disconnect the sockets of a session they end (lib/session-sockets.js).
  registerSessionSocketServer(io);

  // Sockets authenticate with the same HttpOnly session cookie as HTTP (lib/session-core.js). The
  // id is never rotated over a socket (no cookie can be set there); HTTP requests rotate it.
  const SOCKET_SESSION_RECHECK_MS = 30 * 1000;
  async function checkSocketSession(socket) {
    const { getDb } = require('./lib/mongodb');
    const result = await resolveSession(await getDb(), socket.data.sessionToken, { rotate: false });
    socket.data.sessionCheckedAt = Date.now();
    return result;
  }
  function endSocketSession(socket) {
    socket.emit('session_ended');
    socket.disconnect(true);
  }

  io.use(async (socket, next) => {
    try {
      const token = readSessionCookie(socket.handshake.headers.cookie);
      if (!token) {
        return next(new Error('Authentication error'));
      }
      socket.data.sessionToken = token;
      const result = await checkSocketSession(socket);
      if (!result.ok) {
        return next(new Error('Authentication error'));
      }
      socket.data.user = result.user;
      socket.data.sessionFamilyId = result.session.familyId;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  // An ended session (sign-out, expiry, revocation, suspension) also ends its sockets: checked
  // before an incoming event when the last check is older than the recheck interval, and for every
  // socket on a timer, so a revocation made by another server instance still takes effect.
  io.on('connection', (socket) => {
    socket.use((packet, next) => {
      if (Date.now() - (socket.data.sessionCheckedAt || 0) < SOCKET_SESSION_RECHECK_MS) return next();
      checkSocketSession(socket)
        .then((result) => {
          if (result.ok) return next();
          endSocketSession(socket);
          return next(new Error('Authentication error'));
        })
        .catch(() => next(new Error('Authentication error')));
    });
  });
  // The sweep re-checks every socket on each tick, so an expiry or a revocation made elsewhere
  // ends a quiet socket within one interval.
  setInterval(async () => {
    for (const socket of io.of('/').sockets.values()) {
      try {
        const result = await checkSocketSession(socket);
        if (!result.ok) endSocketSession(socket);
      } catch {
        // A failed lookup is retried on the next sweep or event.
      }
    }
  }, SOCKET_SESSION_RECHECK_MS).unref();

  // Socket.io connection handler
  io.on('connection', async (socket) => {
    const user = socket.data.user;
    console.log('User connected');
    
    // Join user's personal room for targeted notifications
    socket.join(`user:${user.userId}`);
    console.log(`User joined personal notification room: user:${user.userId}`);
    socket.on('subscribeMarketSignals', () => {
      socket.join('market-signals');
    });
    socket.on('unsubscribeMarketSignals', () => {
      socket.leave('market-signals');
    });

    async function loadLessonContext(lessonId) {
      try {
        const { getDb } = require('./lib/mongodb');
        const { ObjectId } = require('mongodb');
        if (typeof lessonId !== 'string' || !ObjectId.isValid(lessonId)) {
          return { member: null, lesson: null, course: null, enrollment: null };
        }
        const db = await getDb();
        const record = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1, name: 1 } }
        );
        const account = decideAccountAccess({ userId: user.userId, record });
        const lesson = await db.collection('lessons').findOne(
          { _id: new ObjectId(lessonId) },
          { projection: { courseId: 1, requiredLevel: 1 } }
        );
        let course = null;
        let enrollment = null;
        if (lesson && lesson.courseId != null && ObjectId.isValid(String(lesson.courseId))) {
          course = await db.collection('courses').findOne(
            { _id: new ObjectId(String(lesson.courseId)) },
            // status: students may use a lesson room only in a published or archived course.
            { projection: { instructorId: 1, difficulty: 1, status: 1 } }
          );
          if (account.ok && course) {
            const courseId = String(course._id);
            enrollment = await db.collection('progress').findOne({
              userId: account.user.userId,
              $or: [{ courseId }, { courseId: course._id }],
            });
          }
        }
        return {
          member: account.ok ? {
            userId: account.user.userId,
            role: account.user.role,
            email: account.user.email,
            name: record && typeof record.name === 'string' ? record.name : '',
          } : null,
          lesson,
          course,
          enrollment,
        };
      } catch {
        console.error(JSON.stringify({ event: 'lessonAccess', result: 'lookup_failed' }));
        return { lookupError: true };
      }
    }

    function lessonAccessDecision(loaded) {
      return decideLessonRoomAccess({
        member: loaded.member,
        lesson: loaded.lesson,
        course: loaded.course,
        enrollment: loaded.enrollment,
        lookupError: Boolean(loaded.lookupError),
      });
    }

    // Drop sockets whose enrollment or account is no longer valid before a lesson event is sent.
    async function dropUnauthorizedLessonMembers(channel, lesson, course) {
      const sockets = await io.in(channel).fetchSockets();
      const { getDb } = require('./lib/mongodb');
      const { ObjectId } = require('mongodb');
      const db = await getDb();
      const decisions = new Map();
      for (const memberSocket of sockets) {
        const socketUser = memberSocket.data && memberSocket.data.user;
        const userId = socketUser && socketUser.userId;
        if (!userId || !ObjectId.isValid(String(userId))) {
          memberSocket.leave(channel);
          continue;
        }
        if (!decisions.has(String(userId))) {
          try {
            const record = await db.collection('users').findOne(
              { _id: new ObjectId(String(userId)) },
              { projection: { email: 1, role: 1, status: 1 } }
            );
            const account = decideAccountAccess({ userId: String(userId), record });
            let enrollment = null;
            if (account.ok && account.user.role === 'student' && course && course._id != null) {
              const courseId = String(course._id);
              enrollment = await db.collection('progress').findOne({
                userId: account.user.userId,
                $or: [{ courseId }, { courseId: course._id }],
              });
            }
            decisions.set(String(userId), decideLessonRoomAccess({
              member: account.ok ? account.user : null,
              lesson,
              course,
              enrollment,
            }));
          } catch {
            memberSocket.leave(channel);
            continue;
          }
        }
        const decision = decisions.get(String(userId));
        if (!decision || !decision.ok) memberSocket.leave(channel);
      }
    }

    // Join lesson room only after the current account can access the stored lesson.
    socket.on('joinLesson', async (lessonId) => {
      const loaded = await loadLessonContext(lessonId);
      const decision = lessonAccessDecision(loaded);
      if (loaded.lesson && loaded.lesson._id != null && !decision.ok) {
        socket.leave(`lesson:${String(loaded.lesson._id)}`);
      }
      if (!decision.ok) return;
      socket.join(decision.lessonChannel);
    });

    // Leave the stored lesson room. A client id is not a room name.
    socket.on('leaveLesson', async (lessonId) => {
      const loaded = await loadLessonContext(lessonId);
      if (loaded.lookupError || !loaded.lesson || loaded.lesson._id == null) return;
      const channel = `lesson:${String(loaded.lesson._id)}`;
      if (socket.rooms.has(channel)) socket.leave(channel);
    });

    // Lesson chat. Sender name and id come from the reloaded account.
    socket.on('chatMessage', async (data) => {
      const lessonId = data && typeof data.lessonId === 'string' ? data.lessonId : '';
      const text = data && typeof data.text === 'string' ? data.text : '';
      try {
        const loaded = await loadLessonContext(lessonId);
        const decision = decideLessonChat({
          member: loaded.member,
          lesson: loaded.lesson,
          course: loaded.course,
          enrollment: loaded.enrollment,
          text,
          lookupError: Boolean(loaded.lookupError),
        });
        if (!decision.ok) return;
        await dropUnauthorizedLessonMembers(decision.channel, loaded.lesson, loaded.course);

        const { getDb } = require('./lib/mongodb');
        const db = await getDb();
        const createdAt = new Date();
        const result = await db.collection('messages').insertOne({
          lessonId: decision.lessonId,
          userId: decision.sender.userId,
          senderName: decision.sender.senderName,
          text: decision.text,
          createdAt,
        });

        io.to(decision.channel).emit('chatMessage', {
          id: result.insertedId.toString(),
          lessonId: decision.lessonId,
          userId: decision.sender.userId,
          senderName: decision.sender.senderName,
          text: decision.text,
          createdAt,
        });
      } catch {
        console.error(JSON.stringify({ event: 'chatMessage', result: 'failed' }));
      }
    });

    // Student progress. The stored lesson and the existing enrollment choose the record.
    socket.on('progressUpdate', async (data) => {
      const courseId = data && typeof data.courseId === 'string' ? data.courseId : '';
      const lessonId = data && typeof data.lessonId === 'string' ? data.lessonId : '';
      try {
        const { getDb } = require('./lib/mongodb');
        const { ObjectId } = require('mongodb');
        if (!ObjectId.isValid(courseId) || !ObjectId.isValid(lessonId)) return;
        const db = await getDb();
        const record = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1 } }
        );
        const account = decideAccountAccess({ userId: user.userId, record });
        const course = await db.collection('courses').findOne(
          { _id: new ObjectId(courseId) },
          { projection: { instructorId: 1, status: 1 } }
        );
        const lesson = await db.collection('lessons').findOne(
          { _id: new ObjectId(lessonId) },
          { projection: { courseId: 1 } }
        );
        let enrollment = null;
        if (account.ok && course) {
          enrollment = await db.collection('progress').findOne({
            userId: account.user.userId,
            $or: [{ courseId: String(course._id) }, { courseId: course._id }],
          });
        }
        const decision = decideProgressUpdate({
          member: account.ok ? account.user : null,
          course,
          lesson,
          enrollment,
        });
        if (!decision.ok) return;

        // Same rule as the HTTP route (lib/course-progress.js): atomic, current lessons only, max 100.
        const recorded = await recordLessonCompletion(db, {
          userId: decision.userId,
          courseId: decision.courseId,
          lessonId: decision.lessonId,
        });
        if (!recorded) return;
        socket.emit('progressUpdated', {
          courseId: decision.courseId,
          progress: recorded.progress,
        });
      } catch {
        console.error(JSON.stringify({ event: 'progressUpdate', result: 'failed' }));
      }
    });

    // Client-originated refresh notices from instructor and admin screens.
    // The stored lesson and course ids choose the rooms.
    socket.on('lessonUpdated', async (data) => {
      const lessonId = data && typeof data.lessonId === 'string' ? data.lessonId : '';
      try {
        const loaded = await loadLessonContext(lessonId);
        const decision = decideLessonStaffNotify({
          member: loaded.member,
          lesson: loaded.lesson,
          course: loaded.course,
          lookupError: Boolean(loaded.lookupError),
        });
        if (!decision.ok) return;
        await dropUnauthorizedLessonMembers(decision.lessonChannel, loaded.lesson, loaded.course);
        await dropUnauthorizedLessonMembers(decision.courseChannel, loaded.lesson, loaded.course);
        const payload = { lessonId: decision.lessonId, courseId: decision.courseId };
        io.to(decision.courseChannel).emit('lessonUpdated', payload);
        io.to(decision.lessonChannel).emit('lessonUpdated', payload);
      } catch {
        console.error(JSON.stringify({ event: 'lessonUpdated', result: 'failed' }));
      }
    });

    // Client-originated quiz refresh. Students cannot emit it.
    socket.on('quizUpdated', async (data) => {
      const lessonId = data && typeof data.lessonId === 'string' ? data.lessonId : '';
      try {
        const loaded = await loadLessonContext(lessonId);
        const decision = decideLessonStaffNotify({
          member: loaded.member,
          lesson: loaded.lesson,
          course: loaded.course,
          lookupError: Boolean(loaded.lookupError),
        });
        if (!decision.ok) return;
        await dropUnauthorizedLessonMembers(decision.lessonChannel, loaded.lesson, loaded.course);
        io.to(decision.lessonChannel).emit('quizUpdated', {
          lessonId: decision.lessonId,
        });
      } catch {
        console.error(JSON.stringify({ event: 'quizUpdated', result: 'failed' }));
      }
    });

    // Community rooms. Level-gated rooms require a successful database lookup.
    // community_global is the shared public socket room and does not use that lookup.
    socket.on('joinRoom', async (data) => {
      const roomId = data && typeof data.roomId === 'string' ? data.roomId : '';
      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      if (roomId === 'community_global') {
        const decision = decideCommunityRoomJoin({ user, roomId });
        if (!decision.ok) {
          socket.emit('error', { message: decision.error });
          return;
        }
        socket.join('room:community_global');
        socket.emit('room_joined', { roomId: 'community_global', roomName: 'community_global' });
        return;
      }

      try {
        const { getDb } = require('./lib/mongodb.js');
        const { ObjectId } = require('mongodb');
        const db = await getDb();
        const identity = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1, learningLevel: 1, studentDetails: 1 } }
        );
        const access = decideAccountAccess({ userId: user.userId, record: identity });
        if (!access.ok) {
          socket.emit('error', { message: 'Account is not active' });
          return;
        }

        const rooms = db.collection('communityRooms');
        const room = /^[0-9a-fA-F]{24}$/.test(roomId)
          ? await rooms.findOne({ _id: new ObjectId(roomId), type: 'global' })
          : await rooms.findOne({
              $or: [{ _id: roomId }, { name: roomId }, { slug: roomId }],
              type: 'global',
            });
        const decision = decideCommunityRoomJoin({
          user: {
            userId: access.user.userId,
            role: access.user.role,
            learningLevel: identity && identity.learningLevel,
            tradingLevel: identity && identity.studentDetails && identity.studentDetails.tradingLevel,
          },
          roomId,
          room,
        });
        if (!decision.ok) {
          socket.emit('error', { message: decision.error });
          return;
        }

        socket.join(`room:${decision.roomId}`);
        socket.emit('room_joined', { roomId: decision.roomId, roomName: decision.roomName });
        socket.to(`room:${decision.roomId}`).emit('userJoined', {
          userId: access.user.userId,
          userName: access.user.email,
          roomId: decision.roomId,
        });
      } catch (error) {
        console.error('Community room join lookup failed');
        const decision = decideCommunityRoomJoin({ user, roomId, lookupError: true });
        socket.emit('error', { message: decision.error });
      }
    });

    async function authorizeCommunityTyping(roomId) {
      try {
        const { getDb } = require('./lib/mongodb.js');
        const { ObjectId } = require('mongodb');
        const db = await getDb();
        const identity = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1, learningLevel: 1, studentDetails: 1 } }
        );
        const access = decideAccountAccess({ userId: user.userId, record: identity });
        let room = null;
        if (access.ok && roomId && roomId !== 'community_global') {
          const rooms = db.collection('communityRooms');
          room = /^[0-9a-fA-F]{24}$/.test(roomId)
            ? await rooms.findOne({ _id: new ObjectId(roomId), type: 'global' })
            : await rooms.findOne({
                $or: [{ _id: roomId }, { name: roomId }, { slug: roomId }],
                type: 'global',
              });
        }
        return decideCommunityTyping({
          member: access.ok ? {
            userId: access.user.userId,
            role: access.user.role,
            email: access.user.email,
            learningLevel: identity && identity.learningLevel,
            tradingLevel: identity && identity.studentDetails && identity.studentDetails.tradingLevel,
          } : null,
          roomId,
          room,
        });
      } catch {
        console.error('Typing authorization lookup failed');
        return decideCommunityTyping({ roomId, lookupError: true });
      }
    }

    async function authorizeConsultationTyping(sessionId) {
      try {
        const { getDb } = require('./lib/mongodb');
        const { ObjectId } = require('mongodb');
        if (!sessionId || !ObjectId.isValid(sessionId)) {
          return decideConsultationTyping({ member: null, session: null });
        }
        const db = await getDb();
        const record = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1 } }
        );
        const access = decideAccountAccess({ userId: user.userId, record });
        const session = await db.collection('consultationSessions').findOne({ _id: new ObjectId(sessionId) });
        return decideConsultationTyping({
          member: access.ok ? access.user : null,
          session,
        });
      } catch {
        console.error('Consultation typing authorization lookup failed');
        return decideConsultationTyping({ lookupError: true });
      }
    }

    socket.on('leaveRoom', async (data) => {
      const roomId = data && typeof data.roomId === 'string' ? data.roomId : '';
      const decision = await authorizeCommunityTyping(roomId);
      if (!decision.ok || !socket.rooms.has(decision.channel)) return;
      socket.leave(decision.channel);
      socket.to(decision.channel).emit('userLeft', {
        userId: decision.user.userId,
        roomId: decision.roomId,
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

      try {
        const { getDb } = require('./lib/mongodb');
        const { ObjectId } = require('mongodb');
        const db = await getDb();
        const record = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1 } }
        );
        const decision = decideAccountAccess({ userId: user.userId, record });
        const session = await db.collection('consultationSessions').findOne({ _id: new ObjectId(sessionId) });
        if (!session || !decision.ok || !canJoinConsultation(decision.user, session)) {
          console.warn(`User ${user.userId} cannot join consultation ${sessionId}`);
          return;
        }

        socket.join(`consultation:${sessionId}`);
        socket.emit('consultation_room_joined', { sessionId });

        const otherUserId = decision.user.role === 'student' ? session.expertId : session.studentId;
        io.to(`user:${otherUserId}`).emit('consultationUserJoined', {
          sessionId,
          userId: user.userId,
        });
      } catch (error) {
        console.error('Error validating consultation access');
      }
    });

    // Auto-join consultation room when request is accepted
    // This ensures both parties are immediately connected for communication
    socket.on('join_consultation_room', async (data) => {
      const { sessionId } = data;
      if (!sessionId) {
        console.warn('join_consultation_room called without sessionId');
        return;
      }

      try {
        const { getDb } = require('./lib/mongodb');
        const { ObjectId } = require('mongodb');
        const db = await getDb();
        const record = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1 } }
        );
        const decision = decideAccountAccess({ userId: user.userId, record });
        const session = await db.collection('consultationSessions').findOne({ _id: new ObjectId(sessionId) });
        if (!decision.ok || !canJoinConsultation(decision.user, session)) {
          console.warn(`User ${user.userId} cannot auto-join consultation ${sessionId}`);
          return;
        }
      } catch (error) {
        console.error('Error validating consultation auto-join');
        return;
      }

      socket.join(`consultation:${sessionId}`);
      console.log(`User auto-joined consultation room: ${sessionId}`);
      socket.emit('consultation_room_joined', { sessionId });
    });

    socket.on('leaveConsultation', (data) => {
      const { sessionId } = data;
      if (sessionId) {
        socket.leave(`consultation:${sessionId}`);
        console.log(`User left consultation ${sessionId}`);
      }
    });

    // WebRTC signaling removed - replaced with Agora SDK

    socket.on('typing', async (data) => {
      const roomId = data && typeof data.roomId === 'string' ? data.roomId : '';
      const decision = await authorizeCommunityTyping(roomId);
      if (!decision.ok) return;
      socket.to(decision.channel).emit('typing', {
        roomId: decision.roomId,
        userId: decision.user.userId,
        userName: decision.user.email,
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

        const record = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1 } }
        );
        const decision = decideAccountAccess({ userId: user.userId, record });
        const session = await sessions.findOne({ _id: new ObjectId(sessionId) });
        if (!decision.ok) {
          socket.emit('error', { message: 'Account is not active' });
          return;
        }
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        if (!canJoinConsultation(decision.user, session)) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Join user-specific room and session room
        socket.join(`user:${user.userId}`);
        socket.join(`consultation:${sessionId}`);
        console.log(`User joined consultation ${sessionId}`);
      } catch (error) {
        console.error('Error joining consultation');
        socket.emit('error', { message: 'Failed to join consultation' });
      }
    });

    socket.on('leaveConsultation', (data) => {
      const { sessionId } = data;
      socket.leave(`consultation:${sessionId}`);
      console.log(`User left consultation ${sessionId}`);
    });

    socket.on('consultationTyping', async (data) => {
      const sessionId = data && typeof data.sessionId === 'string' ? data.sessionId : '';
      const decision = await authorizeConsultationTyping(sessionId);
      if (!decision.ok) return;
      socket.to(decision.channel).emit('consultationTyping', {
        sessionId: decision.sessionId,
        userId: decision.user.userId,
        userName: decision.user.email,
      });
    });

    socket.on('consultationStopTyping', async (data) => {
      const sessionId = data && typeof data.sessionId === 'string' ? data.sessionId : '';
      const decision = await authorizeConsultationTyping(sessionId);
      if (!decision.ok) return;
      socket.to(decision.channel).emit('consultationStopTyping', {
        sessionId: decision.sessionId,
        userId: decision.user.userId,
      });
    });

    socket.on('stopTyping', async (data) => {
      const roomId = data && typeof data.roomId === 'string' ? data.roomId : '';
      const decision = await authorizeCommunityTyping(roomId);
      if (!decision.ok) return;
      socket.to(decision.channel).emit('stopTyping', {
        roomId: decision.roomId,
        userId: decision.user.userId,
      });
    });

    // Community presence is limited to the learning-level rooms this account may open.
    // Students hear one level. Staff hear every level room. The event payload is only a user id.
    socket.on('userOnline', async () => {
      try {
        const { getDb } = require('./lib/mongodb.js');
        const { ObjectId } = require('mongodb');
        const db = await getDb();
        const identity = await db.collection('users').findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { email: 1, role: 1, status: 1, learningLevel: 1, studentDetails: 1 } }
        );
        const access = decideAccountAccess({ userId: user.userId, record: identity });
        const rooms = access.ok
          ? await db.collection('communityRooms').find(
              { type: 'global' },
              { projection: { name: 1 } }
            ).toArray()
          : [];
        const decision = decideCommunityPresence({
          member: access.ok ? {
            userId: access.user.userId,
            role: access.user.role,
            learningLevel: identity && identity.learningLevel,
            tradingLevel: identity && identity.studentDetails && identity.studentDetails.tradingLevel,
          } : null,
          rooms,
        });
        if (!decision.ok) return;
        for (const channel of decision.channels) {
          socket.join(channel);
          socket.to(channel).emit('userOnline', { userId: decision.userId });
        }
      } catch {
        console.error(JSON.stringify({ event: 'userOnline', result: 'lookup_failed' }));
      }
    });

    socket.on('disconnecting', () => {
      for (const room of presenceOfflineTargets(socket.rooms)) {
        socket.to(room).emit('userOffline', {
          userId: user.userId,
          lastSeen: new Date().toISOString(),
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected');
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
    io.to('market-signals').emit('marketSignal', signal);
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
    console.log(`  ✓ Database: ${process.env.MONGODB_DB_NAME?.trim() || 'Forex_elearning'}`);
    console.log(`  ✓ Socket.io: Running on ${serverUrl}/api/socket`);
    console.log(`  ✓ Port: ${port}`);
    console.log(`  ✓ Hostname: ${hostname}`);
    console.log(`  ✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  ✓ Trusted origins: ${allowedOrigins.join(', ') || 'none (APP_ORIGIN not set)'}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
  });
}).catch((err) => {
  console.error('Failed to prepare Next.js app');
  process.exit(1);
});

