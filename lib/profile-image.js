'use strict';

/**
 * Re-encodes an uploaded profile photo on the server: decoded in full, turned upright, cropped to a
 * square of at most 400 px and written as a new WebP. Whatever else was in the file (location and
 * camera data, colour profiles, trailing bytes, animation) does not survive, even when the upload
 * did not come from the app. Only JPEG, PNG, GIF and WebP are decoded, and the pixel limit stops a
 * small file that expands into a huge picture.
 */

const sharp = require('sharp');
const { detectImage } = require('./course-asset-files');

const SIDE = 400;
const MAX_PIXELS = 50_000_000;
const BAD_IMAGE = 'This file is not a valid JPEG, PNG, GIF or WebP image.';

/** Resolves to { ok: true, bytes, mime, ext } or { ok: false, status: 400, error }. */
async function reencodeProfileImage(input) {
  if (!Buffer.isBuffer(input) || !detectImage(input.subarray(0, 16))) return { ok: false, status: 400, error: BAD_IMAGE };
  try {
    const bytes = await sharp(input, { limitInputPixels: MAX_PIXELS, animated: false })
      .rotate()
      .resize(SIDE, SIDE, { fit: 'cover', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 84 })
      .toBuffer();
    return { ok: true, bytes, mime: 'image/webp', ext: 'webp' };
  } catch {
    return { ok: false, status: 400, error: BAD_IMAGE };
  }
}

module.exports = { MAX_PIXELS, SIDE, reencodeProfileImage };
