import { unexpectedBody } from '@/lib/public-error';
/**
 * Community Rooms API Route
 * GET: Get all rooms for the authenticated user
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { updateLearningLevelIfEligible } from '@/lib/learning-level';
import { communityMember, decideCommunityRoomJoin } from '@/lib/account-access';

async function getRooms(req: AuthRequest, res: NextApiResponse) {
  try {
    // Add error handling for database connection
    let db;
    try {
      db = await getDb();
    } catch {
      console.error(JSON.stringify({ event: 'communityRooms', result: 'failed' }));
      return res.status(500).json(unexpectedBody('api'));
    }
    
    const rooms = db.collection('communityRooms');
    const messages = db.collection('communityMessages');
    const users = db.collection('users');

    // Get user's learning level and onboarding status
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1, studentDetails: 1 } }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const member = communityMember(req.user!.userId, user);
    if (user.role === 'student' && (member.learningLevel || member.tradingLevel) && typeof updateLearningLevelIfEligible === 'function') {
      updateLearningLevelIfEligible(req.user!.userId).catch(() => {
        console.error(JSON.stringify({ event: 'learningLevel', result: 'failed' }));
      });
    }

    // Ensure three community rooms exist and get them
    const roomNames = ['Beginner', 'Intermediate', 'Advanced'];
    const descriptions = {
      'Beginner': 'Perfect for newcomers learning basic concepts, market introductions, and simple analysis.',
      'Intermediate': 'For mid-level traders sharing strategies, chart analysis, and trading setups.',
      'Advanced': 'For experienced traders discussing deep technical analysis, macro news, and advanced strategies.',
    };

    // Ensure all three rooms exist - create if missing
    const userRooms: any[] = [];
    for (const roomName of roomNames) {
      let room = await rooms.findOne({ name: roomName, type: 'global' });
      if (!room) {
        // Create the room if it doesn't exist
        const result = await rooms.insertOne({
          name: roomName,
          description: descriptions[roomName as keyof typeof descriptions],
          type: 'global',
          participants: [],
          avatar: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        room = {
          _id: result.insertedId,
          name: roomName,
          description: descriptions[roomName as keyof typeof descriptions],
          type: 'global',
          participants: [],
          avatar: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      userRooms.push(room);
    }

    // Get last message and unread count for each room
    const roomsWithLastMessage = await Promise.all(
      userRooms.map(async (room) => {
        try {
          // Get last message - handle both string and ObjectId roomId formats
          const roomIdStr = room._id.toString();
          const lastMessage = await messages
            .findOne(
              {
                $or: [
                  { roomId: roomIdStr },
                  { roomId: room._id }
                ]
              },
              { sort: { createdAt: -1 } }
            );

          // Get unread count - handle both string and ObjectId roomId formats
          // seenBy is an array, so we need to check if userId is NOT in the array
          const unreadCount = await messages.countDocuments({
            $and: [
              {
                $or: [
                  { roomId: roomIdStr },
                  { roomId: room._id }
                ]
              },
              { senderId: { $ne: req.user!.userId } },
              {
                $or: [
                  { seenBy: { $exists: false } },
                  { seenBy: { $nin: [req.user!.userId] } }
                ]
              }
            ]
          });

          const access = decideCommunityRoomJoin({
            user: member,
            roomId: roomIdStr,
            room: { _id: room._id, name: room.name, type: room.type, participants: room.participants },
          });
          const isLocked = !access.ok;
          
          return {
            _id: roomIdStr,
            name: room.name,
            description: room.description || descriptions[room.name as keyof typeof descriptions] || '',
            type: room.type,
            participants: room.participants || [],
            avatar: room.avatar || null,
            lastMessage: isLocked ? null : (lastMessage
              ? {
                  _id: lastMessage._id.toString(),
                  content: lastMessage.content,
                  type: lastMessage.type,
                  createdAt: lastMessage.createdAt,
                }
              : null),
            unreadCount: isLocked ? 0 : unreadCount,
            isLocked, // Add locked status
          };
        } catch {
          console.error(JSON.stringify({ event: 'communityRoom', result: 'failed' }));
          return {
            _id: room._id.toString(),
            name: room.name,
            description: room.description || descriptions[room.name as keyof typeof descriptions] || '',
            type: room.type,
            participants: [],
            avatar: room.avatar || null,
            lastMessage: null,
            unreadCount: 0,
            isLocked: true,
          };
        }
      })
    );

    // Ensure we always return exactly 3 rooms
    // If rooms are missing, log error but don't create placeholders
    // Rooms should be seeded via seed script
    if (roomsWithLastMessage.length < 3) {
      console.error(`Only ${roomsWithLastMessage.length} rooms returned, expected 3. Please run seed script to create rooms.`);
      // Don't create placeholders - return what we have
      // This will force the frontend to show an error or retry
    }

    res.json(roomsWithLastMessage);
  } catch {
    console.error(JSON.stringify({ event: 'communityRooms', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(getRooms);

