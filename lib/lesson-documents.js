'use strict';

/**
 * Lesson documents (the lesson PDF and its resources) for students (Phase 7).
 *
 * Lesson documents are links the instructor stores on the lesson (`pdfUrl`, `resources[].url`);
 * the app has no document upload. Students do not receive those stored URLs in lesson JSON.
 * Each document is offered as an app path, GET /api/lessons/:id/document?item=<item>, which runs
 * the full lesson read rule (account, enrollment, course state, Phase 6 paywall) on every
 * request and only then redirects to the stored link. A revoked or expired entitlement therefore
 * stops working links straight away, and the stored storage URL never sits in a cached lesson
 * response.
 *
 * Items: "pdf" for the lesson PDF, "r0", "r1", ... for resources in stored order.
 * Pure functions; the route is pages/api/lessons/[id]/document.ts.
 */

const { safeLinkUrl } = require('./safe-url');

const ITEM_PATTERN = /^(pdf|r(0|[1-9]\d{0,2}))$/;
const KNOWN_TYPES = Object.freeze(['pdf', 'link', 'slide', 'doc', 'video', 'file']);

function isDocumentItem(value) {
  return typeof value === 'string' && ITEM_PATTERN.test(value);
}

function documentPath(lessonId, item) {
  return `/api/lessons/${encodeURIComponent(String(lessonId))}/document?item=${item}`;
}

/** Only absolute http(s) links are served; anything else is reported as unavailable. */
function deliverableUrl(value) {
  return safeLinkUrl(value, { allowRelative: false });
}

function documentType(declared, url) {
  const type = typeof declared === 'string' ? declared.trim().toLowerCase() : '';
  if (KNOWN_TYPES.includes(type)) return type;
  if (typeof url === 'string' && /\.pdf(?:$|[?#])/i.test(url)) return 'pdf';
  return 'file';
}

/** The stored link for one item of a lesson the caller may read, or null. */
function resolveLessonDocument(lesson, item) {
  if (!lesson || typeof lesson !== 'object' || !isDocumentItem(item)) return null;
  if (item === 'pdf') return deliverableUrl(lesson.pdfUrl);
  const index = Number(item.slice(1));
  const list = Array.isArray(lesson.resources) ? lesson.resources : [];
  const entry = list[index];
  return entry && typeof entry === 'object' ? deliverableUrl(entry.url) : null;
}

/**
 * Student view of a lesson's documents: stored URLs are replaced by the gated app path, and a
 * link that cannot be served is marked unavailable instead of being rendered. Changes `view`.
 */
function presentStudentDocuments(view) {
  if (!view || typeof view !== 'object') return view;
  const lessonId = view._id != null ? String(view._id) : view.id != null ? String(view.id) : '';
  if (!lessonId) return view;
  if (typeof view.pdfUrl === 'string' && view.pdfUrl.trim()) {
    const ok = Boolean(deliverableUrl(view.pdfUrl));
    view.pdfUrl = ok ? documentPath(lessonId, 'pdf') : null;
    view.pdfAvailable = ok;
  } else if (view.pdfUrl !== undefined) {
    view.pdfUrl = null;
  }
  if (Array.isArray(view.resources)) {
    view.resources = view.resources.map((entry, index) => {
      const source = entry && typeof entry === 'object' ? entry : {};
      const raw = typeof source.url === 'string' ? source.url : '';
      const ok = Boolean(deliverableUrl(raw));
      return {
        title: typeof source.title === 'string' ? source.title : '',
        type: documentType(source.type, raw),
        url: ok ? documentPath(lessonId, `r${index}`) : null,
        available: ok,
      };
    });
  }
  return view;
}

/** Response headers for any lesson content or document response: per user, never stored. */
function setPrivateNoStore(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie');
}

module.exports = {
  documentPath,
  documentType,
  isDocumentItem,
  presentStudentDocuments,
  resolveLessonDocument,
  setPrivateNoStore,
};
