/**
 * POST /api/payments/paystack/init-lesson
 * Retired. Courses are sold only as one full-course purchase; no lesson intent is created.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  return res.status(410).json({
    success: false,
    code: 'lesson_purchase_retired',
    message: 'Individual lesson purchases are no longer available. Unlock the full course instead.',
  });
}
