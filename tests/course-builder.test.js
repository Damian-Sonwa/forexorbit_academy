/**
 * Course builder: the content model, curriculum, readiness, file checks and the server-side rules
 * that use them. Route behaviour against a real database: tests/integration/course-builder-mongo.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const C = require('../lib/course-content');
const ops = require('../lib/curriculum-ops');
const files = require('../lib/course-asset-files');
const access = require('../lib/account-access');
const docs = require('../lib/lesson-documents');
const { presentCourse, COURSE_RESPONSE_FIELDS } = require('../lib/course-response');
const { WITHHELD_LESSON_FIELDS } = require('../lib/course-lesson-list');
const { LESSON_TEXT_FIELDS } = require('../lib/media-cleanup');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INSTRUCTOR = '507f1f77bcf86cd799439013';
const OTHER = '507f1f77bcf86cd799439099';
const COURSE = '507f1f77bcf86cd799439011';
const LESSON = '507f1f77bcf86cd799439021';

// ---------------------------------------------------------------------------
// Rich text: a Delta, never HTML
// ---------------------------------------------------------------------------

test('rich text keeps allowed formats and drops everything else', () => {
  const r = C.normalizeDelta([
    { insert: 'Bold', attributes: { bold: true, color: '#f00', font: 'serif' } },
    { insert: ' link', attributes: { link: 'https://example.com/x' } },
    { insert: ' bad', attributes: { link: 'javascript:alert(1)' } },
    { insert: { image: 'https://x/y.png' } },
    { insert: '<script>alert(1)</script>' },
    { insert: '\n', attributes: { header: 2, align: 'sideways' } },
    { insert: 'item\n', attributes: { list: 'bullet' } },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ops[0], { insert: 'Bold', attributes: { bold: true } });
  assert.deepEqual(r.ops[1], { insert: ' link', attributes: { link: 'https://example.com/x' } });
  assert.deepEqual(r.ops[2], { insert: ' bad<script>alert(1)</script>' }, 'unsafe link dropped; text kept as text');
  assert.ok(r.ops.every((op) => typeof op.insert === 'string'), 'embeds are dropped');
  assert.deepEqual(r.ops[3], { insert: '\n', attributes: { header: 2 } });
  assert.ok(r.ops[r.ops.length - 1].insert.endsWith('\n'));
});

test('sizes, colours, highlights, scripts and alignment: only the listed values are kept and rendered', () => {
  const r = C.normalizeDelta([
    { insert: 'Big', attributes: { size: 'huge', color: C.TEXT_COLORS[0], background: C.TEXT_HIGHLIGHTS[0], script: 'super' } },
    { insert: 'x', attributes: { size: '99px', color: 'red;background:url(x)', background: '#123456', script: 'top' } },
    { insert: ' 📈 ok' },
    { insert: '\n', attributes: { align: 'justify', header: 4 } },
    { insert: 'Word', attributes: { align: 'center' } },
    { insert: '\n' },
  ]);
  assert.deepEqual(r.ops[0].attributes, { size: 'huge', color: C.TEXT_COLORS[0], background: C.TEXT_HIGHLIGHTS[0], script: 'super' });
  assert.deepEqual(r.ops[1], { insert: 'x 📈 ok' }, 'other values are dropped, emoji stay text');
  assert.deepEqual(r.ops[2].attributes, { header: 4, align: 'justify' });
  assert.deepEqual(r.ops[3], { insert: 'Word' }, 'alignment belongs to lines');
  const [line] = C.deltaToLines(r.ops);
  assert.deepEqual([line.kind, line.align, line.segments[0].size, line.segments[0].script], ['h4', 'justify', 'huge', 'super']);
});

test('table blocks: plain-text cells, equal rows, limits; image size and position', () => {
  const ok = C.checkBlock({ id: 'table123', type: 'table', rows: [['Pair', 'Pips'], ['EUR/USD'], [{ $gt: 1 }, '<b>x</b>']], align: ['right', 'evil'], caption: 'c', header: true }, 0);
  assert.deepEqual(ok.block.rows, [['Pair', 'Pips'], ['EUR/USD', ''], ['', '<b>x</b>']]);
  assert.deepEqual(ok.block.align, ['right', 'left']);
  assert.equal(C.blockHasContent(ok.block), true);
  assert.equal(C.blockHasContent(C.checkBlock({ id: 'table123', type: 'table', rows: [] }, 0).block), false);
  assert.equal(C.checkBlock({ id: 'table123', type: 'table', rows: Array(61).fill(['a']) }, 0).ok, false);
  assert.equal(C.checkBlock({ id: 'table123', type: 'table', rows: [Array(11).fill('a')] }, 0).ok, false);
  assert.equal(C.checkBlock({ id: 'table123', type: 'table', rows: [['x'.repeat(501)]] }, 0).ok, false);
  const img = (extra) => C.checkBlock({ id: 'image123', type: 'image', url: 'https://x.test/a.png', alt: '', caption: '', ...extra }, 0).block;
  assert.deepEqual([img({ size: 'small', align: 'right' }).size, img({ size: 'small', align: 'right' }).align], ['small', 'right']);
  assert.deepEqual(Object.keys(img({ size: 'x', align: 'y' })), Object.keys(img({})), 'defaults add nothing');
});

test('rich text has size limits and must be a list of runs', () => {
  assert.equal(C.normalizeDelta('<p>html</p>').ok, false);
  assert.equal(C.normalizeDelta([{ insert: 'x'.repeat(20001) }]).ok, false);
  assert.equal(C.normalizeDelta(Array.from({ length: 4001 }, () => ({ insert: 'a' }))).ok, false);
  assert.deepEqual(C.normalizeDelta([]).ops, [{ insert: '\n' }]);
});

test('rich text becomes lines for the React renderer (lists grouped, headings, quotes)', () => {
  const lines = C.deltaToLines([
    { insert: 'Title' }, { insert: '\n', attributes: { header: 2 } },
    { insert: 'one' }, { insert: '\n', attributes: { list: 'ordered' } },
    { insert: 'two', attributes: { italic: true } }, { insert: '\n', attributes: { list: 'ordered' } },
    { insert: 'quote' }, { insert: '\n', attributes: { blockquote: true } },
    { insert: 'plain\n\n' },
  ]);
  assert.deepEqual(lines.map((l) => l.kind), ['h2', 'li', 'li', 'quote', 'p']);
  assert.deepEqual(lines[2].segments, [{ text: 'two', italic: true }]);
  const groups = C.groupLines(lines);
  assert.equal(groups[1].kind, 'list');
  assert.equal(groups[1].items.length, 2);
  // The renderer never parses HTML.
  const rich = read('components/course/RichText.tsx');
  assert.doesNotMatch(rich, /dangerouslySetInnerHTML/);
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const BLOCKS = [
  { id: 'aaaaaa01', type: 'heading', text: 'Risk', level: 3 },
  { id: 'aaaaaa02', type: 'text', ops: [{ insert: 'Hello\n' }] },
  { id: 'aaaaaa03', type: 'callout', tone: 'warning', title: 'Note', text: 'Careful' },
  { id: 'aaaaaa04', type: 'image', url: 'https://res.cloudinary.com/demo/image/upload/a.png', alt: 'Chart', caption: '' },
  { id: 'aaaaaa05', type: 'video', url: 'https://www.youtube.com/watch?v=abc', caption: '' },
  { id: 'aaaaaa06', type: 'file', assetId: 'abcdefabcdefabcdefabcdef', title: 'Plan', name: 'plan.pdf', bytes: 1200 },
  { id: 'aaaaaa07', type: 'link', url: 'https://babypips.com', title: 'Pips', description: '' },
  { id: 'aaaaaa08', type: 'code', text: 'risk = 1%', label: 'Sizing' },
  { id: 'aaaaaa09', type: 'divider' },
];

test('every block type validates and is stored in a fixed shape', () => {
  const r = C.checkBlocks(BLOCKS, { assetIds: new Set(['abcdefabcdefabcdefabcdef']) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.blocks.length, 9);
  assert.equal(r.blocks[0].level, 3);
  assert.equal(r.blocks[5].kind, 'pdf', 'file kind from the name');
  assert.equal(r.blocks[5].url, undefined);
  assert.equal(r.blocks[2].tone, 'warning');
});

test('blocks are refused when unsafe, malformed or pointing at another course\'s files', () => {
  const ids = new Set(['abcdefabcdefabcdefabcdef']);
  assert.equal(C.checkBlocks('x').ok, false);
  assert.equal(C.checkBlocks([{ id: 'bad id', type: 'text', ops: [] }]).ok, false);
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'script' }]).ok, false);
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'divider' }, { id: 'aaaaaa01', type: 'divider' }]).ok, false, 'duplicate ids');
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'link', url: 'javascript:alert(1)', title: 'x' }]).ok, false);
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'video', url: 'data:text/html,hi' }]).ok, false);
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'file', assetId: 'ffffffffffffffffffffffff', title: 'x' }], { assetIds: ids }).ok, false, 'foreign file');
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'legacy', field: 'password' }]).ok, false);
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'heading', text: 'x'.repeat(201) }]).ok, false);
  assert.equal(C.checkBlocks(Array.from({ length: 201 }, (_, i) => ({ id: `blk${String(i).padStart(5, '0')}`, type: 'divider' }))).ok, false);
  // A draft may hold an unfinished media block (reported by readiness, not refused).
  assert.equal(C.checkBlocks([{ id: 'aaaaaa01', type: 'image', url: '', alt: '' }]).ok, true);
});

test('a lesson saved before the builder is shown through derived blocks, in the old page order', () => {
  const lesson = { videoUrl: 'https://youtu.be/x', description: '<p>Intro</p>', content: '<p>Body</p>', pdfUrl: 'https://x/a.pdf', resources: [{ title: 'Site', url: 'https://x', type: 'link' }, { title: 'Deck', url: 'https://x/d.pptx', type: 'slide' }] };
  const blocks = C.lessonBlocks(lesson);
  assert.deepEqual(blocks.map((b) => b.type), ['video', 'legacy', 'legacy', 'file', 'link', 'file']);
  assert.deepEqual(blocks.map((b) => b.legacyItem || null), [null, null, null, 'pdf', 'r0', 'r1']);
  assert.equal(blocks[5].kind, 'slides');
  assert.equal(C.usesBlocks(lesson), false);
  // Stored blocks win: legacy fields are no longer shown.
  assert.deepEqual(C.lessonBlocks({ ...lesson, blocks: [] }), []);
  assert.equal(C.lessonBlocks({ description: '<p><br></p>' }).length, 0, 'empty editor markup is not content');
});

test('students never receive stored file addresses or asset ids', () => {
  const view = docs.presentStudentDocuments({ _id: LESSON, blocks: [
    { id: 'aaaaaa06', type: 'file', assetId: 'abcdefabcdefabcdefabcdef', title: 'Plan', kind: 'pdf' },
    { id: 'aaaaaa07', type: 'file', url: 'https://drive.example/f', title: 'Link file', kind: 'file' },
    { id: 'aaaaaa08', type: 'file', url: 'javascript:alert(1)', title: 'Bad', kind: 'file' },
    { id: 'aaaaaa09', type: 'video', assetId: 'abcdefabcdefabcdefabcdee', caption: '' },
    { id: 'aaaaaa10', type: 'video', url: 'https://youtu.be/x', caption: '' },
  ] });
  const [a, b, c, d, e] = view.blocks;
  assert.equal(a.url, `/api/lessons/${LESSON}/document?item=b-aaaaaa06`);
  assert.equal(a.assetId, undefined);
  assert.equal(b.url, `/api/lessons/${LESSON}/document?item=b-aaaaaa07`);
  assert.deepEqual([c.url, c.available], [null, false]);
  assert.equal(d.url, `/api/lessons/${LESSON}/document?item=b-aaaaaa09`);
  assert.equal(e.url, 'https://youtu.be/x', 'linked videos keep their address, as lesson videos always have');
});

test('the document route resolves block items, legacy items and nothing else', () => {
  const lesson = { blocks: [{ id: 'aaaaaa06', type: 'file', assetId: 'abcdefabcdefabcdefabcdef' }, { id: 'aaaaaa07', type: 'file', url: 'https://drive.example/f' }, { id: 'aaaaaa08', type: 'image', url: 'https://x/i.png' }], pdfUrl: 'https://x/a.pdf' };
  assert.deepEqual(docs.resolveLessonDocumentTarget(lesson, 'b-aaaaaa06'), { assetId: 'abcdefabcdefabcdefabcdef' });
  assert.deepEqual(docs.resolveLessonDocumentTarget(lesson, 'b-aaaaaa07'), { url: 'https://drive.example/f' });
  assert.equal(docs.resolveLessonDocumentTarget(lesson, 'b-aaaaaa08'), null, 'only files and videos');
  assert.equal(docs.resolveLessonDocumentTarget(lesson, 'b-zzzzzz99'), null);
  assert.deepEqual(docs.resolveLessonDocumentTarget(lesson, 'pdf'), { url: 'https://x/a.pdf' });
  assert.equal(docs.resolveLessonDocument(lesson, 'b-aaaaaa06'), null, 'an asset is never a plain link');
  assert.equal(docs.isDocumentItem('b-../../etc'), false);
});

test('locked lessons withhold blocks, and cleanup sees images used in blocks', () => {
  assert.ok(WITHHELD_LESSON_FIELDS.includes('blocks'));
  assert.match(read('pages/api/courses/[id].ts'), /view\.blocks = null;/);
  assert.ok(LESSON_TEXT_FIELDS.includes('blocks.url'));
  // The public outline gets the module, never the content.
  const outline = access.presentLessonRead({ _id: LESSON, title: 'T', moduleId: 'mod001', blocks: [{ id: 'aaaaaa01', type: 'divider' }] }, false, COURSE);
  assert.equal(outline.moduleId, 'mod001');
  assert.equal(outline.blocks, undefined);
  assert.ok(access.presentLessonRead({ _id: LESSON, blocks: [] }, true, COURSE).blocks);
});

// ---------------------------------------------------------------------------
// Lesson saves: ownership, lifecycle, modules
// ---------------------------------------------------------------------------

const instructor = { userId: INSTRUCTOR, role: 'instructor' };
const course = (status, extra = {}) => ({ _id: COURSE, instructorId: INSTRUCTOR, status, modules: [{ id: 'mod001', title: 'One' }], assets: [{ id: 'abcdefabcdefabcdefabcdef' }], ...extra });
const lesson = { _id: LESSON, courseId: COURSE };

test('lesson saves accept validated blocks and mirror legacy fields', () => {
  const d = access.decideLessonUpdate({ member: instructor, lesson, course: course('draft'), patch: { blocks: BLOCKS, moduleId: 'mod001' } });
  assert.equal(d.ok, true, d.error);
  assert.equal(d.patch.blocks.length, 9);
  assert.equal(d.patch.videoUrl, 'https://www.youtube.com/watch?v=abc');
  assert.equal(d.patch.contentFormat, 'blocks');
  assert.equal(d.patch.moduleId, 'mod001');
});

test('lesson saves are refused for other instructors, non-drafts, foreign modules and bad content', () => {
  assert.equal(access.decideLessonUpdate({ member: { userId: OTHER, role: 'instructor' }, lesson, course: course('draft'), patch: { blocks: [] } }).status, 403);
  assert.equal(access.decideLessonUpdate({ member: instructor, lesson, course: course('published'), patch: { blocks: [] } }).status, 409);
  assert.equal(access.decideLessonUpdate({ member: { userId: OTHER, role: 'admin' }, lesson, course: course('published'), patch: { blocks: [] } }).ok, true, 'admins edit live courses');
  assert.equal(access.decideLessonUpdate({ member: instructor, lesson, course: course('draft'), patch: { moduleId: 'elsewhere' } }).status, 400);
  assert.equal(access.decideLessonUpdate({ member: instructor, lesson, course: course('draft'), patch: { blocks: [{ id: 'aaaaaa01', type: 'link', url: 'javascript:x' }] } }).status, 400);
  assert.equal(access.decideLessonUpdate({ member: { userId: OTHER, role: 'student' }, lesson, course: course('draft'), patch: { blocks: [] } }).status, 403);
});

test('a new lesson can be created straight into a module with content', () => {
  const d = access.decideLessonCreate({ member: instructor, course: course('draft'), body: { title: 'New', moduleId: 'mod001', blocks: [{ id: 'aaaaaa01', type: 'divider' }] } });
  assert.equal(d.ok, true);
  assert.equal(d.document.moduleId, 'mod001');
  assert.equal(d.document.revision, 1);
  assert.equal(d.document.blocks.length, 1);
});

test('the lesson route refuses stale saves instead of overwriting newer content', () => {
  const route = read('pages/api/lessons/[id].ts');
  assert.match(route, /baseRevision === 0\s*\? \{ \$or: \[\{ revision: 0 \}, \{ revision: \{ \$exists: false \} \}\] \}\s*: \{ revision: baseRevision \}/);
  assert.match(route, /\$inc: \{ revision: 1 \}/);
  assert.match(route, /code: 'stale_revision'/);
});

// ---------------------------------------------------------------------------
// Courses: drafts, details, responses
// ---------------------------------------------------------------------------

test('a draft can be started from a title alone; details are validated', () => {
  const d = access.decideCourseCreate({ member: instructor, body: { draftStart: true, title: '  Risk  ', summary: 'Short', objectives: ['A', '', 'B'] } });
  assert.equal(d.ok, true, d.error);
  assert.deepEqual([d.document.title, d.document.status, d.document.description, d.document.difficulty], ['Risk', 'draft', '', '']);
  assert.deepEqual(d.document.objectives, ['A', 'B']);
  assert.equal(access.decideCourseCreate({ member: instructor, body: { draftStart: true, title: '' } }).ok, false);
  // Without draftStart the full details are still required (older clients unchanged).
  assert.equal(access.decideCourseCreate({ member: instructor, body: { title: 'x' } }).ok, false);
  assert.equal(C.checkCourseDetails({ objectives: Array.from({ length: 13 }, (_, i) => `o${i}`) }).ok, false);
  assert.equal(C.checkCourseDetails({ summary: 'x'.repeat(301) }).ok, false);
  assert.equal(C.checkCourseDetails({ estimatedHours: -1 }).ok, false);
  assert.deepEqual(C.checkCourseDetails({ estimatedHours: '2.3' }).fields, { estimatedHours: 2.5 });
});

test('course responses carry the builder details only when present', () => {
  const bare = presentCourse({ _id: COURSE, title: 't', description: 'd', category: 'c', difficulty: 'beginner', thumbnail: '' });
  for (const key of COURSE_RESPONSE_FIELDS) assert.equal(typeof bare[key], 'string');
  assert.equal(bare.summary, undefined);
  const full = presentCourse({ _id: COURSE, title: 't', summary: 's', objectives: ['a', 3], estimatedHours: 4, modules: [{ id: 'mod001', title: 'One', secret: 1 }], assets: [{ publicId: 'x' }] });
  assert.equal(full.summary, 's');
  assert.deepEqual(full.objectives, ['a']);
  assert.deepEqual(full.modules, [{ id: 'mod001', title: 'One' }]);
  assert.equal(full.assets, undefined, 'stored file references never leave the server');
});

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

const L = (n) => `${'0'.repeat(23)}${n}`;

test('modules group lessons; lessons in a missing module join the first one', () => {
  const c = { modules: [{ id: 'mod001', title: 'A' }, { id: 'mod002', title: 'B' }] };
  const lessons = [
    { _id: L(1), order: 3, moduleId: 'mod002' },
    { _id: L(2), order: 1, moduleId: 'mod001' },
    { _id: L(3), order: 2, moduleId: 'gone' },
  ];
  const tree = C.curriculum(c, lessons);
  assert.deepEqual(tree.map((m) => m.lessons.map((l) => l._id)), [[L(2), L(3)], [L(1)]]);
  assert.deepEqual(C.curriculumOrder(c, lessons), [L(2), L(3), L(1)]);
  // A course from before modules: one implicit module, order unchanged.
  const legacy = C.curriculum({}, lessons);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].implicit, true);
});

test('a curriculum save must list exactly the current lessons', () => {
  const current = [L(1), L(2)];
  const ok = C.checkCurriculum([{ id: 'mod001', title: 'A', lessonIds: [L(2)] }, { id: 'mod002', title: '', lessonIds: [L(1)] }], current);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.assignments, [{ lessonId: L(2), moduleId: 'mod001', order: 1 }, { lessonId: L(1), moduleId: 'mod002', order: 2 }]);
  assert.equal(C.checkCurriculum([{ id: 'mod001', title: 'A', lessonIds: [L(1)] }], current).status, 409, 'a lesson missing');
  assert.equal(C.checkCurriculum([{ id: 'mod001', title: 'A', lessonIds: [L(1), L(2), L(3)] }], current).status, 409, 'an unknown lesson');
  assert.equal(C.checkCurriculum([{ id: 'mod001', title: 'A', lessonIds: [L(1), L(1), L(2)] }], current).ok, false, 'twice');
  assert.equal(C.checkCurriculum([{ id: 'mod001', lessonIds: [] }, { id: 'mod001', lessonIds: [L(1), L(2)] }], current).ok, false, 'duplicate module');
  assert.equal(C.checkCurriculum([], current).ok, false);
  assert.equal(C.checkCurriculum([{ id: 'x', title: 'A', lessonIds: current }], current).ok, false, 'bad module id');
});

test('curriculum edits: add, rename, reorder, move and delete modules and lessons', () => {
  const implicit = [{ id: 'course', title: '', implicit: true, lessonIds: [L(1), L(2), L(3)] }];
  const two = ops.addModule(implicit);
  assert.equal(two.length, 2);
  assert.equal(two[0].title, 'Module 1');
  assert.ok(C.MODULE_ID.test(two[0].id) && two[0].id !== 'course', 'the implicit module becomes real');
  const [a, b] = two;
  let m = ops.placeLesson(two, L(3), b.id);
  assert.deepEqual(m.map((x) => x.lessonIds), [[L(1), L(2)], [L(3)]]);
  m = ops.stepLesson(m, L(2), 1);
  assert.deepEqual(m.map((x) => x.lessonIds), [[L(1)], [L(2), L(3)]], 'down across the module edge');
  m = ops.stepLesson(m, L(2), -1);
  assert.deepEqual(m.map((x) => x.lessonIds), [[L(1), L(2)], [L(3)]]);
  assert.equal(ops.stepLesson(m, L(1), -1), null, 'already first');
  m = ops.placeLesson(m, L(1), a.id, 2);
  assert.deepEqual(m[0].lessonIds, [L(2), L(1)], 'drop after itself in the same module');
  m = ops.moveModule(m, b.id, -1);
  assert.deepEqual(m.map((x) => x.id), [b.id, a.id]);
  m = ops.renameModule(m, a.id, 'Basics');
  assert.equal(m[1].title, 'Basics');
  m = ops.deleteModule(m, b.id);
  assert.deepEqual(m.map((x) => x.lessonIds), [[L(3), L(2), L(1)]], 'lessons of a deleted first module move to the next one');
  assert.equal(ops.deleteModule(m, m[0].id), null, 'the last module stays');
  assert.deepEqual(ops.curriculumPayload(m)[0], { id: m[0].id, title: 'Basics', lessonIds: [L(3), L(2), L(1)] });
});

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

test('readiness blocks review until a course can be taught, and only suggests optional details', () => {
  const empty = C.courseReadiness({ course: { title: 'T' }, lessons: [] });
  assert.equal(empty.ready, false);
  assert.ok(empty.issues.some((i) => i.message === 'Add at least one lesson.'));
  assert.ok(empty.issues.some((i) => i.field === 'description' && i.level === 'error'));
  const base = { title: 'T', description: '<p>D</p>', category: 'risk', difficulty: 'beginner' };
  const ready = C.courseReadiness({ course: base, lessons: [{ _id: L(1), title: 'One', blocks: [{ id: 'aaaaaa01', type: 'text', ops: [{ insert: 'Hi\n' }] }] }] });
  assert.equal(ready.ready, true);
  assert.ok(ready.issues.every((i) => i.level === 'warning'), 'summary, cover and objectives are suggestions');
  const broken = C.courseReadiness({
    course: { ...base, modules: [{ id: 'mod001', title: '' }, { id: 'mod002', title: 'Empty' }] },
    lessons: [
      { _id: L(1), title: '', moduleId: 'mod001', blocks: [{ id: 'aaaaaa01', type: 'image', url: '', alt: '' }] },
      { _id: L(2), title: 'Two', moduleId: 'mod001', blocks: [{ id: 'aaaaaa02', type: 'file', assetId: 'abcdefabcdefabcdefabcdef', title: 'x' }] },
      { _id: L(3), title: 'Quiz only', moduleId: 'mod001', blocks: [] },
    ],
    quizzes: new Map([[L(3), { questions: 0, status: 'draft' }]]),
    assetIds: new Set(),
  });
  const messages = broken.issues.filter((i) => i.level === 'error').map((i) => i.message);
  assert.ok(messages.includes('Give every module a title.'));
  assert.ok(messages.includes('Give every lesson a title.'));
  assert.ok(messages.some((m) => /empty image block/.test(m)));
  assert.ok(messages.some((m) => /file that is missing/.test(m)));
  assert.ok(messages.some((m) => /quiz in "Quiz only" has no questions/.test(m)));
  assert.ok(broken.issues.some((i) => i.level === 'warning' && /"Empty" has no lessons/.test(i.message)));
  assert.ok(broken.issues.filter((i) => i.blockId).every((i) => i.lessonId), 'every content issue points at its lesson');
});

test('the status route enforces readiness before review and publishing, not for archive or restore', () => {
  const route = read('pages/api/courses/[id]/status.ts');
  assert.match(route, /if \(\(decision\.to === 'in_review' \|\| decision\.to === 'published'\) && decision\.from !== 'archived'\)/);
  assert.match(route, /code: 'course_not_ready'/);
});

// ---------------------------------------------------------------------------
// Uploaded files
// ---------------------------------------------------------------------------

test('course files must match their type by content, not only by name', () => {
  const pdf = Buffer.from('%PDF-1.7\n...');
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const exe = Buffer.from('MZ\x90\x00 this is a program');
  const mp4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  assert.equal(files.checkCourseFile({ name: 'plan.pdf', size: 1000, head: pdf }).kind, 'pdf');
  assert.equal(files.checkCourseFile({ name: 'sheet.xlsx', size: 1000, head: zip }).kind, 'sheet');
  assert.equal(files.checkCourseFile({ name: 'lesson.mp4', size: 1000, head: mp4 }).kind, 'video');
  assert.equal(files.checkCourseFile({ name: 'evil.pdf', size: 1000, head: exe }).code, 'content_mismatch');
  assert.equal(files.checkCourseFile({ name: 'evil.exe', size: 1000, head: exe }).code, 'unsupported_type');
  assert.equal(files.checkCourseFile({ name: 'page.html', size: 10, head: Buffer.from('<html>') }).code, 'unsupported_type');
  assert.equal(files.checkCourseFile({ name: 'notes.txt', size: 10, head: Buffer.from('<!DOCTYPE html><script>') }).code, 'content_mismatch');
  assert.equal(files.checkCourseFile({ name: 'data.csv', size: 10, head: Buffer.from([0x41, 0x00, 0x42]) }).code, 'content_mismatch', 'binary is not text');
  assert.equal(files.checkCourseFile({ name: 'big.pdf', size: 26 * 1024 * 1024, head: pdf }).code, 'file_too_large');
  assert.equal(files.checkCourseFile({ name: 'empty.pdf', size: 0, head: pdf }).code, 'empty_file');
  assert.equal(files.cleanFileName('../../etc/pa\u0000ss<wd>.pdf'), 'passwd.pdf');
  assert.ok(files.cleanFileName(`${'a'.repeat(300)}.pdf`).length <= 160);
});

test('uploads are owner-only, checked before storing, private, and removable only when unused', () => {
  const route = read('pages/api/courses/[id]/assets.ts');
  const owned = route.indexOf("loadOwnedCourse(db, req, courseId, { assets: { $slice: -1 } }, { edit: true })");
  const parse = route.indexOf('form.parse(req)');
  assert.ok(owned > 0 && parse > owned, 'ownership and the edit rule are checked before the file is read');
  assert.match(route, /checkCourseFile\(\{ name: file\.originalFilename, size: file\.size, head: await readHead\(file\.filepath\) \}\)/);
  assert.match(route, /fs\.promises\.rm\(file\.filepath, \{ force: true \}\)/);
  assert.match(route, /'blocks\.assetId': assetId/);
  assert.match(route, /code: 'asset_in_use'/);
  const storage = read('lib/course-assets.ts');
  assert.match(storage, /type: resourceType === 'video' \? 'authenticated' : 'private'/);
  assert.match(storage, /if \(process\.env\.NODE_ENV === 'production'\) return null;/, 'local storage never in production');
  // Builder access: 404 for anyone who does not own the course.
  const owner = read('lib/course-builder-access.ts');
  assert.match(owner, /return \{ ok: false, status: 404, error: 'Course not found' \};/);
});

test('the student lesson page and the previews share one renderer', () => {
  const page = read('pages/courses/[id]/lessons/[lessonId].tsx');
  const preview = read('components/course/LessonPreview.tsx');
  for (const source of [page, preview]) {
    assert.match(source, /<LessonHeader\b/);
    assert.match(source, /<LessonBlocks\b/);
    assert.match(source, /<LessonActivities\b/);
  }
  assert.doesNotMatch(page, /InstructorLessonEditor/);
  assert.equal(fs.existsSync(path.join(ROOT, 'components/InstructorLessonEditor.tsx')), false);
  // Preview never records anything: no completion call, no attempts, no submissions.
  assert.doesNotMatch(preview, /apiClient\.(post|put|delete)/);
  assert.doesNotMatch(read('components/course/LessonActivities.tsx').split("export default function LessonActivities")[1].split("if (props.mode === 'student')")[0] || '', /apiClient/);
});

test('course management shows titles and descriptions as text, never as HTML tags', () => {
  // Older lessons and courses can hold HTML in their titles and descriptions (rich-text editor).
  assert.equal(C.plainText('<p>Understanding <strong>Pips</strong> &amp; Lots</p>'), 'Understanding Pips & Lots');
  assert.equal(C.plainText('<h2>Risk &#8211; basics</h2>'), 'Risk – basics');
  assert.equal(C.plainText('<script>alert(1)</script>Title'), 'Title');
  const curriculum = read('lib/course-curriculum.js');
  assert.match(curriculum, /title: C\.plainText\(course\.title\)/);
  assert.match(curriculum, /title: C\.plainText\(l\.title\)/);
  for (const file of ['pages/instructor/dashboard.tsx', 'pages/instructor/quizzes.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /\{course\.description\}/, `${file} renders a raw description`);
    assert.doesNotMatch(source, />\{course\.title\}</, `${file} renders a raw title`);
  }
});
