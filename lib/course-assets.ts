/**
 * Course files uploaded in the course builder (documents, spreadsheets, slides, PDFs, video).
 *
 * Storage: Cloudinary, the provider the app already uses. Files are stored with no public address:
 *   documents and PDFs  resource_type 'raw', type 'private'; read through a signed download link
 *                       that expires after five minutes (as chat attachments, Phase 15)
 *   video               resource_type 'video', type 'authenticated'; read through a signed delivery
 *                       link (streamable by the browser's video player)
 * Readers never receive a stored address: lessons point at the file by asset id, and
 * GET /api/lessons/:id/document?item=b-<blockId> re-checks lesson access (enrolment, course state,
 * paywall) on every request before redirecting to a signed link.
 *
 * The course document lists its uploaded files (`courses.assets`, at most 300), so a lesson can
 * only reference files uploaded to its own course, and the builder's file library can reuse or
 * remove them. No new collection is needed.
 *
 * Cloudflare R2 (lib/r2-storage.js): when R2_FILES_BUCKET is set, files go to that private bucket
 * instead of Cloudinary, and readers get a presigned link that expires after five minutes (video
 * included, so R2 video links also expire). Files already stored keep their own storage.
 *
 * Development only: COURSE_ASSETS_LOCAL_DIR stores files on the local disk instead (never in
 * production), so the builder can be exercised without touching the production storage account.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { isCloudinaryConfigured, randomPublicId } from '@/lib/cloudinary';
import { deleteObject, putObject, r2FilesConfig, signedGetUrl } from '@/lib/r2-storage';

export type CourseAsset = {
  id: string;
  driver: 'cloudinary' | 'local' | 'r2';
  publicId: string;
  resourceType: 'raw' | 'video';
  format: string;
  kind: string;
  mime: string;
  /** A label for people; the file itself carries `fileName`. */
  name: string;
  /** Random name the file downloads under (absent on files stored before it existed). */
  fileName?: string;
  bytes: number;
  uploadedBy: string;
  uploadedAt: Date;
};

const SIGNED_SECONDS = 300;

function localDir(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const dir = (process.env.COURSE_ASSETS_LOCAL_DIR || '').trim();
  return dir ? path.resolve(dir) : null;
}

export function courseAssetStorage(): 'cloudinary' | 'local' | 'r2' | null {
  if (localDir()) return 'local';
  if (r2FilesConfig()) return 'r2';
  return isCloudinaryConfigured() ? 'cloudinary' : null;
}

export function newAssetId(): string {
  return crypto.randomBytes(12).toString('hex');
}

/** Stores a checked temporary file. Throws when storage fails (the route answers 503). */
export async function storeCourseAsset(
  filePath: string,
  meta: { ext: string; kind: string; mime: string; name: string; fileName: string; bytes: number; uploadedBy: string }
): Promise<CourseAsset> {
  const id = newAssetId();
  const resourceType: CourseAsset['resourceType'] = meta.kind === 'video' ? 'video' : 'raw';
  const base = { id, resourceType, format: meta.ext, kind: meta.kind, mime: meta.mime, name: meta.name, fileName: meta.fileName, bytes: meta.bytes, uploadedBy: meta.uploadedBy, uploadedAt: new Date() };
  const dir = localDir();
  if (dir) {
    await fs.promises.mkdir(dir, { recursive: true });
    const publicId = `${id}.${meta.ext}`;
    await fs.promises.copyFile(filePath, path.join(dir, publicId));
    return { ...base, driver: 'local', publicId };
  }
  const r2 = r2FilesConfig();
  if (r2) {
    const publicId = `course-files/${randomPublicId()}.${meta.ext}`;
    await putObject(r2, publicId, filePath, { contentType: meta.mime });
    return { ...base, driver: 'r2', publicId };
  }
  if (!isCloudinaryConfigured()) throw new Error('Course file storage is not configured');
  const result = await new Promise<{ public_id: string }>((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        folder: 'forexorbit/course-files',
        resource_type: resourceType,
        type: resourceType === 'video' ? 'authenticated' : 'private',
        // Raw files keep their extension in the id, so downloads open with the right application.
        public_id: resourceType === 'raw' ? `${randomPublicId()}.${meta.ext}` : randomPublicId(),
        overwrite: false,
      },
      (error, res) => (error || !res ? reject(new Error('Course file storage failed')) : resolve(res))
    );
  });
  return { ...base, driver: 'cloudinary', publicId: result.public_id };
}

function localToken(assetId: string, expires: number): string {
  const secret = process.env.JWT_SECRET || 'development-only';
  return crypto.createHmac('sha256', secret).update(`${assetId}.${expires}`).digest('hex').slice(0, 32);
}

/** Verifies a development link made by signedCourseAssetUrl (local storage only). */
export function verifyLocalToken(assetId: string, expires: number, token: string): boolean {
  if (!localDir() || !Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = localToken(assetId, expires);
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function localAssetPath(publicId: string): string | null {
  const dir = localDir();
  if (!dir || !/^[a-f0-9]{24}\.[a-z0-9]{2,5}$/.test(publicId)) return null;
  return path.join(dir, publicId);
}

/** A short-lived link to the stored file, for a reader who has just passed the access check. */
export function signedCourseAssetUrl(asset: CourseAsset, courseId: string): string {
  const expires = Math.floor(Date.now() / 1000) + SIGNED_SECONDS;
  if (asset.driver === 'local') {
    return `/api/courses/${courseId}/asset-file?a=${asset.id}&e=${expires}&t=${localToken(asset.id, expires)}`;
  }
  if (asset.driver === 'r2') {
    const r2 = r2FilesConfig();
    if (!r2) throw new Error('R2 file storage is no longer configured');
    // Videos and PDFs open in the browser; other files download under their random name.
    return signedGetUrl(r2, asset.publicId, { expires: SIGNED_SECONDS, filename: asset.fileName || asset.name, inline: asset.kind === 'video' || asset.kind === 'pdf' });
  }
  if (asset.resourceType === 'video') {
    return cloudinary.url(asset.publicId, { resource_type: 'video', type: 'authenticated', sign_url: true, secure: true, format: asset.format });
  }
  return cloudinary.utils.private_download_url(asset.publicId, '', { type: 'private', resource_type: 'raw', expires_at: expires, attachment: true });
}

/** Removes a stored file (builder "remove file", after checking no lesson uses it). */
export async function removeCourseAsset(asset: CourseAsset): Promise<void> {
  if (asset.driver === 'local') {
    const file = localAssetPath(asset.publicId);
    if (file) await fs.promises.rm(file, { force: true });
    return;
  }
  if (asset.driver === 'r2') {
    const r2 = r2FilesConfig();
    if (r2) await deleteObject(r2, asset.publicId);
    return;
  }
  await cloudinary.uploader.destroy(asset.publicId, { resource_type: asset.resourceType, type: asset.resourceType === 'video' ? 'authenticated' : 'private', invalidate: true });
}

export function presentCourseAsset(a: CourseAsset) {
  return { id: a.id, name: a.name, kind: a.kind, mime: a.mime, bytes: a.bytes, uploadedAt: a.uploadedAt };
}
