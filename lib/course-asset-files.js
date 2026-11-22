'use strict';

/**
 * Course files uploaded in the builder (documents, spreadsheets, slides, PDFs, video): which types
 * are accepted and whether a file's bytes match its name. Pure, for the upload route and tests.
 *
 * A file is accepted only when its extension is on the list below AND its first bytes match that
 * format (a renamed executable or HTML page is refused). Active content (HTML, SVG, scripts) is
 * never accepted. Images for lesson content keep their own route (/api/upload/instructor).
 */

const MB = 1024 * 1024;

const TYPES = Object.freeze({
  pdf: { kind: 'pdf', mime: 'application/pdf', sig: 'pdf', max: 25 * MB },
  doc: { kind: 'doc', mime: 'application/msword', sig: 'ole', max: 25 * MB },
  docx: { kind: 'doc', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: 'zip', max: 25 * MB },
  odt: { kind: 'doc', mime: 'application/vnd.oasis.opendocument.text', sig: 'zip', max: 25 * MB },
  rtf: { kind: 'doc', mime: 'application/rtf', sig: 'rtf', max: 10 * MB },
  xls: { kind: 'sheet', mime: 'application/vnd.ms-excel', sig: 'ole', max: 25 * MB },
  xlsx: { kind: 'sheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: 'zip', max: 25 * MB },
  ods: { kind: 'sheet', mime: 'application/vnd.oasis.opendocument.spreadsheet', sig: 'zip', max: 25 * MB },
  csv: { kind: 'sheet', mime: 'text/csv', sig: 'text', max: 10 * MB },
  ppt: { kind: 'slides', mime: 'application/vnd.ms-powerpoint', sig: 'ole', max: 25 * MB },
  pptx: { kind: 'slides', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sig: 'zip', max: 25 * MB },
  odp: { kind: 'slides', mime: 'application/vnd.oasis.opendocument.presentation', sig: 'zip', max: 25 * MB },
  txt: { kind: 'text', mime: 'text/plain', sig: 'text', max: 5 * MB },
  md: { kind: 'text', mime: 'text/markdown', sig: 'text', max: 5 * MB },
  zip: { kind: 'archive', mime: 'application/zip', sig: 'zip', max: 25 * MB },
  mp4: { kind: 'video', mime: 'video/mp4', sig: 'iso', max: 100 * MB },
  m4v: { kind: 'video', mime: 'video/mp4', sig: 'iso', max: 100 * MB },
  mov: { kind: 'video', mime: 'video/quicktime', sig: 'iso', max: 100 * MB },
  webm: { kind: 'video', mime: 'video/webm', sig: 'ebml', max: 100 * MB },
});

const MAX_UPLOAD_BYTES = 100 * MB;
const MAX_COURSE_ASSETS = 300;
const NAME_MAX = 160;

function extensionOf(name) {
  const base = String(name || '').toLowerCase().split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

function startsWith(head, bytes, offset = 0) {
  if (!head || head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (head[offset + i] !== bytes[i]) return false;
  return true;
}

/** Whether `head` (the first bytes, at least 16; 4 KB is better for text) matches a signature. */
function matchesSignature(sig, head) {
  switch (sig) {
    case 'pdf': return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'ole': return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'zip': return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case 'rtf': return startsWith(head, [0x7b, 0x5c, 0x72, 0x74, 0x66]); // {\rtf
    case 'iso': return startsWith(head, [0x66, 0x74, 0x79, 0x70], 4); // ....ftyp
    case 'ebml': return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'text': {
      if (!head || !head.length) return false;
      const sample = head.subarray ? head.subarray(0, 4096) : head.slice(0, 4096);
      for (const byte of sample) if (byte === 0) return false; // binary
      const textHead = Buffer.from(sample).toString('utf8').trimStart().slice(0, 64).toLowerCase();
      // Text files must not be web pages or scripts in disguise.
      return !/^(<!doctype|<html|<script|<svg|<\?xml)/.test(textHead);
    }
    default: return false;
  }
}

/** A display name safe to store and show: no path, no control characters, bounded length. */
function cleanFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'file';
  if (cleaned.length <= NAME_MAX) return cleaned;
  const ext = extensionOf(cleaned);
  return `${cleaned.slice(0, NAME_MAX - ext.length - 2)}…${ext ? `.${ext}` : ''}`;
}

/**
 * Checks one uploaded file: { name, size, head } where head is its first bytes.
 * Returns { ok, ext, kind, mime, name } or { ok: false, status, code, error }.
 */
function checkCourseFile({ name, size, head }) {
  const ext = extensionOf(name);
  const type = TYPES[ext];
  if (!type) {
    return { ok: false, status: 415, code: 'unsupported_type', error: 'This file type is not supported. Upload a PDF, Word, Excel, PowerPoint, OpenDocument, CSV, text, ZIP or MP4/MOV/WebM video file.' };
  }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, status: 400, code: 'empty_file', error: 'The file is empty.' };
  if (size > type.max) {
    return { ok: false, status: 413, code: 'file_too_large', error: `${ext.toUpperCase()} files can be at most ${Math.round(type.max / MB)} MB.` };
  }
  if (!matchesSignature(type.sig, head)) {
    return { ok: false, status: 415, code: 'content_mismatch', error: `This file is not a valid ${ext.toUpperCase()} file. It may be damaged or renamed.` };
  }
  return { ok: true, ext, kind: type.kind, mime: type.mime, name: cleanFileName(name) };
}

/** The accept attribute for the builder's file picker. */
function acceptAttribute(kind = 'file') {
  return Object.entries(TYPES)
    .filter(([, t]) => (kind === 'video' ? t.kind === 'video' : t.kind !== 'video'))
    .map(([ext]) => `.${ext}`)
    .join(',');
}

module.exports = { MAX_COURSE_ASSETS, MAX_UPLOAD_BYTES, TYPES, acceptAttribute, checkCourseFile, cleanFileName, extensionOf, matchesSignature };
