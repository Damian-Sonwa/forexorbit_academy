/**
 * GET /api/courses/:id/asset-file?a=&e=&t=   DEVELOPMENT ONLY (COURSE_ASSETS_LOCAL_DIR).
 *
 * Serves a course file stored on the local disk, standing in for the provider's signed link: the
 * link is made by the lesson document route after its access check, expires after five minutes and
 * is bound to the file by an HMAC. Answers 404 in production or when local storage is not enabled.
 */

import fs from 'fs';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { isStoredId } from '@/lib/account-access';
import { courseAssetStorage, localAssetPath, verifyLocalToken, type CourseAsset } from '@/lib/course-assets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' || courseAssetStorage() !== 'local') return res.status(404).end();
  const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const assetId = typeof req.query.a === 'string' && /^[a-f0-9]{24}$/.test(req.query.a) ? req.query.a : '';
  const expires = Number(req.query.e);
  const token = typeof req.query.t === 'string' ? req.query.t : '';
  if (!isStoredId(courseId) || !assetId || !verifyLocalToken(assetId, expires, token)) return res.status(404).end();
  const db = await getDb();
  const course = await db.collection('courses').findOne({ _id: new ObjectId(courseId), 'assets.id': assetId }, { projection: { 'assets.$': 1 } });
  const asset = course && Array.isArray(course.assets) ? (course.assets[0] as CourseAsset) : null;
  const file = asset ? localAssetPath(asset.publicId) : null;
  if (!asset || !file || !fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', asset.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (asset.kind !== 'video' && asset.kind !== 'pdf') res.setHeader('Content-Disposition', `attachment; filename="${asset.name.replace(/"/g, '')}"`);
  fs.createReadStream(file).pipe(res);
}
