import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import {
  ConsultationBookingError,
  listExperts,
  saveAvailability,
  setAvailableFlag,
} from '@/lib/consultation-booking-store';

function member(req: AuthRequest) {
  return { userId: req.user!.userId, role: req.user!.role };
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      res.status(200).json(await listExperts(req.user!.userId));
      return;
    }
    if (req.method === 'PUT') {
      const body = req.body && typeof req.body === 'object' ? req.body as { available?: unknown; timeZone?: unknown } : {};
      if (typeof body.available === 'boolean' && body.timeZone == null) {
        res.status(200).json(await setAvailableFlag(member(req), body.available));
        return;
      }
      res.status(200).json(await saveAvailability(member(req), req.body));
      return;
    }
    res.setHeader('Allow', ['GET', 'PUT']);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (error instanceof ConsultationBookingError) {
      res.status(error.status).json({ error: error.clientError });
      return;
    }
    res.status(500).json(unexpectedBody('consultationExperts'));
  }
}

export default withAuth(handler);
