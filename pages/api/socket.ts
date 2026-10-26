/**
 * Socket.IO is not created here.
 * `node server.js` attaches the authenticated server at path /api/socket.
 * A request that reaches this Next.js route must not attach a second server.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(404).json({ error: 'Not found' });
}
