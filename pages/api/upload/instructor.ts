/**
 * Instructor Image Upload API
 * Images for rich-text course and lesson content and instructor profiles (Cloudinary folder
 * forexorbit/instructors). See lib/course-image-upload.ts.
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { handleCourseImageUpload } from '@/lib/course-image-upload';

// Disable default body parser to allow file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadInstructorImage(req: AuthRequest, res: NextApiResponse) {
  return handleCourseImageUpload(req, res, { field: 'image', folder: 'instructors' });
}

export default withAuth(uploadInstructorImage, ['admin', 'superadmin', 'instructor']);
