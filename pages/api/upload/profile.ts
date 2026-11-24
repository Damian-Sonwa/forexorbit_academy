/**
 * Profile photo (any signed-in account, its own photo only).
 *   POST   replace it (multipart field `profilePhoto`)
 *   DELETE remove it
 *
 * Storage, in order: Cloudflare R2 when it is set up, Cloudinary when it is set up, otherwise the
 * account record itself (lib/profile-photo.js), so photos work with no storage service, no keys and
 * no extra database permission. Every photo is re-encoded first (lib/profile-image.js), so the stored
 * file is always a small WebP with no hidden data. Uploads are rate limited (Phase 15).
 */

import type { NextApiResponse } from 'next';
import { randomBytes } from 'crypto';
import formidable from 'formidable';
import fs from 'fs';
import os from 'os';
import { publicUploadFailure, unexpectedBody } from '@/lib/public-error';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { allowRequest, uploadLimiter } from '@/lib/content-rate-limit';
import { MAX_EMBEDDED_BYTES, currentPhotoId, embeddedPhoto, photoDeleter, removeProfilePhoto, replaceProfilePhoto } from '@/lib/profile-photo';
import { reencodeProfileImage } from '@/lib/profile-image';
import { deleteObject, publicUrl, putObject, r2ImagesConfig } from '@/lib/r2-storage';
import { uploadImageFromPath, validateImageFile, deleteImage, isCloudinaryConfigured } from '@/lib/cloudinary';

export const config = {
  api: {
    bodyParser: false,
  },
};

/** Enforced while the upload arrives. The app shrinks a photo to about 30 KB before sending it. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Deletes a stored photo wherever it is kept. */
const deleteStored = photoDeleter({
  cloudinary: (publicId: string) => deleteImage(publicId),
  r2: async (key: string) => {
    const r2 = r2ImagesConfig();
    if (r2) await deleteObject(r2, key);
  },
});

async function uploadProfilePhoto(req: AuthRequest, res: NextApiResponse) {
  if (!(await allowRequest(uploadLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;
  const tempPaths: string[] = [];
  try {
    const form = formidable({
      uploadDir: os.tmpdir(),
      keepExtensions: false,
      maxFiles: 1,
      maxFileSize: MAX_PHOTO_BYTES,
      filter: ({ name }) => name === 'profilePhoto',
    });
    const [, files] = await form.parse(req);
    for (const list of Object.values(files)) for (const item of list || []) tempPaths.push(item.filepath);
    const file = files.profilePhoto?.[0];
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const validation = validateImageFile({ mimetype: file.mimetype || undefined, size: file.size, originalFilename: file.originalFilename || undefined });
    if (!validation.valid) return res.status(400).json({ error: validation.error });

    const image = await reencodeProfileImage(await fs.promises.readFile(file.filepath));
    if (!image.ok) return res.status(image.status).json({ error: image.error });
    await fs.promises.writeFile(file.filepath, image.bytes);

    const userId = req.user!.userId;
    const db = await getDb();
    // The photo in use now; it is replaced only if the account still has it after the upload.
    const previousPublicId = await currentPhotoId(db, userId);
    const r2 = r2ImagesConfig();
    let upload: { secureUrl: string; publicId: string; data?: { mime: string; bytes: Buffer } };

    if (!r2 && isCloudinaryConfigured()) {
      const stored = await uploadImageFromPath(file.filepath, 'profiles', { userId });
      upload = { secureUrl: stored.secureUrl, publicId: stored.publicId };
    } else {
      if (r2) {
        const key = `profile-photos/${randomBytes(16).toString('hex')}.${image.ext}`;
        await putObject(r2, key, file.filepath, { contentType: image.mime, cacheControl: 'public, max-age=86400' });
        upload = { secureUrl: publicUrl(r2, key), publicId: `r2:${key}` };
      } else {
        if (image.bytes.length > MAX_EMBEDDED_BYTES) {
          return res.status(413).json({ error: `This photo is too large to store (${Math.round(image.bytes.length / 1024)} KB). Use a smaller image.`, code: 'FILE_TOO_LARGE' });
        }
        upload = embeddedPhoto(userId, image);
      }
    }

    // Record the new photo, then delete the old one (lib/profile-photo.js). An upload that cannot
    // be recorded is deleted again, so no unreferenced copy is left behind.
    const replaced = await replaceProfilePhoto(db, { userId, previousPublicId, upload, deleteImage: deleteStored });
    if (!replaced.ok) return res.status(replaced.status).json({ error: replaced.error, code: replaced.code });

    return res.json({ success: true, imageUrl: upload.secureUrl, message: 'Profile photo uploaded successfully' });
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'profilePhotoUpload', result: 'failed' }));
    const failure = publicUploadFailure(error, { limitMessage: 'Profile photos can be at most 2 MB.' });
    return res.status(failure.status).json(failure.body);
  } finally {
    for (const filepath of tempPaths) await fs.promises.unlink(filepath).catch(() => undefined);
  }
}

/** DELETE: remove the account's photo (record first, then the stored file). */
async function deleteProfilePhoto(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const result = await removeProfilePhoto(db, { userId: req.user!.userId, deleteImage: deleteStored });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json({ success: true, removed: result.removed });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('profile photo delete', error));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'POST') return uploadProfilePhoto(req, res);
  if (req.method === 'DELETE') return deleteProfilePhoto(req, res);
  res.setHeader('Allow', ['POST', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
