/**
 * Consultation Requests API Route
 * GET: Get consultation requests (for students: their requests, for experts: pending requests)
 * POST: Create a new consultation request (students only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getRequests(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const requests = db.collection('consultationRequests');
    const users = db.collection('users');

    if (req.user!.role === 'student') {
      // Students see their own requests
      const userRequests = await requests
        .find({ studentId: req.user!.userId })
        .sort({ createdAt: -1 })
        .toArray();

      // Populate expert info
      const requestsWithExpert = await Promise.all(
        userRequests.map(async (request) => {
          const expert = await users.findOne(
            { _id: new ObjectId(request.expertId) },
            { projection: { name: 1, email: 1, profilePhoto: 1, isExpert: 1, expertAvailable: 1 } }
          );
          return {
            ...request,
            _id: request._id.toString(),
            expert: expert ? {
              _id: expert._id.toString(),
              name: expert.name,
              email: expert.email,
              profilePhoto: expert.profilePhoto,
              isExpert: expert.isExpert,
              expertAvailable: expert.expertAvailable,
            } : null,
          };
        })
      );

      res.json(requestsWithExpert);
    } else if (req.user!.role === 'instructor' || req.user!.role === 'admin' || req.user!.role === 'superadmin') {
      // Experts see pending requests for them
      const expertRequests = await requests
        .find({ 
          expertId: req.user!.userId,
          status: 'pending'
        })
        .sort({ createdAt: -1 })
        .toArray();

      // Populate student info
      const requestsWithStudent = await Promise.all(
        expertRequests.map(async (request) => {
          const student = await users.findOne(
            { _id: new ObjectId(request.studentId) },
            { projection: { name: 1, email: 1, profilePhoto: 1 } }
          );
          return {
            ...request,
            _id: request._id.toString(),
            student: student ? {
              _id: student._id.toString(),
              name: student.name,
              email: student.email,
              profilePhoto: student.profilePhoto,
            } : null,
          };
        })
      );

      res.json(requestsWithStudent);
    } else {
      res.status(403).json({ error: 'Access denied' });
    }
  } catch (error: any) {
    console.error('Get consultation requests error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function createRequest(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can create requests
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can create consultation requests' });
    }

    const { expertId, topic, description, consultationType } = req.body;

    if (!expertId || !topic || !description) {
      return res.status(400).json({ error: 'Expert ID, topic, and description are required' });
    }

    const db = await getDb();
    const requests = db.collection('consultationRequests');
    const users = db.collection('users');

    // Check if expert exists and is available
    const expert = await users.findOne(
      { _id: new ObjectId(expertId) },
      { projection: { isExpert: 1, expertAvailable: 1, role: 1 } }
    );

    if (!expert) {
      return res.status(404).json({ error: 'Expert not found' });
    }

    if (!expert.isExpert) {
      return res.status(400).json({ error: 'Selected user is not an expert' });
    }

    if (expert.expertAvailable === false) {
      return res.status(400).json({ error: 'Expert is currently unavailable for consultations' });
    }

    // Check if consultation feature is enabled (check super admin settings)
    const superAdmin = await users.findOne(
      { email: 'madudamian25@gmail.com', role: 'superadmin' },
      { projection: { consultationEnabled: 1 } }
    );

    if (superAdmin?.consultationEnabled === false) {
      return res.status(400).json({ error: 'Consultation feature is currently disabled' });
    }

    const request = {
      studentId: req.user!.userId,
      expertId,
      topic,
      description,
      consultationType: consultationType || 'live-chat',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await requests.insertOne(request);

    res.json({
      success: true,
      request: {
        ...request,
        _id: result.insertedId.toString(),
      },
    });
  } catch (error: any) {
    console.error('Create consultation request error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getRequests(req, res);
  } else if (req.method === 'POST') {
    return createRequest(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});





