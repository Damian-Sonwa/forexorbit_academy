import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { CommunityQaError, deleteQuestion, getQuestion, updateQuestion } from '@/lib/community-qa-store';

function member(req: AuthRequest) {
  return { userId: req.user!.userId, role: req.user!.role };
}

function questionId(req: AuthRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

function sendFailure(res: NextApiResponse, error: unknown) {
  if (error instanceof CommunityQaError) {
    res.status(error.status).json({ error: error.clientError });
    return;
  }
  res.status(500).json(unexpectedBody('communityQuestion'));
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    const id = questionId(req);
    if (req.method === 'GET') {
      res.status(200).json(await getQuestion(member(req), id, req.query.replyPage));
      return;
    }
    if (req.method === 'PUT') {
      res.status(200).json(await updateQuestion(member(req), id, req.body));
      return;
    }
    if (req.method === 'DELETE') {
      res.status(200).json(await deleteQuestion(member(req), id));
      return;
    }
    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    sendFailure(res, error);
  }
}

export default withAuth(handler);
