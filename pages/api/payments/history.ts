/**
 * GET /api/payments/history
 * The signed-in user's own course payments, refunds and in-progress confirmations
 * (lib/payment-history.js). The user comes from the session; no parameter can name another user.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { listUserPayments } from '@/lib/payment-history';

async function handler(req: AuthRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const items = await listUserPayments(await getDb(), req.user!.userId);
    return res.status(200).json({ items });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('payment history', error));
  }
}

export default withAuth(handler);
