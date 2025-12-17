/**
 * Seed Experts API Route
 * POST: Automatically mark instructors and admins as experts
 * This endpoint ensures experts are available for consultation
 * 
 * FIX: Safe seeding mechanism that prevents duplication
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function seedExperts(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only admins can trigger seeding
    if (req.user!.role !== 'admin' && req.user!.email !== 'madudamian25@gmail.com') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Step 1: Add expert fields to all users (only if missing)
    const addFieldsResult = await users.updateMany(
      { 
        $or: [
          { isExpert: { $exists: false } },
          { expertAvailable: { $exists: false } },
          { consultationSuspended: { $exists: false } }
        ]
      },
      { 
        $set: { 
          isExpert: false,
          expertAvailable: true, // Default to available
          consultationSuspended: false,
        } 
      }
    );

    // Step 2: Mark instructors and admins as experts (only if not already marked)
    const markExpertsResult = await users.updateMany(
      { 
        $or: [
          { role: 'instructor' },
          { role: 'admin' },
          { email: 'madudamian25@gmail.com' } // Super admin
        ],
        isExpert: { $ne: true } // Only update if not already an expert
      },
      { 
        $set: { 
          isExpert: true,
          expertAvailable: true,
        } 
      }
    );

    // Step 3: Ensure consultation collections exist
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    if (!collectionNames.includes('consultationRequests')) {
      await db.createCollection('consultationRequests');
      await db.collection('consultationRequests').createIndex({ studentId: 1 });
      await db.collection('consultationRequests').createIndex({ expertId: 1 });
      await db.collection('consultationRequests').createIndex({ status: 1 });
    }

    if (!collectionNames.includes('consultationSessions')) {
      await db.createCollection('consultationSessions');
      await db.collection('consultationSessions').createIndex({ studentId: 1 });
      await db.collection('consultationSessions').createIndex({ expertId: 1 });
      await db.collection('consultationSessions').createIndex({ status: 1 });
    }

    if (!collectionNames.includes('consultationMessages')) {
      await db.createCollection('consultationMessages');
      await db.collection('consultationMessages').createIndex({ sessionId: 1 });
      await db.collection('consultationMessages').createIndex({ createdAt: 1 });
    }

    // Get count of experts
    const expertCount = await users.countDocuments({ isExpert: true });

    res.json({
      success: true,
      message: 'Experts seeded successfully',
      stats: {
        fieldsAdded: addFieldsResult.modifiedCount,
        expertsMarked: markExpertsResult.modifiedCount,
        totalExperts: expertCount,
      },
    });
  } catch (error: any) {
    console.error('Seed experts error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(seedExperts, ['admin']);




