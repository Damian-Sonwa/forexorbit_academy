/**
 * Screenshot Serving API Route
 * Serves screenshot files from /tmp in serverless environments
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import fs from 'fs';
import path from 'path';

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename } = req.query;

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Get screenshot metadata from database
    const db = await getDb();
    const screenshots = db.collection('Screenshots');
    
    const screenshot = await screenshots.findOne({ filename });

    if (!screenshot) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }

    // Check if user has access (student who uploaded it, or instructor/admin)
    const hasAccess = 
      screenshot.studentId === req.user!.userId ||
      req.user!.role === 'instructor' ||
      req.user!.role === 'admin' ||
      req.user!.role === 'superadmin';

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Try to find file in /tmp (serverless) or public/uploads (regular)
    const isServerless = process.env.VERCEL === '1' || process.cwd().includes('/var/task');
    const filePath = isServerless
      ? path.join('/tmp', 'uploads', 'demo-trading', filename)
      : path.join(process.cwd(), 'public', 'uploads', 'demo-trading', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Read and serve the file
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = screenshot.mimeType || 'image/jpeg';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(fileBuffer);
  } catch (error: any) {
    console.error('Screenshot serve error:', error);
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
}, ['student', 'instructor', 'admin', 'superadmin']);

