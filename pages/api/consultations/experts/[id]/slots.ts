import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { ConsultationBookingError, listSlots } from '@/lib/consultation-booking-store';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const slots = await listSlots(id, req.query.from, req.query.to);
    res.status(200).json({ slots });
  } catch (error) {
    if (error instanceof ConsultationBookingError) {
      res.status(error.status).json({ error: error.clientError });
      return;
    }
    res.status(500).json(unexpectedBody('consultationSlots'));
  }
}

export default withAuth(handler);
