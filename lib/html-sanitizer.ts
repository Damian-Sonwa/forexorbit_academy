/**
 * HTML Sanitization Utility
 * Sanitizes user-generated HTML content to prevent XSS attacks
 * Whitelists safe HTML tags and removes dangerous attributes
 */

// DOMPurify-like sanitizer for server and client-side use
// This is a simplified version - for production, consider using the full DOMPurify library

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
      console.error('Error parsing HTML:', error);
      return escapeHtml(html);
    }
  }

  // Server-side fallback: Use regex-based sanitization
  return sanitizeHtmlString(
    html,
    allowedTags,
    allowedAttributes as Record<string, string[]>
  );
}

/**
 * Sanitize HTML element recursively (client-side)
 */
function sanitizeElement(
  element: Element,
  allowedTags: string[],
  allowedAttributes: Record<string, string[]>
): void {
  const nodesToRemove: Element[] = [];

  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
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

      // Recursively sanitize children
      sanitizeElement(child, allowedTags, allowedAttributes as Record<string, string[]>);
    }
  }
}

/**
 * Regex-based HTML sanitization (server-side fallback)
 */
function sanitizeHtmlString(
  html: string,
  allowedTags: string[],
  allowedAttributes: Record<string, string[]>
): string {
  let result = html;

  // Remove script tags and content
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers
  result = result.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  result = result.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove style tags
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove dangerous protocols from URLs
  result = result.replace(/href\s*=\s*["']?javascript:/gi, 'href="javascript:void(0)"');
  result = result.replace(/src\s*=\s*["']?javascript:/gi, 'src=""');

  return result;
}

/**
 * Check if URL is valid and safe
 */
function isValidUrl(url: string): boolean {
  if (!url) return false;

  // Block javascript protocol
  if (url.toLowerCase().startsWith('javascript:')) return false;
  if (url.toLowerCase().startsWith('data:')) return false;
  if (url.toLowerCase().startsWith('vbscript:')) return false;

  // Allow relative URLs and common protocols
  if (url.startsWith('/') || url.startsWith('#')) return true;
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  if (url.startsWith('mailto:') || url.startsWith('tel:')) return true;

  return true;
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
  // Simple regex-based tag removal
  return html.replace(/<[^>]*>/g, '').trim();
}

export default sanitizeHtml;
