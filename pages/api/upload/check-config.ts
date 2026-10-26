/**
 * Cloudinary Configuration Check API
 * Diagnostic endpoint to check if Cloudinary is properly configured
 * Only accessible to authenticated users
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { isCloudinaryConfigured } from '@/lib/cloudinary';

async function checkConfig(req: AuthRequest, res: NextApiResponse) {
  const hasCloudName = !!process.env.CLOUDINARY_CLOUD_NAME;
  const hasApiKey = !!process.env.CLOUDINARY_API_KEY;
  const hasApiSecret = !!process.env.CLOUDINARY_API_SECRET;
  const isConfigured = isCloudinaryConfigured();

  // Don't expose actual values, just whether they exist
  res.json({
    configured: isConfigured,
    environment: process.env.NODE_ENV,
    checks: {
      cloudName: hasCloudName,
      apiKey: hasApiKey,
      apiSecret: hasApiSecret,
    },
    message: isConfigured
      ? 'Cloudinary is properly configured'
      : 'Cloudinary configuration is missing. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your Vercel environment variables.',
  });
}

export default withAuth(checkConfig);

