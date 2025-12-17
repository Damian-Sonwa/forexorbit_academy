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

    if (!action || !['accept', 'reject', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "accept", "reject", or "cancel"' });
    }

    const db = await getDb();
    const requests = db.collection('consultationRequests');
    const sessions = db.collection('consultationSessions');

    // Find the request
    const request = await requests.findOne({ _id: new ObjectId(id) });

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Verify permissions:
    // - Instructors can only accept/reject their own requests
    // - Admins can accept/reject any request
    if (req.user!.role === 'instructor' && request.expertId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only accept/reject requests assigned to you' });
    }

    // Only allow accept/reject on pending requests (unless admin is canceling)
    if (action !== 'cancel' && request.status !== 'pending') {
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

      // Emit socket events to notify both student and instructor
      // CRITICAL: Status update must be broadcast to both parties immediately
      if (req.io) {
        const sessionId = sessionResult.insertedId.toString();
        
        // Emit status update to student - triggers UI update without page refresh
        req.io.to(`user:${request.studentId}`).emit('consultation_status_updated', {
          requestId: id,
          sessionId: sessionId,
          status: 'accepted',
          expertId: request.expertId,
        });
        
        // Also emit legacy event for backward compatibility
        req.io.to(`user:${request.studentId}`).emit('consultationAccepted', {
          requestId: id,
          sessionId: sessionId,
          expertId: request.expertId,
        });
        
        // Notify instructor that request was accepted
        req.io.to(`user:${request.expertId}`).emit('consultation_status_updated', {
          requestId: id,
          sessionId: sessionId,
          status: 'accepted',
          studentId: request.studentId,
        });
        
        // Auto-join both parties to consultation room for immediate communication
        // Room is created automatically by socket.io when first user joins
        req.io.to(`user:${request.studentId}`).emit('join_consultation_room', {
          sessionId: sessionId,
          requestId: id,
        });
        req.io.to(`user:${request.expertId}`).emit('join_consultation_room', {
          sessionId: sessionId,
          requestId: id,
        });
      }

      res.json({
        success: true,
        message: 'Request accepted',
        sessionId: sessionResult.insertedId.toString(),
      });
    } else if (action === 'reject') {
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
    } else if (action === 'cancel') {
      // Cancel request (admin only, can cancel any status)
      if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
        return res.status(403).json({ error: 'Only admins can cancel requests' });
      }

      await requests.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'cancelled', updatedAt: new Date() } }
      );

      // Emit socket event to notify student
      if (req.io) {
        req.io.to(`user:${request.studentId}`).emit('consultationCancelled', {
          requestId: id,
          expertId: request.expertId,
        });
      }

      res.json({
        success: true,
        message: 'Request cancelled',
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








