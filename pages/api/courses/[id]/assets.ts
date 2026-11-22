/**
 * POST   /api/courses/:id/assets            multipart, field "file": uploads a course file
 * GET    /api/courses/:id/assets?assetId=   owners: opens a file (builder preview, unsaved content)
 * DELETE /api/courses/:id/assets?assetId=   removes a file that no lesson uses
 *
 * Course owners only, while they may edit the content (instructors: drafts). The file's extension
 * must be supported and its first bytes must match it (lib/course-asset-files.js); the display name
 * is cleaned; the stored file has no public address (lib/course-assets.ts). The temporary file is
 * always removed. A file that is in use cannot be removed: take it out of the lesson first.
 */

import fs from 'fs';
import os from 'os';
import type { NextApiResponse } from 'next';
import formidable, { type File } from 'formidable';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { loadOwnedCourse } from '@/lib/course-builder-access';
import { MAX_COURSE_ASSETS, MAX_UPLOAD_BYTES, checkCourseFile } from '@/lib/course-asset-files';
import { courseAssetStorage, presentCourseAsset, removeCourseAsset, signedCourseAssetUrl, storeCourseAsset, type CourseAsset } from '@/lib/course-assets';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { allowRequest, authoringLimiter, uploadLimiter } from '@/lib/content-rate-limit';
import { unexpectedBody } from '@/lib/public-error';

export const config = { api: { bodyParser: false } };

async function readHead(filePath: string): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function upload(req: AuthRequest, res: NextApiResponse, courseId: string) {
  const db = await getDb();
  if (!(await allowRequest(uploadLimiter, { userId: req.user!.userId, res, getDb }))) return;
  // Ownership and the edit rule are checked before the file is read.
  const owned = await loadOwnedCourse(db, req, courseId, { assets: { $slice: -1 } }, { edit: true });
  if (!owned.ok) return res.status(owned.status).json({ error: owned.error, code: owned.code });
  if (!courseAssetStorage()) return res.status(503).json({ error: 'File uploads are not available right now. Add a link to the file instead.', code: 'storage_unavailable' });

  let file: File | undefined;
  try {
    const form = formidable({ uploadDir: os.tmpdir(), maxFiles: 1, maxFileSize: MAX_UPLOAD_BYTES, allowEmptyFiles: false });
    try {
      const [, files] = await form.parse(req);
      const entry = files.file;
      file = Array.isArray(entry) ? entry[0] : entry;
    } catch (error) {
      const code = (error as { httpCode?: number }).httpCode;
      if (code === 413) return res.status(413).json({ error: 'The file is larger than 100 MB.', code: 'file_too_large' });
      return res.status(400).json({ error: 'The upload did not complete. Try again.', code: 'upload_incomplete' });
    }
    if (!file) return res.status(400).json({ error: 'Choose a file to upload.', code: 'no_file' });
    const checked = checkCourseFile({ name: file.originalFilename, size: file.size, head: await readHead(file.filepath) });
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error, code: checked.code });

    let asset: CourseAsset;
    try {
      asset = await storeCourseAsset(file.filepath, { ext: checked.ext, kind: checked.kind, mime: checked.mime, name: checked.name, bytes: file.size, uploadedBy: owned.member.userId });
    } catch {
      console.error(JSON.stringify({ event: 'courseAssetUpload', result: 'storage_failed' }));
      return res.status(503).json({ error: 'The file could not be stored. Try again in a moment.', code: 'storage_failed' });
    }
    // At most MAX_COURSE_ASSETS files per course (the course document lists them).
    const added = await db.collection('courses').updateOne(
      { _id: owned.course._id, [`assets.${MAX_COURSE_ASSETS - 1}`]: { $exists: false } },
      { $push: { assets: asset } as never }
    );
    if (!added.matchedCount) {
      await removeCourseAsset(asset).catch(() => undefined);
      return res.status(409).json({ error: `A course can hold at most ${MAX_COURSE_ASSETS} files. Remove files you no longer use.`, code: 'too_many_files' });
    }
    console.log(JSON.stringify({ event: 'courseAssetUpload', result: 'stored', courseId, kind: asset.kind, bytes: asset.bytes }));
    return res.status(201).json({ asset: presentCourseAsset(asset) });
  } finally {
    if (file) await fs.promises.rm(file.filepath, { force: true }).catch(() => undefined);
  }
}

async function remove(req: AuthRequest, res: NextApiResponse, courseId: string) {
  const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : '';
  if (!/^[a-z0-9]{12,32}$/.test(assetId)) return res.status(400).json({ error: 'Invalid file.' });
  const db = await getDb();
  if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
  const owned = await loadOwnedCourse(db, req, courseId, { assets: 1 }, { edit: true });
  if (!owned.ok) return res.status(owned.status).json({ error: owned.error, code: owned.code });
  const asset = ((owned.course.assets || []) as CourseAsset[]).find((a) => a.id === assetId);
  if (!asset) return res.status(404).json({ error: 'File not found.' });
  const inUse = await db.collection('lessons').findOne({ courseId: String(owned.course._id), 'blocks.assetId': assetId }, { projection: { title: 1 } });
  if (inUse) {
    return res.status(409).json({ error: `This file is used in "${inUse.title || 'a lesson'}". Remove it from that lesson first.`, code: 'asset_in_use' });
  }
  await db.collection('courses').updateOne({ _id: owned.course._id }, { $pull: { assets: { id: assetId } } as never });
  try {
    await removeCourseAsset(asset);
  } catch {
    // The listing no longer points at it; the stored copy is reported for manual cleanup.
    console.error(JSON.stringify({ event: 'courseAssetRemove', result: 'storage_failed', courseId, assetId }));
  }
  return res.json({ success: true });
}

/** Owners (assigned instructor, admins) open a course file from the builder, in any course state. */
async function open(req: AuthRequest, res: NextApiResponse, courseId: string) {
  setPrivateNoStore(res);
  const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : '';
  if (!/^[a-z0-9]{12,32}$/.test(assetId)) return res.status(400).json({ error: 'Invalid file.' });
  const db = await getDb();
  const owned = await loadOwnedCourse(db, req, courseId, { assets: 1 });
  if (!owned.ok) return res.status(owned.status).json({ error: owned.error, code: owned.code });
  const asset = ((owned.course.assets || []) as CourseAsset[]).find((a) => a.id === assetId);
  if (!asset) return res.status(404).json({ error: 'File not found.' });
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Location', signedCourseAssetUrl(asset, String(owned.course._id)));
  return res.status(302).json({ ok: true });
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  try {
    if (req.method === 'GET') return await open(req, res, String(courseId || ''));
    if (req.method === 'POST') return await upload(req, res, String(courseId || ''));
    if (req.method === 'DELETE') return await remove(req, res, String(courseId || ''));
    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    console.error(JSON.stringify({ event: 'courseAsset', result: 'failed' }));
    if (!res.headersSent) return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);
