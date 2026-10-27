/**
 * Authenticated reminder pass for consultations starting within an hour.
 * There is no in-process scheduler. An administrator must call this route,
 * or an external job must call it with that administrator's session.
 * The response never includes meeting links.
 */

import type { NextApiResponse } from 'next';
import { withAuth, type AuthRequest } from '@/lib/auth-middleware';
import { unexpectedBody } from '@/lib/public-error';
import { ConsultationBookingError, sendDueReminders } from '@/lib/consultation-booking-store';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const result = await sendDueReminders({ userId: req.user!.userId, role: req.user!.role });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ConsultationBookingError) {
      res.status(error.status).json({ error: error.clientError });
      return;
    }
    res.status(500).json(unexpectedBody('consultationReminders'));
  }
}

export default withAuth(handler, ['admin', 'superadmin']);
