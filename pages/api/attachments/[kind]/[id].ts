/**
 * GET /api/attachments/consultation/<messageId> | /api/attachments/community/<messageId>
 * Opens a chat attachment (Phase 15). The reader must be a participant of the consultation, or a
 * member allowed in the community room (the same rule as reading its messages); otherwise 404.
 * Answers with a redirect to a signed storage link that expires after five minutes; the link is
 * never cached. Older attachments stored as /uploads/... paths are not served here.
 */
import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, activityLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { communityMember, decideCommunityMessageAccess, isStoredId } from '@/lib/account-access';
import { signedAttachmentUrl, type StoredAttachment } from '@/lib/chat-attachments';

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const kind = req.query.kind;
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if ((kind !== 'consultation' && kind !== 'community') || !isStoredId(id)) return res.status(404).json({ error: 'Not found' });
  if (!(await allowRequest(activityLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;
  try {
    const db = await getDb();
    const userId = req.user!.userId;
    if (kind === 'consultation') {
      const message = await db.collection('consultationMessages').findOne({ _id: new ObjectId(id) }, { projection: { sessionId: 1, attachment: 1 } });
      if (!message || !message.attachment || !isStoredId(String(message.sessionId))) return res.status(404).json({ error: 'Not found' });
      const session = await db.collection('consultationSessions').findOne({ _id: new ObjectId(String(message.sessionId)) }, { projection: { studentId: 1, expertId: 1 } });
      if (!session || (String(session.studentId) !== userId && String(session.expertId) !== userId)) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Referrer-Policy', 'no-referrer');
      return res.redirect(302, signedAttachmentUrl(message.attachment as StoredAttachment));
    }
    const message = await db.collection('communityMessages').findOne({ _id: new ObjectId(id) }, { projection: { roomId: 1, attachment: 1 } });
    if (!message || !message.attachment || !isStoredId(String(message.roomId))) return res.status(404).json({ error: 'Not found' });
    const room = await db.collection('communityRooms').findOne({ _id: new ObjectId(String(message.roomId)) });
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { learningLevel: 1, role: 1, studentDetails: 1 } });
    const access = decideCommunityMessageAccess({ member: communityMember(userId, user), room });
    if (!room || !access.ok) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, signedAttachmentUrl(message.attachment as StoredAttachment));
  } catch {
    console.error(JSON.stringify({ event: 'chatAttachmentRead', result: 'failed' }));
    return res.status(500).json({ error: 'Unexpected error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => { await handler(req, res); }, ['student', 'instructor', 'admin', 'superadmin']);
