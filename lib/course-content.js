'use strict';

/**
 * Course content model (course builder).
 *
 * One authoritative representation, used by the builder, the preview and the student lesson page:
 *
 *   courses.modules   [{ id, title }] in display order. A course without modules (every course
 *                     before the builder) is shown as one implicit module, so nothing changes for it.
 *   lessons           unchanged collection; each lesson keeps courseId and `order` (the position in
 *                     the whole course, which progress, navigation, payments and certificates read).
 *                     New: `moduleId`, `blocks`, `revision`.
 *   lessons.blocks    the lesson body as an ordered list of typed blocks (below). Every block is
 *                     validated here on the server; nothing stores HTML. Rich text is a Quill Delta
 *                     (JSON text runs with an allowlist of formats), rendered to React elements.
 *
 * A lesson saved before the builder has no `blocks`; lessonBlocks() derives them from the legacy
 * fields (videoUrl, description, content, pdfUrl, resources), so the same renderer shows old and
 * new lessons. A `legacy` block points at a stored HTML field; it is shown through the existing
 * browser sanitizer and is the only way older HTML is displayed. New HTML cannot be stored.
 *
 * `order` stays equal to the flattened curriculum (module order, then lesson order within the
 * module): curriculumOrder() computes it and every curriculum change rewrites it, so every existing
 * reader of `order` sees the course in the same sequence as the builder.
 *
 * No database driver here: this module is also bundled for the browser.
 */

const { safeLinkUrl } = require('./safe-url');

const BLOCK_TYPES = Object.freeze(['heading', 'text', 'callout', 'image', 'video', 'file', 'link', 'code', 'table', 'divider', 'legacy']);
const COLUMN_ALIGNS = Object.freeze(['left', 'center', 'right']);
const IMAGE_SIZES = Object.freeze(['small', 'medium', 'full']);
const CALLOUT_TONES = Object.freeze(['info', 'tip', 'warning', 'key']);
const FILE_KINDS = Object.freeze(['pdf', 'doc', 'sheet', 'slides', 'text', 'archive', 'file']);
const LEGACY_FIELDS = Object.freeze(['description', 'content']);

const LIMITS = Object.freeze({
  blocks: 200,
  ops: 4000,
  textChars: 60000,
  insertChars: 20000,
  heading: 200,
  calloutTitle: 120,
  calloutText: 4000,
  alt: 300,
  caption: 300,
  tableRows: 60,
  tableCols: 10,
  tableCell: 500,
  linkTitle: 200,
  linkDescription: 500,
  code: 20000,
  codeLabel: 80,
  fileTitle: 200,
  url: 2000,
  modules: 100,
  moduleTitle: 200,
  objectives: 12,
  objective: 200,
  summary: 300,
  prerequisites: 1500,
});

const BLOCK_ID = /^[a-z0-9]{6,24}$/;
const MODULE_ID = /^[a-z0-9]{6,24}$/;
const ASSET_ID = /^[a-z0-9]{12,32}$/;
const IMPLICIT_MODULE_ID = 'course';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? null : trimmed;
}

function refuse(error, field = 'blocks', extra = {}) {
  return { ok: false, status: 400, code: 'invalid_content', field, error, ...extra };
}

const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" });

/**
 * Text without markup, for titles and other plain fields. Lessons and courses written with the
 * earlier rich-text editor can hold HTML in their titles (for example "<p>Pips</p>"); the builder
 * and lists show and edit the words only.
 */
function plainText(value) {
  if (typeof value !== 'string' || !value) return '';
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, code) => {
      const k = code.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k.startsWith('#x')) { const n = parseInt(k.slice(2), 16); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      if (k.startsWith('#')) { const n = parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Rich text (Quill Delta)
// ---------------------------------------------------------------------------

/** Formats with a fixed list of values. The renderer maps each to classes, never to a style. */
const TEXT_SIZES = Object.freeze(['small', 'large', 'huge']);
const TEXT_ALIGNS = Object.freeze(['center', 'right', 'justify']);
const TEXT_COLORS = Object.freeze(['#c24e00', '#a16207', '#172b45', '#1d4ed8', '#15803d', '#b91c1c', '#6b7280']);
const TEXT_HIGHLIGHTS = Object.freeze(['#fff3c4', '#ffe3cc', '#dcebfa', '#d9f5e3', '#fde0e0']);
const TEXT_SCRIPTS = Object.freeze(['sub', 'super']);
const INLINE_VALUES = Object.freeze({ size: TEXT_SIZES, color: TEXT_COLORS, background: TEXT_HIGHLIGHTS, script: TEXT_SCRIPTS });
const INLINE_FLAGS = Object.freeze(['bold', 'italic', 'underline', 'strike', 'code']);

/**
 * Checks and normalises a Delta. Unknown formats and values are dropped (paste can carry any colour or font);
 * embeds are dropped (images are image blocks). Returns { ok, ops, chars } or a refusal.
 */
function normalizeDelta(input) {
  const source = Array.isArray(input) ? input : isPlainObject(input) && Array.isArray(input.ops) ? input.ops : null;
  if (!source) return refuse('Text must be rich text content.');
  if (source.length > LIMITS.ops) return refuse('This text block is too long. Split it into several blocks.');
  const ops = [];
  let chars = 0;
  for (const op of source) {
    if (!isPlainObject(op) || typeof op.insert !== 'string' || op.insert === '') continue;
    if (op.insert.length > LIMITS.insertChars) return refuse('This text block is too long. Split it into several blocks.');
    chars += op.insert.length;
    if (chars > LIMITS.textChars) return refuse('This text block is too long. Split it into several blocks.');
    const attrs = {};
    const a = isPlainObject(op.attributes) ? op.attributes : {};
    const lineOnly = /^\n+$/.test(op.insert);
    if (lineOnly) {
      if (a.header === 2 || a.header === 3 || a.header === 4) attrs.header = a.header;
      if (a.list === 'ordered' || a.list === 'bullet') attrs.list = a.list;
      if (a.blockquote === true) attrs.blockquote = true;
      if (Number.isInteger(a.indent) && a.indent >= 1 && a.indent <= 4) attrs.indent = a.indent;
      if (TEXT_ALIGNS.includes(a.align)) attrs.align = a.align;
    } else {
      for (const flag of INLINE_FLAGS) if (a[flag] === true) attrs[flag] = true;
      for (const [key, allowed] of Object.entries(INLINE_VALUES)) if (allowed.includes(a[key])) attrs[key] = a[key];
      if (typeof a.link === 'string') {
        const url = a.link.length <= LIMITS.url ? safeLinkUrl(a.link) : null;
        if (url) attrs.link = url;
      }
    }
    const next = Object.keys(attrs).length ? { insert: op.insert, attributes: attrs } : { insert: op.insert };
    const prev = ops[ops.length - 1];
    // Adjacent runs with the same formats are merged, which keeps stored documents small.
    if (prev && !lineOnly && !/^\n+$/.test(prev.insert) && JSON.stringify(prev.attributes || {}) === JSON.stringify(next.attributes || {})) {
      prev.insert += next.insert;
    } else {
      ops.push(next);
    }
  }
  const last = ops[ops.length - 1];
  if (!last || !last.insert.endsWith('\n')) ops.push({ insert: '\n' });
  return { ok: true, ops, chars };
}

/** Plain text of a Delta (search, empty checks, word counts). */
function deltaText(ops) {
  return (Array.isArray(ops) ? ops : []).map((op) => (op && typeof op.insert === 'string' ? op.insert : '')).join('');
}

/**
 * A Delta as lines for rendering: [{ kind: 'p'|'h2'|'h3'|'h4'|'quote'|'li', list, indent, align, segments }].
 * Each segment is { text, bold, italic, underline, strike, code, size, color, background, script, link }. Pure; the React renderer
 * (components/course/RichText.tsx) only maps these to elements, so text is never parsed as HTML.
 */
function deltaToLines(ops) {
  const lines = [];
  let segments = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op.insert !== 'string') continue;
    const attrs = isPlainObject(op.attributes) ? op.attributes : {};
    const parts = op.insert.split('\n');
    parts.forEach((part, index) => {
      if (part) {
        const seg = { text: part };
        for (const flag of INLINE_FLAGS) if (attrs[flag] === true) seg[flag] = true;
        for (const [key, allowed] of Object.entries(INLINE_VALUES)) if (allowed.includes(attrs[key])) seg[key] = attrs[key];
        if (typeof attrs.link === 'string') seg.link = attrs.link;
        segments.push(seg);
      }
      if (index < parts.length - 1) {
        let kind = 'p';
        if (attrs.header === 2) kind = 'h2';
        else if (attrs.header === 3) kind = 'h3';
        else if (attrs.header === 4) kind = 'h4';
        else if (attrs.list === 'ordered' || attrs.list === 'bullet') kind = 'li';
        else if (attrs.blockquote === true) kind = 'quote';
        const line = { kind, segments };
        if (kind === 'li') line.list = attrs.list;
        if (Number.isInteger(attrs.indent)) line.indent = attrs.indent;
        if (TEXT_ALIGNS.includes(attrs.align)) line.align = attrs.align;
        lines.push(line);
        segments = [];
      }
    });
  }
  if (segments.length) lines.push({ kind: 'p', segments });
  // Trailing empty paragraphs (the editor always ends with one) are not shown.
  while (lines.length && lines[lines.length - 1].kind === 'p' && !lines[lines.length - 1].segments.length) lines.pop();
  return lines;
}

/** Lines grouped for rendering: consecutive list items of one list type become one list. */
function groupLines(lines) {
  const groups = [];
  for (const line of lines) {
    const prev = groups[groups.length - 1];
    if (line.kind === 'li') {
      if (prev && prev.kind === 'list' && prev.list === line.list) prev.items.push(line);
      else groups.push({ kind: 'list', list: line.list, items: [line] });
    } else {
      groups.push(line);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** A media source: an uploaded course asset (by id) or an http(s) link. */
function checkSource(block, { allowRelative = false } = {}) {
  if (typeof block.assetId === 'string' && block.assetId) {
    if (!ASSET_ID.test(block.assetId)) return { error: 'This file reference is not valid. Upload the file again.' };
    return { assetId: block.assetId };
  }
  if (typeof block.url === 'string' && block.url.trim()) {
    const url = block.url.length <= LIMITS.url ? safeLinkUrl(block.url.trim(), { allowRelative }) : null;
    if (!url) return { error: 'Links must start with https:// or http://.' };
    return { url };
  }
  return { empty: true };
}

function fileKindOf(name, declared) {
  if (FILE_KINDS.includes(declared)) return declared;
  const ext = String(name || '').toLowerCase().split('?')[0].split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
  if (['txt', 'md'].includes(ext)) return 'text';
  if (['zip'].includes(ext)) return 'archive';
  return 'file';
}

/**
 * One block, checked. Drafts may hold blocks that are not finished yet (an image without a file):
 * those are stored and reported by courseReadiness(), not refused, so autosave never loses work.
 */
function checkBlock(raw, index, { assetIds = null } = {}) {
  const at = `blocks.${index}`;
  if (!isPlainObject(raw)) return refuse('A content block is not valid.', at);
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!BLOCK_ID.test(id)) return refuse('A content block has no valid id.', at);
  const type = raw.type;
  if (!BLOCK_TYPES.includes(type)) return refuse('Unknown content block type.', at);
  const block = { id, type };
  const field = (value, max, label) => {
    const v = text(value, max);
    if (v === null) throw refuse(`${label} must be at most ${max} characters.`, at);
    return v;
  };
  try {
    switch (type) {
      case 'heading':
        block.text = field(raw.text, LIMITS.heading, 'A heading');
        block.level = raw.level === 3 ? 3 : 2;
        if (raw.align === 'center' || raw.align === 'right') block.align = raw.align;
        break;
      case 'text': {
        const delta = normalizeDelta(raw.ops === undefined ? [] : raw.ops);
        if (!delta.ok) return { ...delta, field: at };
        block.ops = delta.ops;
        break;
      }
      case 'callout':
        block.tone = CALLOUT_TONES.includes(raw.tone) ? raw.tone : 'info';
        block.title = field(raw.title, LIMITS.calloutTitle, 'A callout title');
        block.text = field(raw.text, LIMITS.calloutText, 'Callout text');
        break;
      case 'image': {
        const src = checkSource(raw, { allowRelative: true });
        if (src.error) return refuse(src.error, at);
        if (src.assetId) return refuse('Images are inserted by link after upload.', at);
        block.url = src.url || '';
        block.alt = field(raw.alt, LIMITS.alt, 'Image description');
        block.caption = field(raw.caption, LIMITS.caption, 'A caption');
        // Left out when default, so images saved before these choices are unchanged.
        if (IMAGE_SIZES.includes(raw.size) && raw.size !== 'full') block.size = raw.size;
        if (raw.align === 'left' || raw.align === 'right') block.align = raw.align;
        break;
      }
      case 'video': {
        const src = checkSource(raw);
        if (src.error) return refuse(src.error, at);
        if (src.assetId) block.assetId = src.assetId;
        else block.url = src.url || '';
        block.caption = field(raw.caption, LIMITS.caption, 'A caption');
        break;
      }
      case 'file': {
        const src = checkSource(raw);
        if (src.error) return refuse(src.error, at);
        if (src.assetId) block.assetId = src.assetId;
        else block.url = src.url || '';
        block.title = field(raw.title, LIMITS.fileTitle, 'A file title');
        block.kind = fileKindOf(raw.name || raw.url, raw.kind);
        if (typeof raw.name === 'string') block.name = field(raw.name, LIMITS.fileTitle, 'A file name');
        if (Number.isFinite(raw.bytes) && raw.bytes >= 0) block.bytes = Math.floor(raw.bytes);
        break;
      }
      case 'link': {
        const src = checkSource(raw);
        if (src.error) return refuse(src.error, at);
        if (src.assetId) return refuse('A link block needs a web address.', at);
        block.url = src.url || '';
        block.title = field(raw.title, LIMITS.linkTitle, 'A link title');
        block.description = field(raw.description, LIMITS.linkDescription, 'A link description');
        break;
      }
      case 'code':
        if (typeof raw.text === 'string' && raw.text.length > LIMITS.code) return refuse(`An example must be at most ${LIMITS.code} characters.`, at);
        block.text = typeof raw.text === 'string' ? raw.text.replace(/\r\n/g, '\n') : '';
        block.label = field(raw.label, LIMITS.codeLabel, 'An example label');
        break;
      case 'table': {
        const rows = Array.isArray(raw.rows) ? raw.rows : [];
        if (rows.length > LIMITS.tableRows) return refuse(`A table can have at most ${LIMITS.tableRows} rows.`, at);
        const cols = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
        if (cols > LIMITS.tableCols) return refuse(`A table can have at most ${LIMITS.tableCols} columns.`, at);
        // Every row has the same number of plain-text cells.
        block.rows = (rows.length ? rows : [[]]).map((r) => Array.from({ length: cols }, (_, i) => field(Array.isArray(r) && typeof r[i] === 'string' ? r[i].replace(/\s+/g, ' ') : '', LIMITS.tableCell, 'A table cell')));
        block.align = Array.from({ length: cols }, (_, i) => (Array.isArray(raw.align) && COLUMN_ALIGNS.includes(raw.align[i]) ? raw.align[i] : 'left'));
        block.header = raw.header !== false;
        block.caption = field(raw.caption, LIMITS.caption, 'A caption');
        break;
      }
      case 'divider':
        break;
      case 'legacy':
        if (!LEGACY_FIELDS.includes(raw.field)) return refuse('An earlier content section is not valid.', at);
        block.field = raw.field;
        break;
      default:
        return refuse('Unknown content block type.', at);
    }
  } catch (refusal) {
    if (refusal && refusal.ok === false) return refusal;
    throw refusal;
  }
  if (block.assetId && assetIds && !assetIds.has(block.assetId)) {
    return refuse('A file in this lesson was not uploaded to this course. Upload it again.', at);
  }
  return { ok: true, block };
}

/** The blocks of a lesson, checked. `assetIds`: the ids of the course's uploaded files. */
function checkBlocks(input, options = {}) {
  if (!Array.isArray(input)) return refuse('The lesson content must be a list of blocks.');
  if (input.length > LIMITS.blocks) return refuse(`A lesson can have at most ${LIMITS.blocks} content blocks. Split it into two lessons.`);
  const blocks = [];
  const seen = new Set();
  for (let i = 0; i < input.length; i += 1) {
    const checked = checkBlock(input[i], i, options);
    if (!checked.ok) return checked;
    if (seen.has(checked.block.id)) return refuse('Two content blocks share an id.', `blocks.${i}`);
    seen.add(checked.block.id);
    blocks.push(checked.block);
  }
  return { ok: true, blocks };
}

function hasText(value) {
  return typeof value === 'string' && value.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim().length > 0;
}

/**
 * The blocks of a lesson as stored, or derived from the fields a lesson had before the builder
 * (same order the old lesson page used: video, description, body, PDF, resources).
 */
function legacyBlocks(lesson) {
  const blocks = [];
  if (!lesson || typeof lesson !== 'object') return blocks;
  if (typeof lesson.videoUrl === 'string' && lesson.videoUrl.trim()) blocks.push({ id: 'legacyvideo', type: 'video', url: lesson.videoUrl, caption: '' });
  if (hasText(lesson.description)) blocks.push({ id: 'legacydescription', type: 'legacy', field: 'description' });
  const body = typeof lesson.content === 'string' && hasText(lesson.content) ? 'content' : null;
  if (body) blocks.push({ id: 'legacycontent', type: 'legacy', field: 'content' });
  if (typeof lesson.pdfUrl === 'string' && lesson.pdfUrl.trim()) blocks.push({ id: 'legacypdf', type: 'file', url: lesson.pdfUrl, title: 'Lesson PDF', kind: 'pdf', legacyItem: 'pdf' });
  (Array.isArray(lesson.resources) ? lesson.resources : []).forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const url = typeof r.url === 'string' ? r.url : '';
    const type = typeof r.type === 'string' ? r.type.toLowerCase() : '';
    if (type === 'link' || type === 'video') {
      blocks.push({ id: `legacyres${i}`, type: 'link', url, title: r.title || url, description: '', legacyItem: `r${i}` });
    } else {
      blocks.push({ id: `legacyres${i}`, type: 'file', url, title: r.title || 'Resource', kind: fileKindOf(url, type === 'slide' ? 'slides' : type), legacyItem: `r${i}` });
    }
  });
  return blocks;
}

/** True when a lesson stores builder blocks (its legacy fields are then no longer shown). */
function usesBlocks(lesson) {
  return Boolean(lesson && Array.isArray(lesson.blocks));
}

function lessonBlocks(lesson) {
  return usesBlocks(lesson) ? lesson.blocks : legacyBlocks(lesson);
}

/** Whether a block carries something a student can see. */
function blockHasContent(block, lesson) {
  if (!block) return false;
  switch (block.type) {
    case 'heading': return Boolean(block.text);
    case 'text': return deltaText(block.ops).trim().length > 0;
    case 'callout': return Boolean(block.text || block.title);
    case 'image': case 'link': return Boolean(block.url);
    case 'video': case 'file': return Boolean(block.url || block.assetId);
    case 'code': return Boolean(block.text && block.text.trim());
    case 'table': return block.rows.some((r) => r.some((cell) => cell.trim()));
    case 'legacy': return hasText(lesson && lesson[block.field]);
    default: return false;
  }
}

/** Fields mirrored from blocks for readers that predate them (lesson type icon, video resume). */
function mirroredLessonFields(blocks) {
  const video = blocks.find((b) => b.type === 'video' && (b.url || b.assetId));
  const hasFile = blocks.some((b) => b.type === 'file');
  return {
    videoUrl: video && video.url ? video.url : null,
    type: video ? 'video' : hasFile ? 'pdf' : 'interactive',
    contentFormat: 'blocks',
  };
}

/** Block kinds in a lesson, for the curriculum (icons and counts). */
function lessonKinds(lesson) {
  const kinds = new Set();
  for (const b of lessonBlocks(lesson)) {
    if (b.type === 'video') kinds.add('video');
    else if (b.type === 'file') kinds.add('file');
    else if (b.type === 'image') kinds.add('image');
    else if (b.type === 'link') kinds.add('link');
    else if (['text', 'heading', 'callout', 'legacy', 'code', 'table'].includes(b.type)) kinds.add('text');
  }
  return [...kinds];
}

/** Reading time in minutes (about 200 words a minute), for the curriculum. */
function readingMinutes(lesson) {
  let words = 0;
  for (const b of lessonBlocks(lesson)) {
    if (b.type === 'text') words += deltaText(b.ops).split(/\s+/).filter(Boolean).length;
    else if (b.type === 'heading' || b.type === 'callout') words += String(b.text || '').split(/\s+/).filter(Boolean).length;
    else if (b.type === 'table') words += b.rows.flat().join(' ').split(/\s+/).filter(Boolean).length;
    else if (b.type === 'legacy') words += String(lesson[b.field] || '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
  }
  return words ? Math.max(1, Math.round(words / 200)) : 0;
}

// ---------------------------------------------------------------------------
// Student delivery of files
// ---------------------------------------------------------------------------

/** The app path that serves one block's file after checking access (pages/api/lessons/[id]/document.ts). */
function blockDocumentPath(lessonId, blockId) {
  return `/api/lessons/${encodeURIComponent(String(lessonId))}/document?item=b-${blockId}`;
}

const BLOCK_ITEM = /^b-([a-z0-9]{6,24})$/;

function blockItemId(item) {
  const match = typeof item === 'string' ? BLOCK_ITEM.exec(item) : null;
  return match ? match[1] : null;
}

/**
 * Student view of blocks: file links and uploaded videos are replaced by the gated app path (the
 * stored address never reaches the browser); asset ids are removed. Linked videos and images keep
 * their address, as lesson videos always have.
 */
function presentBlocksForStudent(blocks, lessonId) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => {
    if (b.type === 'file' || (b.type === 'video' && b.assetId)) {
      const { assetId, url, ...rest } = b;
      const available = Boolean(assetId || (url && safeLinkUrl(url, { allowRelative: false })));
      return { ...rest, url: available ? blockDocumentPath(lessonId, b.id) : null, available };
    }
    return b;
  });
}

// ---------------------------------------------------------------------------
// Curriculum (modules)
// ---------------------------------------------------------------------------

/** The course's modules, or one implicit module for a course built before modules existed. */
function courseModules(course) {
  const list = course && Array.isArray(course.modules) ? course.modules.filter((m) => m && typeof m.id === 'string') : [];
  return list.length ? list.map((m) => ({ id: m.id, title: typeof m.title === 'string' ? m.title : '' })) : [{ id: IMPLICIT_MODULE_ID, title: '', implicit: true }];
}

/**
 * Modules with their lessons in display order. A lesson whose module no longer exists (or that
 * predates modules) belongs to the first module. Within a module lessons follow `order`.
 */
function curriculum(course, lessons) {
  const modules = courseModules(course);
  const ids = new Set(modules.map((m) => m.id));
  const byModule = new Map(modules.map((m) => [m.id, []]));
  const sorted = [...(lessons || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a._id).localeCompare(String(b._id)));
  for (const lesson of sorted) {
    const moduleId = typeof lesson.moduleId === 'string' && ids.has(lesson.moduleId) ? lesson.moduleId : modules[0].id;
    byModule.get(moduleId).push(lesson);
  }
  return modules.map((m) => ({ ...m, lessons: byModule.get(m.id) }));
}

/** Lesson ids in course order (module by module): the sequence `order` must follow. */
function curriculumOrder(course, lessons) {
  return curriculum(course, lessons).flatMap((m) => m.lessons.map((l) => String(l._id)));
}

/**
 * A curriculum change: modules in order, each with its lesson ids in order. Must contain exactly
 * the course's current lessons. Returns { modules: [{id,title}], assignments: [{lessonId, moduleId, order}] }.
 */
function checkCurriculum(input, currentLessonIds) {
  if (!Array.isArray(input) || input.length === 0) return refuse('A course needs at least one module.', 'modules');
  if (input.length > LIMITS.modules) return refuse(`A course can have at most ${LIMITS.modules} modules.`, 'modules');
  const modules = [];
  const assignments = [];
  const seenModules = new Set();
  const seenLessons = new Set();
  for (const raw of input) {
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || !MODULE_ID.test(raw.id)) return refuse('A module has no valid id.', 'modules');
    if (seenModules.has(raw.id)) return refuse('Two modules share an id.', 'modules');
    seenModules.add(raw.id);
    const title = text(raw.title, LIMITS.moduleTitle);
    if (title === null) return refuse(`A module title must be at most ${LIMITS.moduleTitle} characters.`, 'modules');
    modules.push({ id: raw.id, title });
    if (!Array.isArray(raw.lessonIds)) return refuse('Each module needs its list of lessons.', 'modules');
    for (const lessonId of raw.lessonIds) {
      if (typeof lessonId !== 'string' || !/^[a-f0-9]{24}$/i.test(lessonId)) return refuse('A lesson id is not valid.', 'modules');
      const key = lessonId.toLowerCase();
      if (seenLessons.has(key)) return refuse('Each lesson can appear only once.', 'modules');
      seenLessons.add(key);
      assignments.push({ lessonId: key, moduleId: raw.id, order: assignments.length + 1 });
    }
  }
  const current = (currentLessonIds || []).map((id) => String(id).toLowerCase());
  if (current.length !== seenLessons.size || !current.every((id) => seenLessons.has(id))) {
    return { ok: false, status: 409, code: 'lessons_changed', error: 'The lessons of this course changed in another window. Reload to see the latest curriculum.' };
  }
  return { ok: true, modules, assignments };
}

function newId(length = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const cryptoObj = typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function' ? globalThis.crypto : null;
  const bytes = new Uint8Array(length);
  if (cryptoObj) cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ---------------------------------------------------------------------------
// Course details added by the builder
// ---------------------------------------------------------------------------

/**
 * Optional course details: summary (short description), learning objectives, prerequisites and
 * estimated hours. Returns { ok, fields } with only the fields sent.
 */
function checkCourseDetails(body) {
  const source = isPlainObject(body) ? body : {};
  const fields = {};
  if (source.summary !== undefined) {
    const v = text(source.summary, LIMITS.summary);
    if (v === null) return refuse(`The short description must be at most ${LIMITS.summary} characters.`, 'summary');
    fields.summary = v;
  }
  if (source.prerequisites !== undefined) {
    const v = text(source.prerequisites, LIMITS.prerequisites);
    if (v === null) return refuse(`Prerequisites must be at most ${LIMITS.prerequisites} characters.`, 'prerequisites');
    fields.prerequisites = v;
  }
  if (source.objectives !== undefined) {
    if (!Array.isArray(source.objectives)) return refuse('Learning objectives must be a list.', 'objectives');
    const list = [];
    for (const item of source.objectives) {
      const v = text(item, LIMITS.objective);
      if (v === null) return refuse(`Each objective must be at most ${LIMITS.objective} characters.`, 'objectives');
      if (v) list.push(v);
    }
    if (list.length > LIMITS.objectives) return refuse(`A course can list at most ${LIMITS.objectives} objectives.`, 'objectives');
    fields.objectives = list;
  }
  if (source.estimatedHours !== undefined) {
    if (source.estimatedHours === null || source.estimatedHours === '') fields.estimatedHours = null;
    else {
      const n = Number(source.estimatedHours);
      if (!Number.isFinite(n) || n < 0 || n > 1000) return refuse('Estimated hours must be between 0 and 1000.', 'estimatedHours');
      fields.estimatedHours = Math.round(n * 2) / 2;
    }
  }
  return { ok: true, fields };
}

// ---------------------------------------------------------------------------
// Readiness (before review and publishing)
// ---------------------------------------------------------------------------

const BLOCK_LABEL = Object.freeze({ image: 'image', video: 'video', file: 'file', link: 'link' });

/**
 * Problems that stop a course from going to review or being published (`error`) and suggestions
 * (`warning`). `quizzes`: Map lessonId -> { questions, status }. `assetIds`: Set of the course's
 * uploaded file ids. Each issue names where to fix it ({ area, lessonId?, blockId? }).
 */
function courseReadiness({ course, lessons, quizzes = new Map(), assetIds = new Set() }) {
  const issues = [];
  const add = (level, message, where = {}) => issues.push({ level, message, ...where });
  const c = course || {};
  if (!text(c.title, 1000)) add('error', 'Add a course title.', { area: 'details', field: 'title' });
  if (!hasText(c.description)) add('error', 'Add a full course description.', { area: 'details', field: 'description' });
  if (!text(c.category, 1000)) add('error', 'Choose a category.', { area: 'details', field: 'category' });
  if (!['beginner', 'intermediate', 'advanced'].includes(c.difficulty)) add('error', 'Choose a difficulty level.', { area: 'details', field: 'difficulty' });
  if (!text(c.summary, 1000)) add('warning', 'Add a short description for the catalogue card.', { area: 'details', field: 'summary' });
  if (!text(c.thumbnail, 5000)) add('warning', 'Add a cover image.', { area: 'details', field: 'thumbnail' });
  if (!Array.isArray(c.objectives) || !c.objectives.length) add('warning', 'List what students will learn.', { area: 'details', field: 'objectives' });

  const tree = curriculum(c, lessons || []);
  if (!(lessons || []).length) add('error', 'Add at least one lesson.', { area: 'curriculum' });
  for (const m of tree) {
    if (!m.implicit && !m.title) add('error', 'Give every module a title.', { area: 'curriculum', moduleId: m.id });
    if (!m.implicit && !m.lessons.length) add('warning', `Module "${m.title || 'Untitled'}" has no lessons.`, { area: 'curriculum', moduleId: m.id });
  }
  for (const lesson of lessons || []) {
    const lessonId = String(lesson._id);
    const name = text(lesson.title, 1000) || 'Untitled lesson';
    if (!text(lesson.title, 1000)) add('error', 'Give every lesson a title.', { area: 'lesson', lessonId });
    const blocks = lessonBlocks(lesson);
    const quiz = quizzes.get(lessonId);
    if (!blocks.some((b) => blockHasContent(b, lesson)) && !quiz) add('error', `"${name}" has no content yet.`, { area: 'lesson', lessonId });
    for (const b of blocks) {
      if (BLOCK_LABEL[b.type] && !(b.url || b.assetId)) add('error', `"${name}" has an empty ${BLOCK_LABEL[b.type]} block.`, { area: 'lesson', lessonId, blockId: b.id });
      if (b.assetId && !assetIds.has(b.assetId)) add('error', `"${name}" refers to a file that is missing. Upload it again.`, { area: 'lesson', lessonId, blockId: b.id });
      if (b.type === 'image' && b.url && !b.alt) add('warning', `"${name}" has an image without a description for screen readers.`, { area: 'lesson', lessonId, blockId: b.id });
      if (b.type === 'file' && !b.title) add('warning', `"${name}" has a file without a title.`, { area: 'lesson', lessonId, blockId: b.id });
    }
    if (quiz && quiz.questions === 0) add('error', `The quiz in "${name}" has no questions.`, { area: 'lesson', lessonId });
    if (quiz && quiz.questions > 0 && quiz.status && quiz.status !== 'published') add('warning', `The quiz in "${name}" is not published, so students will not see it.`, { area: 'lesson', lessonId });
  }
  const errors = issues.filter((i) => i.level === 'error').length;
  return { ready: errors === 0, errors, warnings: issues.length - errors, issues };
}

module.exports = {
  ASSET_ID,
  BLOCK_ID,
  BLOCK_TYPES,
  CALLOUT_TONES,
  FILE_KINDS,
  IMPLICIT_MODULE_ID,
  LIMITS,
  MODULE_ID,
  TEXT_ALIGNS,
  TEXT_COLORS,
  TEXT_HIGHLIGHTS,
  TEXT_SIZES,
  blockDocumentPath,
  blockHasContent,
  blockItemId,
  checkBlock,
  checkBlocks,
  checkCourseDetails,
  checkCurriculum,
  courseModules,
  courseReadiness,
  curriculum,
  curriculumOrder,
  deltaText,
  deltaToLines,
  fileKindOf,
  groupLines,
  legacyBlocks,
  lessonBlocks,
  lessonKinds,
  mirroredLessonFields,
  newId,
  normalizeDelta,
  plainText,
  presentBlocksForStudent,
  readingMinutes,
  usesBlocks,
};
