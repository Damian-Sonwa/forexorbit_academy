/**
 * Visual Aid Image Upload API
 * Allows instructors and admins to upload images for lesson visual aids (Cloudinary folder
 * forexorbit/visual-aids). See lib/course-image-upload.ts.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { handleCourseImageUpload } from '@/lib/course-image-upload';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadVisualAid(req: AuthRequest, res: NextApiResponse) {
  return handleCourseImageUpload(req, res, { field: 'file', folder: 'visual-aids' });
}

export default withAuth(uploadVisualAid, ['instructor', 'admin', 'superadmin']);
