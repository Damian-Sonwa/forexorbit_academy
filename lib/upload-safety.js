'use strict';

/**
 * Containment for chat attachments (community and consultation messages), which are written under
 * public/uploads and so would be served from the site's own origin. A file that a browser runs or
 * renders as a page (HTML, SVG, scripts, XML) could then read the session token from localStorage.
 * Those types are refused; everything else the chats accept (images, video, audio, documents) is
 * unchanged. Stored names are random (128 bits), so an attachment's address cannot be guessed.
 * This does not decide where attachments should live; see docs/audits/phase-1-3-remediation.md.
 */

const crypto = require('crypto');
const path = require('path');

const ACTIVE_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.shtml', '.xht', '.mht', '.mhtml',
  '.svg', '.svgz', '.xml', '.xsl', '.xslt',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.wasm',
  '.php', '.asp', '.aspx', '.jsp', '.cgi', '.pl', '.py', '.sh', '.bat', '.cmd', '.exe', '.msi', '.dll', '.vbs', '.ps1',
  '.swf', '.hta', '.appcache', '.manifest', '.webmanifest',
]);

const ACTIVE_MIME = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript|application\/ecmascript|application\/wasm|application\/x-msdownload|application\/x-sh)\b/i;

/** The lower-cased extension of the original name ('' if none); a trailing dot or space counts. */
function extensionOf(originalFilename) {
  const name = String(originalFilename || '').trim().replace(/[.\s]+$/, '');
  return path.extname(name).toLowerCase();
}

/** True if the file must not be stored where it would be served from the site. */
function isActiveContent({ originalFilename, mimetype }) {
  const ext = extensionOf(originalFilename);
  if (ACTIVE_EXTENSIONS.has(ext)) return true;
  return typeof mimetype === 'string' && ACTIVE_MIME.test(mimetype.trim());
}

/** A random stored name that keeps the (already checked) extension. */
function storedFileName(originalFilename) {
  const ext = extensionOf(originalFilename);
  const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
  return `${crypto.randomBytes(16).toString('hex')}${safeExt}`;
}

module.exports = { ACTIVE_EXTENSIONS, isActiveContent, storedFileName };
