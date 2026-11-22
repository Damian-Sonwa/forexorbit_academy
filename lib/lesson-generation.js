'use strict';

/**
 * AI lesson development: from a lesson that already exists in the curriculum to a proposed lesson
 * body an instructor reviews. Nothing here holds lesson content: every lesson is generated at run
 * time from the course's own records (course, module, topic, neighbouring lessons, existing
 * content) by the configured provider (lib/ai-provider.js).
 *
 *   buildContext()     what the model is told about the topic, from the database records
 *   buildPrompt()      instructions for one mode (generate, improve, expand, rewrite, section,
 *                      simplify, examples, checks)
 *   parseLesson()      strict validation of the model's JSON; truncated or malformed answers are
 *                      refused, never saved
 *   toBlocks()         the course builder's block format (lib/course-content.js), so generated
 *                      content is stored and rendered exactly like hand-written content
 *   assessQuality()    deterministic checks shown to the instructor (never "verified" by AI)
 *
 * The curriculum is never changed here: the topic title, module and order stay as they are.
 */

const C = require('./course-content');
const { formatWorked, verifyCalculation, TYPES: CALC_TYPES } = require('./forex-calculations');

const MODES = Object.freeze(['generate', 'improve', 'expand', 'rewrite', 'section', 'simplify', 'examples', 'checks']);
/** Modes that replace the whole lesson body (with history) versus those that add to it. */
const WHOLE_LESSON_MODES = Object.freeze(['generate', 'improve', 'expand', 'rewrite', 'simplify']);
const SECTION_KINDS = Object.freeze({
  introduction: 'Introduction',
  objectives: 'Learning objectives',
  explanation: 'Detailed explanation',
  key_concepts: 'Key concepts',
  terminology: 'Terminology',
  example: 'Practical example',
  steps: 'Step-by-step demonstration',
  calculation: 'Worked calculation',
  misconceptions: 'Common misconceptions',
  mistakes: 'Common mistakes',
  application: 'Practical application',
  summary: 'Summary',
  further_learning: 'Further learning',
});
const CALLOUT_KINDS = Object.freeze({ misconceptions: 'warning', mistakes: 'warning', key_concepts: 'key' });
const INSTRUCTIONS_MAX = 600;
const CONTEXT_CHARS = 14000;
const EXISTING_CHARS = 9000;

function str(v) {
  return typeof v === 'string' ? v : '';
}
function plain(html) {
  return str(html).replace(/<(br|\/p|\/li|\/h\d)>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}
function clip(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** A lesson's current content as plain text with media placeholders ([[MEDIA:id]]) kept in place. */
function lessonAsText(lesson) {
  const parts = [];
  for (const b of C.lessonBlocks(lesson)) {
    if (b.type === 'heading') parts.push(`${b.level === 3 ? '###' : '##'} ${b.text}`);
    else if (b.type === 'text') parts.push(C.deltaText(b.ops).trim());
    else if (b.type === 'callout') parts.push(`> ${b.title ? `${b.title}: ` : ''}${b.text}`);
    else if (b.type === 'code') parts.push(`${b.label ? `${b.label}:\n` : ''}${b.text}`);
    else if (b.type === 'legacy') parts.push(plain(lesson[b.field]));
    else if (['image', 'video', 'file', 'link'].includes(b.type)) parts.push(`[[MEDIA:${b.id}]] (${b.type}${b.title ? `: ${b.title}` : b.caption ? `: ${b.caption}` : b.alt ? `: ${b.alt}` : ''})`);
  }
  return parts.filter(Boolean).join('\n\n');
}

function wordCount(s) {
  return str(s).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/**
 * What the model is told, from stored records only. `course`: the course document; `lessons`: the
 * course's lessons (with order and moduleId); `lessonId`: the topic. Earlier lessons in the course
 * are listed as prerequisites, with short excerpts of the nearest ones for consistent terminology.
 */
function buildContext({ course, lessons, lessonId }) {
  const tree = C.curriculum(course, lessons);
  const order = tree.flatMap((m) => m.lessons.map((l) => ({ lesson: l, module: m })));
  const index = order.findIndex((x) => String(x.lesson._id) === String(lessonId));
  if (index < 0) return null;
  const { lesson, module } = order[index];
  const existing = lessonAsText(lesson);
  const before = order.slice(0, index);
  const after = order.slice(index + 1, index + 4);
  const nearest = before.slice(-3).map((x) => ({ title: plain(x.lesson.title), excerpt: clip(lessonAsText(x.lesson).replace(/\[\[MEDIA:[^\]]+\]\][^\n]*/g, ''), 700) }));
  return {
    course: {
      title: plain(course.title),
      summary: plain(course.summary),
      description: clip(plain(course.description), 1500),
      difficulty: ['beginner', 'intermediate', 'advanced'].includes(course.difficulty) ? course.difficulty : 'beginner',
      category: plain(course.category),
      objectives: (Array.isArray(course.objectives) ? course.objectives : []).map(plain).filter(Boolean),
    },
    module: { title: module.implicit ? '' : plain(module.title), lessons: module.lessons.map((l) => plain(l.title)) },
    topic: { title: plain(lesson.title), position: index + 1, total: order.length },
    prerequisites: before.map((x) => plain(x.lesson.title)).slice(-12),
    nearest,
    upcoming: after.map((x) => plain(x.lesson.title)),
    existing: clip(existing, EXISTING_CHARS),
    existingWords: wordCount(existing.replace(/\[\[MEDIA:[^\]]+\]\][^\n]*/g, '')),
    mediaIds: C.lessonBlocks(lesson).filter((b) => ['image', 'video', 'file', 'link'].includes(b.type)).map((b) => b.id),
  };
}

const SYSTEM = [
  'You are an experienced forex trading instructor writing lessons for an online academy.',
  'You teach progressively: define terms before using them, move from basic to advanced, explain why as well as how, and use concrete forex examples.',
  'Rules:',
  '- Teach only the given topic, in the given course and module. Do not rename the topic or change the curriculum.',
  '- Match the course difficulty. Beginners need plain language and every term explained.',
  '- Be accurate. Prices are quote currency per unit of base currency. A pip is 0.0001 for most pairs and 0.01 for JPY pairs. A standard lot is 100,000 units, a mini lot 10,000, a micro lot 1,000.',
  '- Never invent current prices, statistics, studies, quotes or references. Any numbers in examples are hypothetical and must be labelled as such.',
  '- No personalised investment advice, no guarantees, no "you should buy/sell". This is education about concepts, not trading signals.',
  '- Do not include URLs or external links.',
  '- Do not pad. No motivational filler, no repetition. Every section must help the student understand the topic.',
  '- Write paragraphs, not only bullet points. Use lists where they genuinely help.',
  'Answer with one JSON object only, matching the schema you are given.',
].join('\n');

const SCHEMA = `{
  "sections": [
    {
      "kind": one of ${JSON.stringify(Object.keys(SECTION_KINDS))},
      "heading": "section heading",
      "body": "the section text. Paragraphs separated by a blank line. Lines starting with '- ' are bullets, lines starting with '1. ' are numbered steps. **bold** for key terms.",
      "keep": ["MEDIA ids from the existing lesson to place after this section, if any"]
    }
  ],
  "calculations": [
    {
      "afterSection": index of the section this worked example belongs after,
      "label": "short title",
      "type": one of ${JSON.stringify(CALC_TYPES)},
      "inputs": { numeric inputs for that type (see below) },
      "expectedResult": the number you expect
    }
  ],
  "knowledgeChecks": [
    { "question": "...", "options": ["four", "distinct", "answer", "options"], "correctIndex": 0, "explanation": "why the answer is right" }
  ],
  "suggestions": ["optional notes for the instructor about the curriculum; they are shown, never applied"]
}
Calculation inputs by type:
pips {priceFrom, priceTo, pipSize}; spread {bid, ask, pipSize}; lot_units {lots}; pip_value {units, pipSize, conversionRate?, quoteCurrency?, accountCurrency?};
position_size {accountBalance, riskPercent, stopPips, pipValuePerLot, accountCurrency?}; risk_reward {entry, stop, target};
margin {units, price, leverage, conversionRate?, quoteCurrency?}; profit_loss {units, entry, exit, side ("buy"|"sell"), conversionRate?, quoteCurrency?}.
Only include calculations that genuinely belong to the topic. The application computes and shows the steps itself.`;

function contextText(ctx) {
  const lines = [
    `Course: ${ctx.course.title} (${ctx.course.difficulty}${ctx.course.category ? `, ${ctx.course.category}` : ''})`,
    ctx.course.summary && `Course summary: ${ctx.course.summary}`,
    ctx.course.description && `Course description: ${ctx.course.description}`,
    ctx.course.objectives.length && `Course objectives: ${ctx.course.objectives.join('; ')}`,
    ctx.module.title && `Module: ${ctx.module.title} (lessons: ${ctx.module.lessons.join(' | ')})`,
    `Topic (lesson ${ctx.topic.position} of ${ctx.topic.total}): ${ctx.topic.title}`,
    ctx.prerequisites.length && `Already taught earlier in the course: ${ctx.prerequisites.join(' | ')}`,
    ctx.upcoming.length && `Taught next (do not cover in depth): ${ctx.upcoming.join(' | ')}`,
    ...ctx.nearest.filter((n) => n.excerpt).map((n) => `Excerpt of earlier lesson "${n.title}" (keep terminology consistent):\n${n.excerpt}`),
  ].filter(Boolean);
  return clip(lines.join('\n'), CONTEXT_CHARS);
}

const MODE_TASK = {
  generate: 'Write the complete lesson for this topic. Choose the sections that genuinely help (typically an introduction, the detailed explanation, key concepts or terminology, practical examples, worked calculations where the topic involves numbers, common mistakes or misconceptions, practical application, a summary) and include 3-5 knowledge-check questions.',
  improve: 'Improve the existing lesson: clearer explanations, better organisation and progression, more accurate and practical examples. Keep everything that is already good and correct; fix what is unclear or wrong. Do not make it longer for the sake of length.',
  expand: 'Keep the existing lesson material and add what is missing: explanations of terms used without definition, worked examples, practical applications and supporting sections. Preserve the existing explanations (you may tidy their wording).',
  rewrite: 'Rewrite the whole lesson as a new, well-structured lesson on the same topic. The existing text is for reference only.',
  section: 'Write only the requested section for this lesson. It will be inserted into the existing lesson, so do not repeat what the lesson already explains.',
  simplify: 'Rewrite the existing lesson so a student who is struggling can follow it: shorter sentences, plain language, every term explained, one idea at a time, more concrete examples. Keep it accurate and keep the same scope.',
  examples: 'Write practical forex examples and scenarios for this topic, with worked calculations where the topic involves numbers. They will be added to the existing lesson.',
  checks: 'Write 5 multiple-choice knowledge-check questions that test understanding (not recall of wording) of this lesson. Return them in "knowledgeChecks"; "sections" may be empty.',
};

/** The prompt for one request. `options`: { sectionKind, instructions }. */
function buildPrompt(mode, ctx, options = {}) {
  const parts = [contextText(ctx), '', `Task: ${MODE_TASK[mode]}`];
  if (mode === 'section') parts.push(`Section to write: ${SECTION_KINDS[options.sectionKind] || 'Detailed explanation'} (kind "${options.sectionKind || 'explanation'}").`);
  if (ctx.existing && mode !== 'generate') {
    parts.push('', `Existing lesson (${ctx.existingWords} words). Media items appear as [[MEDIA:id]]; to keep one, list its id in the "keep" array of the section it belongs after${mode === 'rewrite' ? ' (keep media that still fits)' : '; keep all of them'}.`, '---', ctx.existing, '---');
  } else if (ctx.existing && mode === 'generate') {
    parts.push('', 'The lesson has a little existing text; use what is correct.', '---', ctx.existing, '---');
  }
  const instructions = str(options.instructions).trim().slice(0, INSTRUCTIONS_MAX);
  if (instructions) parts.push('', `Instructor's request (follow it if it fits the rules): ${instructions}`);
  parts.push('', 'JSON schema:', SCHEMA);
  return { system: SYSTEM, user: parts.join('\n') };
}

/** Output budget per mode (tokens). */
function maxTokensFor(mode) {
  return { section: 1800, checks: 1500, examples: 3000 }[mode] || 6000;
}

class GenerationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function extractJson(content) {
  const trimmed = str(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
}

/**
 * Validates the model's answer. Refuses truncated output (finish reason "length"), unparseable
 * JSON, and answers without the content the mode needs.
 */
function parseLesson(content, { mode, finishReason }) {
  if (finishReason === 'length') throw new GenerationError('truncated', 'The AI answer was cut off before it was complete, so it was not saved. Try again or generate one section at a time.');
  const data = extractJson(content);
  if (!data || typeof data !== 'object') throw new GenerationError('malformed', 'The AI answer was not in the expected format, so nothing was saved. Try again.');
  const sections = (Array.isArray(data.sections) ? data.sections : []).slice(0, 24).map((s) => ({
    kind: Object.prototype.hasOwnProperty.call(SECTION_KINDS, s && s.kind) ? s.kind : 'explanation',
    heading: str(s && s.heading).replace(/^#+\s*/, '').trim().slice(0, 200),
    body: str(s && s.body).trim().slice(0, 20000),
    keep: (Array.isArray(s && s.keep) ? s.keep : []).filter((id) => typeof id === 'string' && C.BLOCK_ID.test(id)),
  })).filter((s) => s.body || s.keep.length);
  const calculations = (Array.isArray(data.calculations) ? data.calculations : []).slice(0, 8).filter((c) => c && typeof c === 'object' && CALC_TYPES.includes(c.type));
  const knowledgeChecks = (Array.isArray(data.knowledgeChecks) ? data.knowledgeChecks : []).slice(0, 10).map((q) => ({
    question: str(q && q.question).trim().slice(0, 1000),
    options: (Array.isArray(q && q.options) ? q.options : []).map((o) => str(o).trim().slice(0, 300)).filter(Boolean).slice(0, 6),
    correctIndex: Number.isInteger(q && q.correctIndex) ? q.correctIndex : -1,
    explanation: str(q && q.explanation).trim().slice(0, 2000),
  })).filter((q) => q.question && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length && new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length);
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).map((x) => str(x).trim().slice(0, 300)).filter(Boolean).slice(0, 5);
  if (mode === 'checks') {
    if (!knowledgeChecks.length) throw new GenerationError('incomplete', 'The AI answer had no usable questions, so nothing was saved. Try again.');
  } else if (!sections.length) {
    throw new GenerationError('incomplete', 'The AI answer had no lesson content, so nothing was saved. Try again.');
  }
  if (WHOLE_LESSON_MODES.includes(mode) && sections.reduce((n, s) => n + wordCount(s.body), 0) < 120) {
    throw new GenerationError('incomplete', 'The AI answer was too short to be a lesson, so nothing was saved. Try again.');
  }
  return { sections, calculations, knowledgeChecks, suggestions };
}

// ---------------------------------------------------------------------------
// Text to blocks
// ---------------------------------------------------------------------------

/** Inline **bold** to Delta runs; links are not produced (generated text has none). */
function inlineOps(line, lineAttrs) {
  const ops = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) ops.push({ insert: line.slice(last, m.index) });
    ops.push({ insert: m[1], attributes: { bold: true } });
    last = re.lastIndex;
  }
  if (last < line.length) ops.push({ insert: line.slice(last) });
  ops.push(lineAttrs ? { insert: '\n', attributes: lineAttrs } : { insert: '\n' });
  return ops;
}

/** Section text (paragraphs, "- " bullets, "1. " steps, "### " subheadings) as a Delta. */
function bodyToOps(body) {
  const ops = [];
  const paragraphs = str(body).replace(/\r\n/g, '\n').replace(/https?:\/\/\S+/g, '').split(/\n\s*\n/);
  for (const para of paragraphs) {
    const lines = para.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    let buffer = [];
    const flush = () => { if (buffer.length) { ops.push(...inlineOps(buffer.join(' ').trim())); buffer = []; } };
    for (const line of lines) {
      const t = line.trim();
      if (/^[-*•]\s+/.test(t)) { flush(); ops.push(...inlineOps(t.replace(/^[-*•]\s+/, ''), { list: 'bullet' })); }
      else if (/^\d+[.)]\s+/.test(t)) { flush(); ops.push(...inlineOps(t.replace(/^\d+[.)]\s+/, ''), { list: 'ordered' })); }
      else if (/^#{3,}\s+/.test(t)) { flush(); ops.push(...inlineOps(t.replace(/^#+\s+/, ''), { header: 3 })); }
      else if (/^#{1,2}\s+/.test(t)) { flush(); ops.push(...inlineOps(t.replace(/^#+\s+/, ''), { header: 3 })); }
      else buffer.push(t);
    }
    flush();
  }
  const checked = C.normalizeDelta(ops);
  return checked.ok ? checked.ops : [{ insert: '\n' }];
}

/**
 * The parsed answer as builder blocks. Existing media blocks named in "keep" are placed after
 * their section; for whole-lesson modes, any existing media the model did not place is appended
 * (never silently dropped). Calculations are recomputed (lib/forex-calculations.js).
 */
function toBlocks(parsed, { mode, existingBlocks = [] }) {
  const media = new Map(existingBlocks.filter((b) => ['image', 'video', 'file', 'link'].includes(b.type)).map((b) => [b.id, b]));
  const placed = new Set();
  const calcs = parsed.calculations.map((c) => ({ raw: c, v: verifyCalculation(c) }));
  const blocks = [];
  parsed.sections.forEach((s, i) => {
    const heading = s.heading || SECTION_KINDS[s.kind];
    const tone = CALLOUT_KINDS[s.kind];
    if (s.body) {
      if (tone && C.deltaText(bodyToOps(s.body)).length < 900 && !/\n\s*[-*•\d]/.test(s.body)) {
        blocks.push({ id: C.newId(), type: 'callout', tone, title: heading.slice(0, 120), text: s.body.replace(/\*\*/g, '').slice(0, 4000) });
      } else {
        blocks.push({ id: C.newId(), type: 'heading', text: heading, level: 2 });
        blocks.push({ id: C.newId(), type: 'text', ops: bodyToOps(s.body) });
      }
    }
    for (const c of calcs.filter((x) => (Number.isInteger(x.raw.afterSection) ? x.raw.afterSection : parsed.sections.length - 1) === i)) {
      if (c.v.ok) blocks.push({ id: C.newId(), type: 'code', label: (c.v.label || 'Worked calculation').slice(0, 80), text: formatWorked(c.v) });
    }
    for (const id of s.keep) {
      if (media.has(id) && !placed.has(id)) { blocks.push(media.get(id)); placed.add(id); }
    }
  });
  if (WHOLE_LESSON_MODES.includes(mode)) {
    const rest = [...media.values()].filter((b) => !placed.has(b.id));
    if (rest.length) {
      blocks.push({ id: C.newId(), type: 'heading', text: 'Lesson resources', level: 2 });
      blocks.push(...rest);
    }
  }
  const checked = C.checkBlocks(blocks);
  if (!checked.ok) throw new GenerationError('malformed', 'The generated lesson could not be converted safely, so nothing was saved. Try again.');
  return { blocks: checked.blocks, calculations: calcs.map((c) => c.v) };
}

// ---------------------------------------------------------------------------
// Quality checks (deterministic)
// ---------------------------------------------------------------------------

const STOP = new Set('a an and the of to in on for with is are what how why understanding introduction basics your vs versus from by at as it its into using use'.split(' '));

function keywords(title) {
  return str(title).toLowerCase().replace(/[^a-z0-9\s/-]/g, ' ').split(/[\s/-]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * The checklist shown with a proposal: { checks: [{ id, label, status: pass|warn|fail, detail }] }.
 * It reports what can be checked mechanically; it never claims the content is factually verified.
 */
function assessQuality({ mode, ctx, parsed, blocks, calculations }) {
  const checks = [];
  const add = (id, label, status, detail = '') => checks.push({ id, label, status, detail });
  const textAll = parsed.sections.map((s) => `${s.heading}\n${s.body}`).join('\n\n');
  const words = wordCount(textAll);
  const lower = textAll.toLowerCase();

  const kw = keywords(ctx.topic.title);
  const hit = kw.filter((k) => lower.includes(k.replace(/s$/, '')));
  if (mode !== 'checks') add('relevance', 'Stays on the topic', kw.length === 0 || hit.length / kw.length >= 0.5 ? 'pass' : 'warn', kw.length ? `Topic words found: ${hit.length} of ${kw.length}` : '');

  if (WHOLE_LESSON_MODES.includes(mode)) {
    const minimum = { beginner: 450, intermediate: 600, advanced: 700 }[ctx.course.difficulty] || 450;
    add('depth', 'Enough explanation for a full lesson', words >= minimum ? 'pass' : 'warn', `${words} words (guide: about ${minimum}+ for this level)`);
    const kinds = new Set(parsed.sections.map((s) => s.kind));
    const missing = ['introduction', 'summary'].filter((k) => !kinds.has(k));
    add('structure', 'Has an introduction and a summary', missing.length ? 'warn' : 'pass', missing.length ? `Missing: ${missing.join(', ')}` : `${parsed.sections.length} sections`);
    const bulletLines = (textAll.match(/^\s*([-*•]|\d+[.)])\s+/gm) || []).length;
    const lines = textAll.split('\n').filter((l) => l.trim()).length || 1;
    add('prose', 'Explains in paragraphs, not only bullet points', bulletLines / lines > 0.7 ? 'warn' : 'pass', `${Math.round((bulletLines / lines) * 100)}% of lines are list items`);
    if (mode === 'expand' || mode === 'improve') {
      add('kept', 'Keeps the existing material', words >= ctx.existingWords * (mode === 'expand' ? 1 : 0.6) ? 'pass' : 'warn', `${ctx.existingWords} words before, ${words} after`);
    }
  }

  const sentences = textAll.split(/(?<=[.!?])\s+/).map((s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()).filter((s) => s.length > 40);
  const dupes = sentences.length - new Set(sentences).size;
  add('repetition', 'No repeated sentences', dupes === 0 ? 'pass' : 'warn', dupes ? `${dupes} repeated` : '');

  const headings = parsed.sections.map((s) => s.heading.toLowerCase()).filter(Boolean);
  if (headings.length !== new Set(headings).size) add('headings', 'Section headings are distinct', 'warn', 'Two sections share a heading');

  if (calculations.length) {
    const bad = calculations.filter((c) => !c.ok);
    const mismatch = calculations.filter((c) => c.ok && c.matches === false);
    add('math', 'Worked calculations recomputed by the application', bad.length ? 'fail' : mismatch.length ? 'warn' : 'pass',
      bad.length ? bad.map((c) => c.error).join(' ')
        : mismatch.length ? `The AI's own answer differed for ${mismatch.map((c) => `"${c.label || c.type}" (AI ${c.claimed}, correct ${c.result})`).join(', ')}. The shown steps use the correct value; check any prose that repeats the number.`
          : `${calculations.length} calculation${calculations.length === 1 ? '' : 's'}, results match`);
    const warnings = calculations.flatMap((c) => (c.ok ? c.warnings : []));
    if (warnings.length) add('math_notes', 'Calculation notes', 'warn', warnings.join(' '));
  }
  // Numbers in prose cannot be recomputed; the instructor should check them.
  const proseNumbers = (textAll.match(/\b\d+(\.\d+)?\s*(%|pips?|lots?|units?|:1)\b/gi) || []).length;
  if (proseNumbers) add('prose_numbers', 'Numbers in the text', 'warn', `${proseNumbers} figure${proseNumbers === 1 ? '' : 's'} appear in the prose; check them against the worked examples.`);

  const claims = textAll.match(/\b(studies (show|have shown)|research (shows|suggests)|according to|statistics show|\d{2,3}\s?% of (retail )?traders)\b/gi) || [];
  add('claims', 'No unsupported statistics or citations', claims.length ? 'warn' : 'pass', claims.length ? `Check: ${[...new Set(claims.map((c) => c.toLowerCase()))].join(', ')}` : '');
  const advice = textAll.match(/\b(guaranteed?|risk[- ]free profit|you should (buy|sell)|sure win|can't lose|cannot lose)\b/gi) || [];
  add('advice', 'Education, not trading advice or guarantees', advice.length ? 'warn' : 'pass', advice.length ? `Check wording: ${[...new Set(advice.map((a) => a.toLowerCase()))].join(', ')}` : '');
  if (/\b(current(ly)?|today'?s|right now|at the moment)\b[^.]{0,40}\b(price|rate|quote)/i.test(textAll)) add('live_prices', 'No claims about current prices', 'warn', 'The text mentions current prices; use clearly hypothetical values.');
  if (/https?:\/\//i.test(textAll)) add('links', 'No external links', 'warn', 'Links were removed from the generated text.');

  if (parsed.knowledgeChecks.length || mode === 'checks' || mode === 'generate') {
    add('checks', 'Knowledge-check questions are well formed', parsed.knowledgeChecks.length ? 'pass' : 'warn', parsed.knowledgeChecks.length ? `${parsed.knowledgeChecks.length} questions, one correct answer each` : 'No usable questions were returned');
  }
  add('review', 'Reviewed by an instructor', 'warn', 'AI-generated: read it, check the facts and examples, and edit before publishing.');
  return { checks, blocks: blocks.length, words };
}

module.exports = {
  CONTEXT_CHARS,
  GenerationError,
  INSTRUCTIONS_MAX,
  MODES,
  SECTION_KINDS,
  SYSTEM,
  WHOLE_LESSON_MODES,
  assessQuality,
  bodyToOps,
  buildContext,
  buildPrompt,
  extractJson,
  lessonAsText,
  maxTokensFor,
  parseLesson,
  toBlocks,
  wordCount,
};
