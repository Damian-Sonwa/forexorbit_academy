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
    // Add error handling for database connection
    let db;
    try {
      db = await getDb();
    } catch (dbError: any) {
      console.error('Database connection error:', dbError);
      return res.status(500).json({ 
        error: 'Database connection failed',
        details: process.env.NODE_ENV === 'development' ? dbError.message : 'Please check server logs'
      });
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
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if student has completed onboarding
    const hasCompletedOnboarding = user.role !== 'student' || 
      (user.studentDetails && user.studentDetails.completedAt);

    // Determine user's learning level
    // CRITICAL: Use tradingLevel from onboarding if learningLevel is not set
    let userLevel: 'beginner' | 'intermediate' | 'advanced' = 'beginner';
    if (user?.role !== 'student') {
      // Instructors, admins, and super admins have access to all levels
      userLevel = 'advanced';
    } else {
      // Students must complete onboarding before accessing any room
      if (!hasCompletedOnboarding) {
        // Return empty rooms array with a message
        return res.json([]);
      }
      // Use learningLevel if set, otherwise fall back to tradingLevel from onboarding
      userLevel = (user?.learningLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  (user?.studentDetails?.tradingLevel as 'beginner' | 'intermediate' | 'advanced') || 
                  'beginner';
      // Check and update level if eligible (async, doesn't block) - wrap in try-catch to prevent errors
      // Only call if function exists (defensive check)
      if (typeof updateLearningLevelIfEligible === 'function') {
        updateLearningLevelIfEligible(req.user!.userId).catch((err) => {
          console.error('Error updating learning level (non-blocking):', err);
        });
      }
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
    // If rooms are missing, log error but don't create placeholders
    // Rooms should be seeded via seed script
    if (roomsWithLastMessage.length < 3) {
      console.error(`Only ${roomsWithLastMessage.length} rooms returned, expected 3. Please run seed script to create rooms.`);
      // Don't create placeholders - return what we have
      // This will force the frontend to show an error or retry
    }

    res.json(roomsWithLastMessage);
  } catch (error: any) {
    console.error('Get rooms error:', error);
    console.error('Error stack:', error.stack);
    // Don't return placeholder rooms - return error instead
    // This forces proper error handling on frontend
    res.status(500).json({ 
      error: 'Failed to load rooms. Please ensure rooms are seeded in the database.',
      details: error.message 
    });
  }
}

export default withAuth(getRooms);

