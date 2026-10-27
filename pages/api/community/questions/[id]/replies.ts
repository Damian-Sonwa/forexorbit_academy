import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { CommunityQaError, createReply } from '@/lib/community-qa-store';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const created = await createReply(
      { userId: req.user!.userId, role: req.user!.role },
      id,
      req.body
    );
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof CommunityQaError) {
      res.status(error.status).json({ error: error.clientError });
      return;
    }
    res.status(500).json(unexpectedBody('communityReply'));
  }
}

export default withAuth(handler);
