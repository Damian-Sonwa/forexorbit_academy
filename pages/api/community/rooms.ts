/**
 * Community Rooms API Route
 * GET: Get all rooms for the authenticated user
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { canAccessRoom, updateLearningLevelIfEligible } from '@/lib/learning-level';

async function getRooms(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const rooms = db.collection('communityRooms');
    const messages = db.collection('communityMessages');
    const users = db.collection('users');

    // Get user's learning level
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, role: 1 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Determine user's learning level
    let userLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    if (user?.role !== 'student') {
      // Instructors, admins, and super admins have access to all levels
      userLevel = 'advanced';
    } else {
      userLevel = (user?.learningLevel as 'beginner' | 'intermediate' | 'advanced') || 'beginner';
      // Check and update level if eligible (async, doesn't block) - wrap in try-catch to prevent errors
      updateLearningLevelIfEligible(req.user!.userId).catch((err) => {
        console.error('Error updating learning level (non-blocking):', err);
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

          // For students, check if room is locked. For instructors/admins, always unlocked.
          let isLocked = false;
          try {
            isLocked = user?.role === 'student' ? !canAccessRoom(userLevel, room.name) : false;
          } catch (err) {
            console.error('Error checking room access:', err);
            isLocked = false; // Default to unlocked on error
          }
          
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
        } catch (roomError) {
          console.error(`Error processing room ${room._id}:`, roomError);
          // Return a basic room object even if there's an error
          return {
            _id: room._id.toString(),
            name: room.name,
            description: room.description || descriptions[room.name as keyof typeof descriptions] || '',
            type: room.type,
            participants: room.participants || [],
            avatar: room.avatar || null,
            lastMessage: null,
            unreadCount: 0,
            isLocked: false,
          };
        }
      })
    );

    // Ensure we always return exactly 3 rooms
    if (roomsWithLastMessage.length < 3) {
      console.warn(`Only ${roomsWithLastMessage.length} rooms returned, expected 3`);
      // Add missing rooms as placeholders
      const roomNames = ['Beginner', 'Intermediate', 'Advanced'];
      const descriptions = {
        'Beginner': 'Perfect for newcomers learning basic concepts, market introductions, and simple analysis.',
        'Intermediate': 'For mid-level traders sharing strategies, chart analysis, and trading setups.',
        'Advanced': 'For experienced traders discussing deep technical analysis, macro news, and advanced strategies.',
      };
      
      for (const roomName of roomNames) {
        if (!roomsWithLastMessage.find((r) => r.name === roomName)) {
          roomsWithLastMessage.push({
            _id: `placeholder-${roomName}`,
            name: roomName,
            description: descriptions[roomName as keyof typeof descriptions],
            type: 'global',
            participants: [],
            avatar: null,
            lastMessage: null,
            unreadCount: 0,
            isLocked: false,
          });
        }
      }
      // Sort to ensure consistent order
      roomsWithLastMessage.sort((a, b) => {
        const order = ['Beginner', 'Intermediate', 'Advanced'];
        return order.indexOf(a.name) - order.indexOf(b.name);
      });
    }

    res.json(roomsWithLastMessage);
  } catch (error: any) {
    console.error('Get rooms error:', error);
    console.error('Error stack:', error.stack);
    // Return placeholder rooms instead of empty array to prevent blank page
    const roomNames = ['Beginner', 'Intermediate', 'Advanced'];
    const descriptions = {
      'Beginner': 'Perfect for newcomers learning basic concepts, market introductions, and simple analysis.',
      'Intermediate': 'For mid-level traders sharing strategies, chart analysis, and trading setups.',
      'Advanced': 'For experienced traders discussing deep technical analysis, macro news, and advanced strategies.',
    };
    const placeholderRooms = roomNames.map((name) => ({
      _id: `placeholder-${name}`,
      name,
      description: descriptions[name as keyof typeof descriptions],
      type: 'global' as const,
      participants: [],
      avatar: null,
      lastMessage: null,
      unreadCount: 0,
      isLocked: false,
    }));
    res.status(200).json(placeholderRooms);
  }
}

export default withAuth(getRooms);

