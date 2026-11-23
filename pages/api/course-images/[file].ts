/**
 * Serves an image stored by the built-in image storage (lib/course-image-store.js). Public like
 * lesson images on Cloudinary or R2: names are random and cannot be guessed. A stored image never
 * changes, so it is cached for a year.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { readImage } from '@/lib/course-image-store';

export const config = { api: { responseLimit: false } };

export default async function courseImage(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const image = await readImage(await getDb(), String(req.query.file || ''));
    if (!image) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'Image not found' });
    }
    res.setHeader('Content-Type', image.mime);
    res.setHeader('Content-Length', String(image.bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('ETag', `"${image.id}"`);
    if (req.headers['if-none-match'] === `"${image.id}"`) return res.status(304).end();
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).end(image.bytes);
  } catch {
    console.error(JSON.stringify({ event: 'courseImageRead', result: 'failed' }));
    return res.status(500).json({ error: 'The image could not be loaded.' });
  }
}
