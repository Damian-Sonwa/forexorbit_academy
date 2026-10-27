import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { ConsultationBookingError, actOnBooking, getBooking } from '@/lib/consultation-booking-store';

function member(req: AuthRequest) {
  return { userId: req.user!.userId, role: req.user!.role };
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  try {
    if (req.method === 'GET') {
      res.status(200).json(await getBooking(member(req), id));
      return;
    }
    if (req.method === 'PUT') {
      res.status(200).json(await actOnBooking(member(req), id, req.body));
      return;
    }
    res.setHeader('Allow', ['GET', 'PUT']);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (error instanceof ConsultationBookingError) {
      res.status(error.status).json({ error: error.clientError });
      return;
    }
    res.status(500).json(unexpectedBody('consultationRequest'));
  }
}

export default withAuth(handler);
