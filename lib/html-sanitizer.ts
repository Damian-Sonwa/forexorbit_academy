/**
 * HTML sanitization for user-authored course and lesson content (instructor rich text).
 *
 * In the browser the fragment is cleaned by DOMPurify against an explicit allowlist: tags below,
 * per-tag attributes below, links and images limited to http(s), mailto, tel and relative URLs
 * (`isValidUrl`). DOMPurify parses the string as body content, so the result is the cleaned
 * fragment itself, never a whole document.
 *
 * Without a DOM (server rendering) nothing is trusted: markup is escaped and shown as text.
 */

import DOMPurify from 'dompurify';
import type { DOMPurify as DOMPurifyInstance } from 'dompurify';
import { stripVisualAidsForStudentHtml } from '@/lib/strip-visual-aids-html';

interface SanitizeOptions {
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
  allowDataAttributes?: boolean;
}

const DEFAULT_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'strike', 's',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'img', 'figure', 'figcaption',
  'table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot',
  'blockquote', 'pre', 'code', 'hr',
  'div', 'span',
  'sub', 'sup',
];

/** Quill (the editor) keeps alignment and indentation as `ql-*` classes on text blocks. */
const BLOCK_CLASS = ['class'];

const DEFAULT_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'title'],
  table: ['border', 'cellpadding', 'cellspacing'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  div: BLOCK_CLASS,
  span: BLOCK_CLASS,
  figure: BLOCK_CLASS,
  figcaption: BLOCK_CLASS,
  p: BLOCK_CLASS,
  h1: BLOCK_CLASS, h2: BLOCK_CLASS, h3: BLOCK_CLASS, h4: BLOCK_CLASS, h5: BLOCK_CLASS, h6: BLOCK_CLASS,
  li: BLOCK_CLASS, ol: BLOCK_CLASS, ul: BLOCK_CLASS,
  blockquote: BLOCK_CLASS, pre: BLOCK_CLASS,
};

const LINK_TARGETS = ['_blank', '_self', '_parent', '_top'];
const URL_ATTRIBUTES = new Set(['href', 'src']);

/** Rules for the call in progress; DOMPurify hooks are registered once per instance. */
let active: { attributes: Record<string, string[]>; allowData: boolean } = {
  attributes: DEFAULT_ALLOWED_ATTRIBUTES,
  allowData: true,
};

let purifier: DOMPurifyInstance | null = null;
let purifierWindow: unknown = null;

function browserPurifier(): DOMPurifyInstance | null {
  if (typeof window === 'undefined' || !window.document) return null;
  if (purifier && purifierWindow === window) return purifier;
  const instance = DOMPurify(window as unknown as Window & typeof globalThis);
  if (!instance.isSupported) return null;
  instance.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName.toLowerCase();
    const name = data.attrName;
    const isData = name.startsWith('data-');
    const allowed = isData ? active.allowData : (active.attributes[tag] || []).includes(name);
    if (!allowed) {
      data.keepAttr = false;
      return;
    }
    // DOMPurify's own URI check allows data: images and a few extra schemes; this policy does not.
    if (URL_ATTRIBUTES.has(name) && !isValidUrl(data.attrValue)) data.keepAttr = false;
    if (name === 'target' && !LINK_TARGETS.includes(data.attrValue)) data.keepAttr = false;
  });
  instance.addHook('afterSanitizeAttributes', (node) => {
    // A link opened in a new tab must not get a handle on this page (window.opener).
    if (node.nodeName.toLowerCase() === 'a' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  purifier = instance;
  purifierWindow = window;
  return instance;
}

/**
 * Sanitize an HTML fragment. Disallowed elements are removed but their text is kept (script,
 * style and similar lose their content too); disallowed attributes and unsafe URLs are removed.
 */
export function sanitizeHtml(
  html: string,
  options: SanitizeOptions = {}
): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const instance = browserPurifier();
  if (instance) {
    const allowedTags = options.allowedTags || DEFAULT_ALLOWED_TAGS;
    const attributes = options.allowedAttributes || DEFAULT_ALLOWED_ATTRIBUTES;
    const everyAttribute = Array.from(new Set(Object.values(attributes).flat()));
    active = { attributes, allowData: options.allowDataAttributes !== false };
    try {
      return String(instance.sanitize(html, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: everyAttribute,
        ALLOW_DATA_ATTR: active.allowData,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        RETURN_TRUSTED_TYPE: false,
      }));
    } catch {
      console.error('Error sanitizing HTML');
      return escapeHtml(html);
    } finally {
      active = { attributes: DEFAULT_ALLOWED_ATTRIBUTES, allowData: true };
    }
  }

  // Without a DOM (server rendering) the allowlist cannot be applied reliably, so markup is shown
  // as text rather than trusted. Pages here load lesson and course HTML in the browser, so the
  // server only ever sees their empty initial state; a page that rendered HTML on the server would
  // show it escaped (safe) instead of unsanitized.
  return escapeHtml(html);
}

/**
 * Student-facing HTML: XSS sanitization, legacy "Visual aids" labels, and visual-aids upload images removed.
 * Use for course/lesson display; keep `sanitizeHtml` for instructor previews and generic fields
 * so editor/source parity is unchanged outside student views.
 */
export function sanitizeForStudentView(
  html: string,
  options: SanitizeOptions = {}
): string {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return sanitizeHtml(stripVisualAidsForStudentHtml(html), options);
}

/**
 * Check if URL is valid and safe
 */
export function isValidUrl(url: string): boolean {
  if (!url) return false;

  // Browsers ignore whitespace and control characters inside a scheme ("java\tscript:"), so
  // compare without them. Only http, https, mailto and tel are allowed; relative URLs (no scheme)
  // are allowed; every other scheme (javascript:, data:, vbscript:, file:, ...) is refused.
  const compact = url.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(compact);
  if (!scheme) return true;
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1]);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Strip all HTML tags and return plain text
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return stripVisualAidsForStudentHtml(html).replace(/<[^>]*>/g, '').trim();
}

export default sanitizeHtml;
