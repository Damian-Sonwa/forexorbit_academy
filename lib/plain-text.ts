/**
 * Plain-text previews of stored HTML (course and lesson descriptions on cards).
 * stripHtml removes tags but leaves entities such as &amp; encoded, which then show up
 * literally in the UI. React escapes the result again when rendering, so decoding here is safe.
 */
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Student-safe plain text from a stored HTML description, for one-line or clamped previews. */
export function previewText(html: string | null | undefined): string {
  return decodeHtmlEntities(stripHtml(sanitizeForStudentView(html || '')))
    .replace(/\s+/g, ' ')
    .trim();
}
