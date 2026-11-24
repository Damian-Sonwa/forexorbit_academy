/**
 * Serves a profile photo kept on its account record (lib/profile-photo.js), like a photo on
 * Cloudinary or R2: the name carries a random part, so it cannot be guessed from the account id, and
 * a given address never changes its content (a new photo gets a new address). Cached for a day, so a
 * removed photo does not linger in browsers.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { readEmbeddedPhoto } from '@/lib/profile-photo';

export default async function profilePhoto(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const photo = await readEmbeddedPhoto(await getDb(), String(req.query.file || ''));
    if (!photo) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'Photo not found' });
    }
    res.setHeader('Content-Type', photo.mime);
    res.setHeader('Content-Length', String(photo.bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).end(photo.bytes);
  } catch {
    console.error(JSON.stringify({ event: 'profilePhotoRead', result: 'failed' }));
    return res.status(500).json({ error: 'The photo could not be loaded.' });
  }
}
