/**
 * Shared handler for the course-image upload routes (rich-text lesson and course images, and
 * visual aids). Staff only (checked by the routes' withAuth), images only, 10 MB.
 *
 * The temporary file is removed whatever happens: validation failure, storage failure or success
 * (audit L2: it used to stay in /tmp when the upload to Cloudinary failed). Uploads are rate
 * limited per account (lib/content-rate-limit.js). Logs carry no email addresses.
 *
 * Storage (course builder): Cloudflare R2 when R2_IMAGES_BUCKET and R2_PUBLIC_BASE_URL are set
 * (lib/r2-storage.js), otherwise Cloudinary as before. For R2 the image's real type is read from its
 * first bytes and the stored content type comes from that, never from the browser, so only JPEG,
 * PNG, GIF and WebP images are ever served from the public bucket. If neither is set up, the builder
 * still accepts an image link.
 *
 * An image uploaded here is only referenced once the lesson or course that uses it is saved. If
 * that save never happens the image stays unreferenced in storage; see
 * docs/audits/phase-4-implementation.md (no upload registry exists, and adding one needs a new
 * collection the app's database role does not have).
 */
import type { NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import type { AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { publicUploadFailure } from '@/lib/public-error';
import { uploadImageFromPath, validateImageFile, isCloudinaryConfigured } from '@/lib/cloudinary';
import { allowRequest, uploadLimiter } from '@/lib/content-rate-limit';
import { publicUrl, putObject, r2ImagesConfig } from '@/lib/r2-storage';
import { detectImage } from '@/lib/course-asset-files';
import { randomPublicId } from '@/lib/cloudinary';

const MAX_BYTES = 10 * 1024 * 1024;

function removeTemp(paths: string[]) {
  for (const filepath of paths) {
    try {
      if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch {
      // A leftover temp file is harmless; nothing else to do.
    }
  }
}

export async function handleCourseImageUpload(
  req: AuthRequest,
  res: NextApiResponse,
  { field, folder }: { field: string; folder: 'instructors' | 'visual-aids' }
) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!(await allowRequest(uploadLimiter, { userId: req.user.userId, res, getDb }))) return;

  const tempPaths: string[] = [];
  try {
    // Use /tmp for temporary file storage (works in both serverless and regular environments)
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: MAX_BYTES,
      filter: ({ name, mimetype }) => name === field && Boolean(mimetype && mimetype.startsWith('image/')),
    });
    const [, files] = await form.parse(req);
    for (const list of Object.values(files)) {
      for (const item of Array.isArray(list) ? list : list ? [list] : []) tempPaths.push(item.filepath);
    }
    const entry = files[field];
    const file = Array.isArray(entry) ? entry[0] : entry;
    if (!file) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    const r2 = r2ImagesConfig();
    if (!r2 && !isCloudinaryConfigured()) {
      console.error(JSON.stringify({ event: 'courseImageUpload', result: 'storage_not_configured' }));
      return res.status(503).json({ error: 'Image uploads are not set up on this server. Paste a link to the image instead.', code: 'storage_unavailable' });
    }
    const validation = validateImageFile({
      mimetype: file.mimetype || undefined,
      size: file.size,
      originalFilename: file.originalFilename || undefined,
    });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    if (r2) {
      const head = Buffer.alloc(16);
      const handle = await fs.promises.open(file.filepath, 'r');
      try { await handle.read(head, 0, 16, 0); } finally { await handle.close(); }
      const kind = detectImage(head);
      if (!kind) return res.status(400).json({ error: 'This file is not a valid JPEG, PNG, GIF or WebP image.' });
      const key = `course-images/${folder}/${randomPublicId()}.${kind.ext}`;
      await putObject(r2, key, file.filepath, { contentType: kind.mime, cacheControl: 'public, max-age=31536000, immutable' });
      const url = publicUrl(r2, key);
      return res.status(200).json({ success: true, url, imageUrl: url, publicId: key, filename: key.split('/').pop(), storage: 'r2' });
    }
    const uploadResult = await uploadImageFromPath(file.filepath, folder);
    return res.status(200).json({
      success: true,
      url: uploadResult.secureUrl,
      imageUrl: uploadResult.secureUrl, // Support both response formats
      publicId: uploadResult.publicId,
      filename: uploadResult.publicId.split('/').pop() || 'image',
    });
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'courseImageUpload', folder, result: 'failed' }));
    const failure = publicUploadFailure(error, { limitMessage: 'File size exceeds 10MB limit' });
    return res.status(failure.status).json(failure.body);
  } finally {
    removeTemp(tempPaths);
  }
}
