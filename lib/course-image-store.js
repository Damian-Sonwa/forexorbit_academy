'use strict';

/**
 * Built-in image storage: lesson and cover images kept in the app's own MongoDB database, so image
 * uploads work with no storage service and no API keys. Used when neither Cloudflare R2 nor
 * Cloudinary is set up (lib/course-image-upload.ts picks R2, then Cloudinary, then this).
 *
 * The browser shrinks images before upload (components/builder/image-prepare.ts: at most 1920 px,
 * WebP), so a typical chart or screenshot is 100-400 KB. One document per image in the
 * `courseImages` collection: { _id (random, 32 hex), mime, bytes (Binary), size, folder, ownerId,
 * createdAt }. Lookups are by _id only, so no index is needed. Images are served publicly by
 * pages/api/course-images/[file].ts like images on Cloudinary or R2: the name is random and
 * cannot be guessed, and an image never changes once stored (long cache).
 *
 * The app's database user must be allowed to use the courseImages collection. Where the Atlas
 * role lists collections one by one, a store without that permission fails with a clear message
 * (STORE_NOT_PERMITTED) instead of a generic error.
 */

const crypto = require('crypto');
const { Binary } = require('mongodb');

const COLLECTION = 'courseImages';
const MAX_STORED_BYTES = 4 * 1024 * 1024;
const ID = /^[a-f0-9]{32}$/;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

class ImageStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isPermissionError(error) {
  return Boolean(error && (error.code === 13 || error.codeName === 'Unauthorized' || /not authorized/i.test(String(error.message || ''))));
}

function imagePath(id, mime) {
  return `/api/course-images/${id}.${EXT[mime] || 'img'}`;
}

/** Stores the image and returns its public path on this site. */
async function storeImage(db, { bytes, mime, ownerId, folder }) {
  if (!EXT[mime]) throw new ImageStoreError('BAD_TYPE', 'Only JPEG, PNG, GIF and WebP images can be stored.');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new ImageStoreError('EMPTY', 'The image is empty.');
  if (bytes.length > MAX_STORED_BYTES) {
    throw new ImageStoreError('TOO_LARGE', `This image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB after resizing. Images stored in the app can be up to 4 MB: make it smaller and try again.`);
  }
  const id = crypto.randomBytes(16).toString('hex');
  try {
    await db.collection(COLLECTION).insertOne({ _id: id, mime, bytes: new Binary(bytes), size: bytes.length, folder: String(folder || ''), ownerId: String(ownerId || ''), createdAt: new Date() });
  } catch (error) {
    if (isPermissionError(error)) {
      throw new ImageStoreError('STORE_NOT_PERMITTED', 'Saving images in the app is not switched on yet: the database user needs access to the courseImages collection. Paste a link to the image instead for now.');
    }
    throw error;
  }
  return { id, url: imagePath(id, mime), size: bytes.length };
}

/** The stored image for a public path segment such as "<id>.webp", or null. */
async function readImage(db, file) {
  const id = String(file || '').replace(/\.[a-z]{3,4}$/i, '');
  if (!ID.test(id)) return null;
  const doc = await db.collection(COLLECTION).findOne({ _id: id }, { projection: { mime: 1, bytes: 1, size: 1 } });
  if (!doc || !doc.bytes) return null;
  const buffer = Buffer.isBuffer(doc.bytes) ? doc.bytes : Buffer.from(doc.bytes.buffer || doc.bytes);
  return { id, mime: doc.mime, bytes: buffer };
}

module.exports = { COLLECTION, MAX_STORED_BYTES, ImageStoreError, imagePath, isPermissionError, readImage, storeImage };
