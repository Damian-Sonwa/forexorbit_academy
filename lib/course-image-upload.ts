/**
 * Shared handler for the course-image upload routes (rich-text lesson and course images, and
 * visual aids). Staff only (checked by the routes' withAuth), images only, 10 MB.
 *
 * The temporary file is removed whatever happens: validation failure, storage failure or success
 * (audit L2: it used to stay in /tmp when the upload to Cloudinary failed). Uploads are rate
 * limited per account (lib/content-rate-limit.js). Logs carry no email addresses.
 *
 * Storage, in order: Cloudflare R2 when R2_IMAGES_BUCKET and R2_PUBLIC_BASE_URL are set
 * (lib/r2-storage.js); Cloudinary when it is set up; otherwise the app's own database
 * (lib/course-image-store.js), so uploads work with no storage service or API keys at all. Every
 * image is decoded and written again (lib/upload-check.js) and the stored content type comes
 * from that, never from the browser, so only JPEG, PNG, GIF and WebP images are ever served.
 *
 * An image uploaded here is only referenced once the lesson or course that uses it is saved. If
 * that save never happens the image stays unreferenced in storage; see
 * docs/audits/phase-4-implementation.md (no upload registry exists, and adding one needs a new
 * collection the app's database role does not have).
 */
import type { NextApiResponse } from 'next';
import formidable from 'formidable';
import os from 'os';
import fs from 'fs';
import type { AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { publicUploadFailure } from '@/lib/public-error';
import { uploadImageFromPath, validateImageFile, isCloudinaryConfigured } from '@/lib/cloudinary';
import { allowRequest, uploadLimiter } from '@/lib/content-rate-limit';
import { publicUrl, putObject, r2ImagesConfig, r2ImagesMissing } from '@/lib/r2-storage';
import { IMAGE_EXTS, inspectUpload } from '@/lib/upload-check';
import { randomPublicId } from '@/lib/cloudinary';
import { ImageStoreError, storeImage } from '@/lib/course-image-store';

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

  // Instructor portraits (admin) have the profile photo limit.
  const maxBytes = req.query.kind === 'portrait' ? 2 * 1024 * 1024 : MAX_BYTES;
  const tempPaths: string[] = [];
  try {
    // Use /tmp for temporary file storage (works in both serverless and regular environments)
    const form = formidable({
      uploadDir: os.tmpdir(),
      keepExtensions: false,
      maxFiles: 1,
      maxFileSize: maxBytes,
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
    const cloudinary = isCloudinaryConfigured();
    const validation = validateImageFile({
      mimetype: file.mimetype || undefined,
      size: file.size,
      originalFilename: file.originalFilename || undefined,
    });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    // Decoded in full and written again, whichever storage is used (lib/upload-check.js).
    const kind = await inspectUpload(file.filepath, { name: file.originalFilename, allow: IMAGE_EXTS });
    if (!kind.ok) return res.status(kind.status).json({ error: kind.error, code: kind.code });
    if (r2 || !cloudinary) {
      if (!r2) {
        // No storage service: keep the image in the app's own database (lib/course-image-store.js).
        try {
          const stored = await storeImage(await getDb(), { bytes: await fs.promises.readFile(file.filepath), mime: kind.mime, ownerId: req.user.userId, folder });
          return res.status(200).json({ success: true, url: stored.url, imageUrl: stored.url, publicId: stored.id, filename: stored.url.split('/').pop(), storage: 'database' });
        } catch (error: unknown) {
          if (error instanceof ImageStoreError) {
            console.error(JSON.stringify({ event: 'courseImageUpload', storage: 'database', result: error.code, r2Missing: r2ImagesMissing() }));
            const status = error.code === 'STORE_NOT_PERMITTED' ? 503 : error.code === 'TOO_LARGE' ? 413 : 400;
            return res.status(status).json({ error: error.message, code: error.code });
          }
          throw error;
        }
      }
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
    const failure = publicUploadFailure(error, { limitMessage: `Images can be at most ${maxBytes / 1024 / 1024} MB.` });
    return res.status(failure.status).json(failure.body);
  } finally {
    removeTemp(tempPaths);
  }
}
