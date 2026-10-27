import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { CommunityQaError, deleteReply, updateReply } from '@/lib/community-qa-store';

function ids(req: AuthRequest) {
  return {
    questionId: typeof req.query.id === 'string' ? req.query.id : '',
    replyId: typeof req.query.replyId === 'string' ? req.query.replyId : '',
  };
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    const { questionId, replyId } = ids(req);
    const member = { userId: req.user!.userId, role: req.user!.role };
    if (req.method === 'PUT') {
      res.status(200).json(await updateReply(member, questionId, replyId, req.body));
      return;
    }
    if (req.method === 'DELETE') {
      res.status(200).json(await deleteReply(member, questionId, replyId));
      return;
    }
    res.setHeader('Allow', ['PUT', 'DELETE']);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (error instanceof CommunityQaError) {
      res.status(error.status).json({ error: error.clientError });
      return;
    }
    res.status(500).json(unexpectedBody('communityReply'));
  }
}

export default withAuth(handler);
