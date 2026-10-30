/**
 * HTML Sanitization Utility
 * Sanitizes user-generated HTML content to prevent XSS attacks
 * Whitelists safe HTML tags and removes dangerous attributes
 */

// DOMPurify-like sanitizer for server and client-side use
// This is a simplified version - for production, consider using the full DOMPurify library

import { stripVisualAidsForStudentHtml } from '@/lib/strip-visual-aids-html';

interface SanitizeOptions {
  allowedTags?: string[];
  allowedAttributes?: string[];
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

const DEFAULT_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'title'],
  table: ['border', 'cellpadding', 'cellspacing'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  div: ['class'],
  span: ['class'],
  'figure': ['class'],
  'figcaption': ['class'],
};

/**
 * Sanitize HTML content
 * Removes dangerous tags and attributes
 * @param html - Raw HTML string
 * @param options - Sanitization options
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(
  html: string,
  options: SanitizeOptions = {}
): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const allowedTags = options.allowedTags || DEFAULT_ALLOWED_TAGS;
  const allowedAttributes = options.allowedAttributes || DEFAULT_ALLOWED_ATTRIBUTES;

  // Parse HTML using DOMParser if available (client-side)
  if (typeof window !== 'undefined' && window.DOMParser) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      sanitizeElement(
        doc.documentElement,
        allowedTags,
        allowedAttributes as Record<string, string[]>
      );
      return doc.body.innerHTML;
    } catch (error) {
      console.error('Error parsing HTML:');
      return escapeHtml(html);
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
 * Sanitize HTML element recursively (client-side)
 */
export function sanitizeElement(
  element: Element,
  allowedTags: string[],
  allowedAttributes: Record<string, string[]>
): void {
  // A snapshot, not the live `children` list: replacing a child shifts the live list, which made
  // the loop skip the element after every removed one (so `<b>x</b><img onerror=...>` could keep
  // its handler when the first element was removed).
  for (const child of Array.from(element.children)) {
    const tagName = child.tagName.toLowerCase();

    if (!allowedTags.includes(tagName)) {
      // Remove tag but keep text content
      const textNode = document.createTextNode(child.textContent || '');
      child.parentNode?.replaceChild(textNode, child);
    } else {
      // Remove disallowed attributes
      const allowedAttrs = allowedAttributes[tagName] || [];
      const attrsToRemove = Array.from(child.attributes).filter(
        attr => !allowedAttrs.includes(attr.name) && 
                 !attr.name.startsWith('data-')
      );

      attrsToRemove.forEach(attr => {
        child.removeAttribute(attr.name);
      });

      // Sanitize URLs in href and src
      const href = child.getAttribute('href');
      const src = child.getAttribute('src');

      if (href && !isValidUrl(href)) {
        child.removeAttribute('href');
      }
      if (src && !isValidUrl(src)) {
        child.removeAttribute('src');
      }

      // Special handling for target attribute - only allow _blank, _self, _parent, _top
      const target = child.getAttribute('target');
      if (target && !['_blank', '_self', '_parent', '_top'].includes(target)) {
        child.removeAttribute('target');
      }
      // A link opened in a new tab must not get a handle on this page (window.opener).
      if (tagName === 'a' && child.getAttribute('target') === '_blank') {
        child.setAttribute('rel', 'noopener noreferrer');
      }

      // Recursively sanitize children
      sanitizeElement(child, allowedTags, allowedAttributes as Record<string, string[]>);
    }
  }
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
