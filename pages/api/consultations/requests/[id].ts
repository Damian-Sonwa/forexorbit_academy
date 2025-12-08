/**
 * Consultation Request Actions API Route
 * PUT: Accept or reject a consultation request (experts only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function updateRequest(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only experts (instructors/admins) can accept/reject
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only experts can accept or reject requests' });
    }

    const { id } = req.query;
    const { action } = req.body; // 'accept' or 'reject'

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Request ID is required' });
    }

    if (!action || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "accept" or "reject"' });
    }

    const db = await getDb();
    const requests = db.collection('consultationRequests');
    const sessions = db.collection('consultationSessions');

    // Find the request
    const request = await requests.findOne({ _id: new ObjectId(id) });

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Verify the request is for this expert
    if (request.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only accept/reject requests assigned to you' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }

    if (action === 'accept') {
      // Update request status
      await requests.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'accepted', updatedAt: new Date() } }
      );

      // Create consultation session
      const session = {
        requestId: id,
        studentId: request.studentId,
        expertId: request.expertId,
        topic: request.topic,
        consultationType: request.consultationType,
        messages: [],
        startedAt: new Date(),
        endedAt: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const sessionResult = await sessions.insertOne(session);

      // Emit socket event to notify student
      if (req.io) {
        req.io.to(`user:${request.studentId}`).emit('consultationAccepted', {
          requestId: id,
          sessionId: sessionResult.insertedId.toString(),
          expertId: request.expertId,
        });
      }

      res.json({
        success: true,
        message: 'Request accepted',
        sessionId: sessionResult.insertedId.toString(),
      });
    } else {
      // Reject request
      await requests.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'rejected', updatedAt: new Date() } }
      );

      // Emit socket event to notify student
      if (req.io) {
        req.io.to(`user:${request.studentId}`).emit('consultationRejected', {
          requestId: id,
          expertId: request.expertId,
        });
      }

      res.json({
        success: true,
        message: 'Request rejected',
      });
    }
  } catch (error: any) {
    console.error('Update consultation request error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'PUT') {
    return updateRequest(req, res);
  } else {
    res.setHeader('Allow', ['PUT']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});








