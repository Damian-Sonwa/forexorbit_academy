import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { CommunityQaError, createQuestion, listQuestions } from '@/lib/community-qa-store';

function member(req: AuthRequest) {
  return { userId: req.user!.userId, role: req.user!.role };
}

function sendFailure(res: NextApiResponse, error: unknown, operation: string) {
  if (error instanceof CommunityQaError) {
    res.status(error.status).json({ error: error.clientError });
    return;
  }
  res.status(500).json(unexpectedBody(operation));
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const questions = await listQuestions(member(req), req.query);
      res.status(200).json(questions);
      return;
    }
    if (req.method === 'POST') {
      const created = await createQuestion(member(req), req.body);
      res.status(201).json(created);
      return;
    }
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    sendFailure(res, error, 'communityQuestions');
  }
}

export default withAuth(handler);
