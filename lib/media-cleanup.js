'use strict';

/**
 * Removal of course images that are no longer used (Phase 4, Decision 6 / audit L2).
 *
 * Only images in this app's own Cloudinary account and in the two course-content folders are
 * ever considered: `forexorbit/instructors` (rich-text lesson and course images, and instructor
 * profile photos) and `forexorbit/visual-aids`. Profile photos of accounts (`forexorbit/profiles`)
 * and any other host are never touched.
 *
 * An image is deleted only when no stored record still refers to it: lessons (every text and link
 * field), courses (description, thumbnail) and instructor profiles (`imageUrl`) are searched for
 * its public id first. These are the only places the upload routes' URLs are saved.
 *
 * Deleting is off until the owner turns it on: with MEDIA_CLEANUP unset the candidates are only
 * logged ("report"); MEDIA_CLEANUP=delete deletes them. A storage failure never fails the request
 * that triggered it; it is logged with the public id so the cleanup can be repeated.
 */

const CLEANUP_FOLDERS = Object.freeze(['forexorbit/instructors/', 'forexorbit/visual-aids/']);
const TRANSFORMATION = /^[a-z]{1,3}_[^/]*$/;
const VERSION = /^v\d+$/;
const CLOUDINARY_URL = /https?:\/\/res\.cloudinary\.com\/([A-Za-z0-9_-]+)\/image\/upload\/([^\s"'<>()?#]+)/g;

const LESSON_TEXT_FIELDS = Object.freeze(['content', 'description', 'summary', 'title', 'lessonSummary.overview', 'videoUrl', 'pdfUrl', 'resources.url']);
const REFERENCE_FIELDS = Object.freeze({
  lessons: LESSON_TEXT_FIELDS,
  courses: Object.freeze(['description', 'thumbnail']),
  instructors: Object.freeze(['imageUrl', 'description']),
});

function cleanupMode(env = process.env) {
  return String(env.MEDIA_CLEANUP || '').trim().toLowerCase() === 'delete' ? 'delete' : 'report';
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Public ids of this account's course-content images referenced in `text` (HTML or a URL). */
function courseAssetIds(text, env = process.env) {
  const cloud = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  if (!cloud || typeof text !== 'string' || !text) return [];
  const ids = new Set();
  for (const match of text.matchAll(CLOUDINARY_URL)) {
    if (match[1] !== cloud) continue;
    const segments = match[2].split('/');
    while (segments.length && (TRANSFORMATION.test(segments[0]) || VERSION.test(segments[0]))) {
      segments.shift();
    }
    const path = decodeURIComponent(segments.join('/')).replace(/\.[A-Za-z0-9]{2,5}$/, '');
    if (CLEANUP_FOLDERS.some((folder) => path.startsWith(folder) && path.length > folder.length)) ids.add(path);
  }
  return [...ids];
}

function valuesAt(doc, dotted) {
  const [head, ...rest] = dotted.split('.');
  const value = doc ? doc[head] : undefined;
  if (!rest.length) return Array.isArray(value) ? value : [value];
  if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, rest.join('.')));
  return valuesAt(value, rest.join('.'));
}

/** Every course-content image id referenced by these lesson or course documents. */
function assetsInDocuments(documents, fields = LESSON_TEXT_FIELDS, env = process.env) {
  const ids = new Set();
  for (const doc of documents || []) {
    for (const field of fields) {
      for (const value of valuesAt(doc, field)) {
        for (const id of courseAssetIds(value, env)) ids.add(id);
      }
    }
  }
  return [...ids];
}

/** Ids that were referenced `before` an edit and are not referenced `after` it. */
function removedAssets(before, after, fields = LESSON_TEXT_FIELDS, env = process.env) {
  const kept = new Set(assetsInDocuments(after ? [after] : [], fields, env));
  return assetsInDocuments(before ? [before] : [], fields, env).filter((id) => !kept.has(id));
}

/** Whether any stored lesson, course or instructor profile still refers to the image. */
async function isAssetReferenced(db, publicId) {
  const pattern = { $regex: escapeRegex(publicId) };
  for (const [collection, fields] of Object.entries(REFERENCE_FIELDS)) {
    const found = await db.collection(collection).findOne(
      { $or: fields.map((field) => ({ [field]: pattern })) },
      { projection: { _id: 1 } }
    );
    if (found) return true;
  }
  return false;
}

/**
 * Deletes (or, in report mode, lists) the given images that nothing refers to any more. Call
 * after the database change that dropped the references has succeeded.
 */
async function cleanupUnreferencedAssets(db, publicIds, { destroy, env = process.env, context = {} } = {}) {
  const mode = cleanupMode(env);
  const result = { mode, deleted: [], kept: [], failed: [], candidates: [] };
  for (const publicId of [...new Set(publicIds || [])]) {
    try {
      if (await isAssetReferenced(db, publicId)) {
        result.kept.push(publicId);
        continue;
      }
      if (mode !== 'delete' || typeof destroy !== 'function') {
        result.candidates.push(publicId);
        continue;
      }
      await destroy(publicId);
      result.deleted.push(publicId);
    } catch {
      result.failed.push(publicId);
    }
  }
  if (result.candidates.length || result.deleted.length || result.failed.length) {
    console.log(JSON.stringify({
      event: 'mediaCleanup',
      mode,
      ...context,
      deleted: result.deleted,
      failed: result.failed,
      unreferenced: result.candidates,
    }));
  }
  return result;
}

module.exports = {
  CLEANUP_FOLDERS,
  LESSON_TEXT_FIELDS,
  REFERENCE_FIELDS,
  assetsInDocuments,
  cleanupMode,
  cleanupUnreferencedAssets,
  courseAssetIds,
  isAssetReferenced,
  removedAssets,
};
