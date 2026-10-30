'use strict';

/**
 * Profile photo lifecycle (POST/DELETE /api/upload/profile). The account record is changed only if
 * it still holds the photo that was read before the upload, so two uploads at once cannot leave
 * one of them stored but unreferenced. A new upload that cannot be recorded is deleted again; an
 * old photo is deleted only after the record points away from it, so a failed update never loses
 * the photo in use. Storage deletions are awaited (not fire-and-forget) and a failure is logged
 * by account id; Cloudinary deletes are idempotent, so the cleanup can be repeated.
 */

const { ObjectId } = require('mongodb');

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
      { $set: { profilePhoto: upload.secureUrl, profilePhotoPublicId: upload.publicId, updatedAt: now } }
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
    { $unset: { profilePhoto: '', profilePhotoPublicId: '' }, $set: { updatedAt: now } }
  );
  if (!updated.matchedCount) {
    return { ok: false, status: 409, error: 'Your photo was changed somewhere else at the same time. Try again.', code: 'concurrent_change' };
  }
  if (user.profilePhotoPublicId) await deleteQuietly(deleteImage, user.profilePhotoPublicId, _id, 'removed_photo');
  return { ok: true, removed: true };
}

module.exports = { currentPhotoId, removeProfilePhoto, replaceProfilePhoto };
