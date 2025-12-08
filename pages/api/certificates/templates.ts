/**
 * Certificate Templates API Route
 * GET: Get certificate templates by level (for students to see available certificates)
 * Admin can also manage templates here
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function getTemplates(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const certificateTemplates = db.collection('certificateTemplates');
    const { level } = req.query;

    let query: any = {};
    if (level) {
      query.level = level;
    }

    const templates = await certificateTemplates.find(query).sort({ uploadedAt: -1 }).toArray();

    res.json(templates);
  } catch (error: any) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(getTemplates);










