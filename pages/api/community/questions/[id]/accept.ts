import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { CommunityQaError, acceptAnswer } from '@/lib/community-qa-store';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const result = await acceptAnswer(
      { userId: req.user!.userId, role: req.user!.role },
      id,
      req.body
    );
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof CommunityQaError) {
      res.status(error.status).json({ error: error.clientError });
      return;
    }
    res.status(500).json(unexpectedBody('communityAccept'));
  }
}

export default withAuth(handler);
