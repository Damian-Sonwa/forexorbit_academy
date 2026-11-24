'use strict';

/**
 * Profile photo lifecycle (POST/DELETE /api/upload/profile). The account record is changed only if
 * it still holds the photo that was read before the upload, so two uploads at once cannot leave
 * one of them stored but unreferenced. A new upload that cannot be recorded is deleted again; an
 * old photo is deleted only after the record points away from it, so a failed update never loses
 * the photo in use. Storage deletions are awaited (not fire-and-forget) and a failure is logged
 * by account id; Cloudinary deletes are idempotent, so the cleanup can be repeated.
 */

const crypto = require('crypto');
const { Binary, ObjectId } = require('mongodb');

/**
 * Where a photo is kept, told from its stored id:
 *   "db:<random>"  on the account record itself (profilePhotoData), served by /api/profile-photos
 *   "r2:<key>"     Cloudflare R2
 *   anything else  Cloudinary
 * The browser sends a 400 px square (about 30 KB), so a photo on the record stays small.
 */
const MAX_EMBEDDED_BYTES = 150 * 1024;
const EMBEDDED_FILE = /^([a-f0-9]{24})-([a-f0-9]{32})\.(?:jpg|png|gif|webp)$/;

/** An upload kept on the account record. */
function embeddedPhoto(userId, { mime, ext, bytes }) {
  const token = crypto.randomBytes(16).toString('hex');
  return { secureUrl: `/api/profile-photos/${userId}-${token}.${ext}`, publicId: `db:${token}`, data: { mime, bytes } };
}

/** The photo for a served file name, or null (wrong name, replaced or removed photo). */
async function readEmbeddedPhoto(db, file) {
  const match = EMBEDDED_FILE.exec(String(file || ''));
  if (!match) return null;
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(match[1]), profilePhotoPublicId: `db:${match[2]}` },
    { projection: { profilePhotoData: 1 } }
  );
  const data = user && user.profilePhotoData;
  if (!data || !data.bytes) return null;
  return { mime: data.mime, bytes: Buffer.isBuffer(data.bytes) ? data.bytes : Buffer.from(data.bytes.buffer || data.bytes) };
}

/** Deletes by where the photo is kept; a photo on the record goes with the record's own update. */
function photoDeleter({ cloudinary, r2 }) {
  return async (publicId) => {
    if (publicId.startsWith('db:')) return;
    if (publicId.startsWith('r2:')) await r2(publicId.slice(3));
    else await cloudinary(publicId);
  };
}

const storedValue = (value) => (value === undefined ? null : value);

async function deleteQuietly(deleteImage, publicId, userId, stage) {
  try {
    await deleteImage(publicId);
    return true;
  } catch {
    console.warn(JSON.stringify({ event: 'profile_photo_cleanup_failed', stage, userId: String(userId) }));
    return false;
  }
}

/** The photo id currently on the account (null if none). */
async function currentPhotoId(db, userId) {
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(String(userId)) },
    { projection: { profilePhotoPublicId: 1 } }
  );
  return user ? storedValue(user.profilePhotoPublicId) : null;
}

/**
 * Points the account at a just-uploaded photo, if the account still has `previousPublicId`, then
 * deletes the previous photo. Resolves to { ok: true } or { ok: false, status: 409 } (the new
 * upload is deleted in that case). A database error also deletes the new upload, then rethrows.
 */
async function replaceProfilePhoto(db, { userId, previousPublicId, upload, deleteImage, now = new Date() }) {
  const _id = new ObjectId(String(userId));
  let updated;
  try {
    updated = await db.collection('users').updateOne(
      { _id, profilePhotoPublicId: storedValue(previousPublicId) },
      {
        $set: {
          profilePhoto: upload.secureUrl,
          profilePhotoPublicId: upload.publicId,
          ...(upload.data ? { profilePhotoData: { mime: upload.data.mime, bytes: new Binary(upload.data.bytes) } } : {}),
          updatedAt: now,
        },
        ...(upload.data ? {} : { $unset: { profilePhotoData: '' } }),
      }
    );
  } catch (error) {
    await deleteQuietly(deleteImage, upload.publicId, _id, 'unrecorded_upload');
    throw error;
  }
  if (!updated.matchedCount) {
    await deleteQuietly(deleteImage, upload.publicId, _id, 'unrecorded_upload');
    return { ok: false, status: 409, error: 'Your photo was changed somewhere else at the same time. Try again.', code: 'concurrent_change' };
  }
  if (previousPublicId && previousPublicId !== upload.publicId) {
    await deleteQuietly(deleteImage, previousPublicId, _id, 'replaced_photo');
  }
  return { ok: true };
}

/** Removes the account's photo: the record first, then the stored file. */
async function removeProfilePhoto(db, { userId, deleteImage, now = new Date() }) {
  const _id = new ObjectId(String(userId));
  const users = db.collection('users');
  const user = await users.findOne({ _id }, { projection: { profilePhoto: 1, profilePhotoPublicId: 1 } });
  if (!user) return { ok: false, status: 404, error: 'Account not found', code: 'not_found' };
  if (!user.profilePhoto && !user.profilePhotoPublicId) return { ok: true, removed: false };

  const updated = await users.updateOne(
    { _id, profilePhotoPublicId: storedValue(user.profilePhotoPublicId) },
    { $unset: { profilePhoto: '', profilePhotoPublicId: '', profilePhotoData: '' }, $set: { updatedAt: now } }
  );
  if (!updated.matchedCount) {
    return { ok: false, status: 409, error: 'Your photo was changed somewhere else at the same time. Try again.', code: 'concurrent_change' };
  }
  if (user.profilePhotoPublicId) await deleteQuietly(deleteImage, user.profilePhotoPublicId, _id, 'removed_photo');
  return { ok: true, removed: true };
}

module.exports = { MAX_EMBEDDED_BYTES, currentPhotoId, embeddedPhoto, photoDeleter, readEmbeddedPhoto, removeProfilePhoto, replaceProfilePhoto };
