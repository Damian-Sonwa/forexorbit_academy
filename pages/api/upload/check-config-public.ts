/**
 * Public Cloudinary Configuration Check API
 * Diagnostic endpoint to check if Cloudinary is properly configured
 * NO AUTHENTICATION REQUIRED - for testing purposes only
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isCloudinaryConfigured } from '@/lib/cloudinary';

export default function checkConfigPublic(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.json({ configured: isCloudinaryConfigured() });
}

