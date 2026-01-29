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

