'use strict';

/**
 * Display-size delivery for Cloudinary images.
 *
 * Course thumbnails are stored as the original upload URL, which can be several megabytes.
 * Inserting a transformation asks Cloudinary for a resized, automatically compressed copy in
 * the best format the browser accepts (WebP/AVIF). URLs that already carry a transformation,
 * and any non-Cloudinary URL, are returned unchanged.
 */
const UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;
// The first path segment after /upload/ is a transformation when it looks like "w_400,c_fill".
const TRANSFORMATION = /^[a-z]{1,3}_[^/]*$/;

function cloudinaryDisplayUrl(url, width = 960) {
  if (typeof url !== 'string') return url;
  const match = url.match(UPLOAD);
  if (!match) return url;
  const [, prefix, rest] = match;
  const firstSegment = rest.split('/')[0];
  if (TRANSFORMATION.test(firstSegment)) return url;
  return `${prefix}f_auto,q_auto,c_limit,w_${Math.round(width)}/${rest}`;
}

module.exports = { cloudinaryDisplayUrl };
