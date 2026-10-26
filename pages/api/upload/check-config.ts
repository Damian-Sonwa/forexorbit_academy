/**
 * Cloudinary Configuration Check API
 * Diagnostic endpoint to check if Cloudinary is properly configured
 * Only accessible to authenticated users
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { isCloudinaryConfigured } from '@/lib/cloudinary';

async function checkConfig(req: AuthRequest, res: NextApiResponse) {
  res.json({ configured: isCloudinaryConfigured() });
}

export default withAuth(checkConfig);

