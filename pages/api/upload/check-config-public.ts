/**
 * Public upload storage check: whether course image uploads have somewhere to go. Booleans only,
 * no setting names or values. Cloudinary is the original storage; R2 (lib/r2-storage.js) is used
 * for course images first when it is set up; without either, images are kept in the database.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isCloudinaryConfigured } from '@/lib/cloudinary';
import { r2ImagesConfig } from '@/lib/r2-storage';

export default function checkConfigPublic(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const cloudinary = isCloudinaryConfigured();
  const r2 = Boolean(r2ImagesConfig());
  // The app's database is always there as the last resort (lib/course-image-store.js).
  res.json({ configured: true, cloudinary, r2, database: !cloudinary && !r2 });
}
