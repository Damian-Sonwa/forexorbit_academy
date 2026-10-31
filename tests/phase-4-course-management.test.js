/**
 * Phase 4 (course catalogue and content management) regression tests.
 * Pure decisions plus flows on tests/helpers/memory-db.js. No real database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
const { memoryDb } = require('./helpers/memory-db');

const { safeLinkUrl } = require('../lib/safe-url');
const access = require('../lib/account-access');
const lifecycle = require('../lib/course-lifecycle');
const { decideEnroll } = require('../lib/enrollment-state');
const { priceCourseLessons, listCourseLessons, OUTLINE_LESSON_PROJECTION } = require('../lib/course-lesson-list');
const progress = require('../lib/course-progress');
const order = require('../lib/lesson-order');
const deletion = require('../lib/course-deletion');
const media = require('../lib/media-cleanup');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const INSTRUCTOR = '64b000000000000000000001';
const OTHER_INSTRUCTOR = '64b000000000000000000002';
const ADMIN = '64b000000000000000000003';
const SUPER = '64b000000000000000000004';
const STUDENT = '64b000000000000000000005';
const COURSE = '64b0000000000000000000c1';

const member = (role, userId) => ({ role, userId });
const instructor = member('instructor', INSTRUCTOR);
const otherInstructor = member('instructor', OTHER_INSTRUCTOR);
const admin = member('admin', ADMIN);
const superadmin = member('superadmin', SUPER);
const student = member('student', STUDENT);
const course = (status, extra = {}) => ({ _id: COURSE, instructorId: INSTRUCTOR, ...(status === undefined ? {} : { status }), ...extra });
const CONTROL = String.fromCharCode(1);
const ZERO_WIDTH = String.fromCharCode(0x200b);

// ---------------------------------------------------------------------------
// H3: link policy
// ---------------------------------------------------------------------------

test('H3: only http(s) and relative links are allowed, however the scheme is disguised', () => {
  for (const url of ['https://www.babypips.com/learn', 'http://example.com/a?b=1#c', '/courses/1', 'notes.pdf', '#part-2', '//cdn.example.com/x.pdf']) {
    assert.equal(safeLinkUrl(url), url, url);
  }
  assert.equal(safeLinkUrl('  https://example.com  '), 'https://example.com');
  for (const url of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x',
    `${CONTROL}javascript:x`, `java${ZERO_WIDTH}script:x`, 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>',
    'data:image/png;base64,AAAA', 'file:///etc/passwd', 'blob:https://x/y', 'https://', 'https://exa mple.com',
    'ftp://example.com/file.pdf', 'ws://example.com/socket', 'gopher://example.com/x',
    'x'.repeat(2049), '', null, undefined, 42, { href: 'https://x' },
  ]) {
    assert.equal(safeLinkUrl(url), null, JSON.stringify(url));
  }
  assert.equal(safeLinkUrl('/x', { allowRelative: false }), null);
});

test('H3: lesson saves refuse unsafe resource, video and PDF links before anything is stored', () => {
  for (const [field, value] of [
    ['videoUrl', 'javascript:alert(1)'],
    ['pdfUrl', 'data:application/pdf;base64,AA'],
    ['resources', [{ type: 'link', url: ' JaVaScRiPt:alert(document.cookie)', title: 'Notes' }]],
    ['resources', [{ type: 'link', url: 'https://ok.example', title: 'A' }, { type: 'pdf', url: 'vbscript:x', title: 'B' }]],
  ]) {
    const update = access.decideLessonUpdate({
      member: instructor,
      lesson: { _id: 'l1', courseId: COURSE },
      course: course('draft'),
      patch: { title: 'T', [field]: value },
    });
    assert.equal(update.ok, false, field);
    assert.equal(update.status, 400);
    assert.equal(update.code, 'invalid_url');
    const create = access.decideLessonCreate({ member: admin, course: course('published'), body: { title: 'T', [field]: value } });
    assert.equal(create.ok, false);
    assert.equal(create.code, 'invalid_url');
  }
  const ok = access.checkLessonInput({
    videoUrl: ' https://youtu.be/abc ',
    pdfUrl: '',
    resources: [{ type: 'pdf', url: '/files/a.pdf', title: 'Guide' }, { type: 'link', url: '', title: '' }],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.videoUrl, 'https://youtu.be/abc');
  assert.equal(ok.patch.pdfUrl, null);
  assert.deepEqual(ok.patch.resources, [{ type: 'pdf', url: '/files/a.pdf', title: 'Guide' }], 'blank editor rows are not stored');
  assert.equal(access.checkLessonInput({ resources: 'x' }).ok, false);
  assert.equal(access.checkLessonInput({ resources: new Array(51).fill({ url: '/a', title: 'a' }) }).ok, false);
  assert.equal(access.checkLessonInput({ requiredLevel: 'expert' }).ok, false);
  assert.equal(access.checkLessonInput({ requiredLevel: 'Advanced' }).patch.requiredLevel, 'advanced');
  assert.equal(access.checkLessonInput({ order: 1 }).patch.order, undefined, 'positions are assigned by the server');
});

test('H3: a stored unsafe link renders as plain content, never as a live link', () => {
  const ts = require('typescript');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { loadModule } = require('./helpers/ts-loader');
  const source = read('components/SafeExternalLink.tsx');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (id) => (id === '@/lib/safe-url' ? loadModule('lib/safe-url.js') : require(id));
  new Function('exports', 'require', 'module', code)(mod.exports, localRequire, mod);
  const Link = mod.exports.default;
  const render = (href) => renderToStaticMarkup(React.createElement(Link, { href, className: 'c' }, 'Notes'));
  for (const href of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '']) {
    const html = render(href);
    assert.equal(html.includes('<a'), false, html);
    assert.equal(/href=/i.test(html), false, html);
    assert.ok(html.includes('Notes'));
  }
  const good = render('https://example.com/a');
  assert.ok(good.includes('href="https://example.com/a"'));
  assert.ok(good.includes('rel="noopener noreferrer"'));
  const page = read('pages/courses/[id]/lessons/[lessonId].tsx');
  assert.equal(page.includes('href={resource.url}\n                    target'), false);
  assert.ok(page.includes('<SafeExternalLink'));
  assert.ok(page.includes('safeLinkUrl(displayLesson.videoUrl)'));
  for (const file of ['pages/instructor/dashboard.tsx', 'pages/instructor/lessons.tsx']) {
    assert.ok(read(file).includes('<SafeExternalLink'), file);
  }
});

// ---------------------------------------------------------------------------
// Batch 1: course input and instructor assignment
// ---------------------------------------------------------------------------

const body = (extra = {}) => ({ title: 'Price action', description: 'Candles', category: 'technical', difficulty: 'beginner', ...extra });
const active = { userId: OTHER_INSTRUCTOR, role: 'instructor', status: 'approved' };

test('course create and edit apply the same field rules', () => {
  const cases = [
    [{ title: ' ' }, 'title'],
    [{ title: 'x'.repeat(201) }, 'title'],
    [{ description: 'x'.repeat(20001) }, 'description'],
    [{ category: 'x'.repeat(81) }, 'category'],
    [{ difficulty: 'expert' }, 'difficulty'],
    [{ thumbnail: 'javascript:alert(1)' }, 'thumbnail'],
    [{ thumbnail: 'data:image/png;base64,AA' }, 'thumbnail'],
  ];
  for (const [patch, field] of cases) {
    const created = access.decideCourseCreate({ member: instructor, body: body(patch) });
    assert.equal(created.ok, false, `create ${field}`);
    assert.equal(created.status, 400);
    const edited = access.decideCourseUpdate({ member: admin, course: course('published', body()), patch });
    assert.equal(edited.ok, false, `edit ${field}`);
    assert.equal(edited.status, 400);
    assert.equal(edited.field, field);
  }
  const fine = access.decideCourseUpdate({ member: instructor, course: course('draft', body()), patch: { title: ' New title ', thumbnail: 'https://res.cloudinary.com/x/image/upload/a.png' } });
  assert.equal(fine.ok, true);
  assert.deepEqual(fine.patch, { title: 'New title', thumbnail: 'https://res.cloudinary.com/x/image/upload/a.png' });
});

test('an existing over-long description can be saved unchanged; changing it applies the limit', () => {
  const legacy = 'x'.repeat(25000);
  const stored = course('draft', body({ description: legacy }));
  const same = access.decideCourseUpdate({ member: instructor, course: stored, patch: { ...body({ description: legacy }), title: 'Renamed' } });
  assert.equal(same.ok, true);
  assert.equal(same.patch.description, undefined, 'unchanged fields are not rewritten');
  const changed = access.decideCourseUpdate({ member: instructor, course: stored, patch: { description: `${legacy}!` } });
  assert.equal(changed.ok, false);
});

test('Decision 5: only an active instructor account can be assigned, on create and on edit', () => {
  const assignees = [
    ['active instructor', active, true],
    ['instructor stored before statuses existed', { userId: OTHER_INSTRUCTOR, role: 'instructor' }, true],
    ['student', { userId: OTHER_INSTRUCTOR, role: 'student', status: 'approved' }, false],
    ['admin', { userId: OTHER_INSTRUCTOR, role: 'admin', status: 'approved' }, false],
    ['super admin', { userId: OTHER_INSTRUCTOR, role: 'superadmin', status: 'approved' }, false],
    ['suspended instructor', { userId: OTHER_INSTRUCTOR, role: 'instructor', status: 'suspended' }, false],
    ['deactivated instructor', { userId: OTHER_INSTRUCTOR, role: 'instructor', status: 'deactivated' }, false],
    ['pending instructor', { userId: OTHER_INSTRUCTOR, role: 'instructor', status: 'pending' }, false],
    ['rejected instructor', { userId: OTHER_INSTRUCTOR, role: 'instructor', status: 'rejected' }, false],
    ['unknown account', null, false],
    ['account record for a different id', { userId: STUDENT, role: 'instructor', status: 'approved' }, false],
  ];
  for (const staff of [admin, superadmin]) {
    for (const [label, assignee, allowed] of assignees) {
      const created = access.decideCourseCreate({ member: staff, body: body({ instructorId: OTHER_INSTRUCTOR }), assignee });
      assert.equal(created.ok, allowed, `${staff.role} create: ${label}`);
      const edited = access.decideCourseUpdate({ member: staff, course: course('published', body()), patch: { instructorId: OTHER_INSTRUCTOR }, assignee });
      assert.equal(edited.ok, allowed, `${staff.role} edit: ${label}`);
      if (allowed) {
        assert.equal(created.document.instructorId, OTHER_INSTRUCTOR);
        assert.equal(edited.patch.instructorId, OTHER_INSTRUCTOR);
      } else {
        assert.equal(created.status, 400);
        assert.equal(created.code, 'invalid_instructor');
      }
    }
    const noAssignee = access.decideCourseCreate({ member: staff, body: body() });
    assert.equal(noAssignee.ok, false, 'staff must assign an instructor; they are not assignees');
    const garbage = access.decideCourseCreate({ member: staff, body: body({ instructorId: '{"$ne":null}' }), assignee: active });
    assert.equal(garbage.ok, false);
  }
  const forged = access.decideCourseCreate({ member: instructor, body: body({ instructorId: OTHER_INSTRUCTOR }), assignee: active });
  assert.equal(forged.ok, false);
  assert.equal(forged.status, 403, 'an instructor cannot assign another instructor');
  const kept = access.decideCourseUpdate({ member: instructor, course: course('draft', body()), patch: { instructorId: OTHER_INSTRUCTOR }, assignee: active });
  assert.equal(kept.ok, true);
  assert.equal(kept.patch.instructorId, undefined, 'an instructor cannot hand the course to someone else');
  const own = access.decideCourseCreate({ member: instructor, body: body() });
  assert.deepEqual([own.document.instructorId, own.document.status, own.document.freePreviewExplicit], [INSTRUCTOR, 'draft', true]);
  for (const role of ['student', undefined]) {
    assert.equal(access.decideCourseCreate({ member: member(role, STUDENT), body: body() }).status, 403);
  }
});

test('Decision 5: the routes look the assignee up in the stored accounts, never from the request', () => {
  const create = read('pages/api/courses/index.ts');
  assert.match(create, /db\.collection\('users'\)\.findOne\(\s*\{ _id: new ObjectId\(requestedId\) \},\s*\{ projection: \{ role: 1, status: 1 \} \}/);
  const update = read('pages/api/courses/[id].ts');
  assert.match(update, /\{ _id: new ObjectId\(requestedInstructor\) \},\s*\{ projection: \{ role: 1, status: 1 \} \}/);
  assert.ok(update.includes('decideCourseUpdate({'));
  assert.equal(update.includes('...req.body'), false);
});

test('L1: a withdrawn enrolment is not reported as enrolled, and grants no access', () => {
  const source = read('pages/api/courses/[id].ts');
  assert.ok(source.includes('const activeEnrollment = isActiveEnrollment(enrollment);'));
  assert.ok(source.includes('enrolled: activeEnrollment,'));
  assert.equal(source.includes('enrolled: Boolean(enrollment)'), false);
  const withdrawn = { userId: STUDENT, courseId: COURSE, progress: 40, active: false, withdrawnAt: new Date() };
  const read1 = access.decideLessonRead({ member: student, lesson: { _id: 'l1', courseId: COURSE }, course: course('published'), enrollment: withdrawn });
  assert.equal(read1.ok, false);
  assert.equal(lifecycle.canSeeCourse(student, course('archived'), { activeEnrollment: false }), false);
});

// ---------------------------------------------------------------------------
// Batch 3: lifecycle
// ---------------------------------------------------------------------------

test('Decision 1: every lifecycle change is checked by role and current state', () => {
  const roles = { owner: instructor, other: otherInstructor, admin, superadmin, student };
  const expected = {
    'draft>in_review': ['owner', 'admin', 'superadmin'],
    'in_review>draft': ['owner', 'admin', 'superadmin'],
    'in_review>published': ['admin', 'superadmin'],
    'published>archived': ['admin', 'superadmin'],
    'archived>published': ['admin', 'superadmin'],
    'draft>published': ['superadmin'],
    'draft>archived': ['superadmin'],
    'in_review>archived': ['superadmin'],
  };
  for (const from of lifecycle.COURSE_STATUSES) {
    for (const to of lifecycle.COURSE_STATUSES) {
      if (from === to) continue;
      for (const [key, who] of Object.entries(roles)) {
        const decision = lifecycle.decideCourseTransition({ member: who, course: course(from), to });
        const allowed = (expected[`${from}>${to}`] || []).includes(key);
        assert.equal(decision.ok, allowed, `${key}: ${from} -> ${to}`);
        if (allowed) {
          assert.equal(decision.to, to);
          assert.deepEqual(decision.filter.deletionStartedAt, { $exists: false });
        }
      }
    }
  }
  assert.equal(lifecycle.decideCourseTransition({ member: instructor, course: course('in_review'), to: 'published' }).status, 403, 'instructors never publish');
  assert.equal(lifecycle.decideCourseTransition({ member: admin, course: course('published'), to: 'draft' }).code, 'invalid_transition');
  assert.equal(lifecycle.decideCourseTransition({ member: admin, course: course('draft'), to: 'deleted' }).status, 400);
  assert.equal(lifecycle.decideCourseTransition({ member: admin, course: course('draft'), to: 'draft' }).code, 'status_unchanged');
  assert.equal(lifecycle.decideCourseTransition({ member: admin, course: null, to: 'draft' }).status, 404);
  assert.deepEqual(lifecycle.availableTransitions(instructor, course('draft')), ['in_review']);
  assert.deepEqual(lifecycle.availableTransitions(admin, course('in_review')), ['draft', 'published']);
});

test('Decision 1: courses stored before the lifecycle are published; unknown states are treated as drafts', () => {
  assert.equal(lifecycle.courseStatus(course(undefined)), 'published');
  assert.equal(lifecycle.courseStatus(course('weird')), 'draft');
  assert.equal(lifecycle.courseStatus(course(null)), 'draft');
  const legacy = lifecycle.decideCourseTransition({ member: admin, course: course(undefined), to: 'archived' });
  assert.deepEqual(legacy.filter.$or, [{ status: 'published' }, { status: { $exists: false } }]);
  assert.deepEqual(lifecycle.publicCourseFilter(), { $or: [{ status: 'published' }, { status: { $exists: false } }] });
});

test('Decision 1: catalogue visibility per role', () => {
  const pub = lifecycle.publicCourseFilter();
  assert.deepEqual(lifecycle.courseVisibilityFilter(null), pub);
  assert.deepEqual(lifecycle.courseVisibilityFilter(student), pub);
  assert.deepEqual(lifecycle.courseVisibilityFilter(admin), {});
  assert.deepEqual(lifecycle.courseVisibilityFilter(superadmin), {});
  const enrolled = lifecycle.courseVisibilityFilter(student, { activeCourseIds: ['c1'] });
  assert.deepEqual(enrolled.$or[1], { status: 'archived', _id: { $in: ['c1'] } });
  const own = lifecycle.courseVisibilityFilter(instructor, { instructorIdValues: [INSTRUCTOR] });
  assert.deepEqual(own.$or[1], { instructorId: { $in: [INSTRUCTOR] } });
  const route = read('pages/api/courses/index.ts');
  assert.ok(route.includes('$and: [buildCourseListQuery(req.query), courseVisibilityFilter(member, { activeCourseIds, instructorIdValues })]'));
  assert.ok(read('lib/public-catalog.ts').includes('.find(publicCourseFilter(),'));
});

test('Decision 1: who can open a course and its lessons in each state', () => {
  const table = [
    ['draft', student, true, false], ['draft', otherInstructor, false, false], ['draft', instructor, false, true],
    ['draft', admin, false, true], ['in_review', student, true, false], ['in_review', instructor, false, true],
    ['published', student, false, true], ['published', otherInstructor, false, true],
    ['archived', student, true, true], ['archived', student, false, false], ['archived', otherInstructor, false, false],
    ['archived', instructor, false, true], ['archived', admin, false, true],
  ];
  for (const [status, who, enrolled, visible] of table) {
    assert.equal(lifecycle.canSeeCourse(who, course(status), { activeEnrollment: enrolled }), visible, `${who.role} ${status} enrolled=${enrolled}`);
  }
  const enrollment = { userId: STUDENT, courseId: COURSE, progress: 10 };
  for (const [status, allowed] of [['draft', false], ['in_review', false], ['published', true], ['archived', true]]) {
    const decision = access.decideLessonRead({ member: student, lesson: { _id: 'l1', courseId: COURSE }, course: course(status), enrollment });
    assert.equal(decision.ok, allowed, `lesson read ${status}`);
    const update = access.decideProgressUpdate({ member: student, lesson: { _id: 'l1', courseId: COURSE }, course: course(status), enrollment });
    assert.equal(update.ok, allowed, `progress ${status}`);
  }
});

test('Decision 1: new enrolments and checkouts only for published courses; enrolled students keep archived courses', () => {
  const base = { role: 'student', userId: STUDENT, courseId: COURSE, existing: null };
  assert.equal(decideEnroll({ ...base, course: course('published') }).ok, true);
  assert.equal(decideEnroll({ ...base, course: course(undefined) }).ok, true, 'legacy courses stay open');
  assert.equal(decideEnroll({ ...base, course: course('archived') }).code, 'course_archived');
  assert.equal(decideEnroll({ ...base, course: course('draft') }).status, 404);
  assert.equal(decideEnroll({ ...base, course: course('in_review') }).status, 404);
  const withdrawn = { userId: STUDENT, courseId: COURSE, active: false, withdrawnAt: new Date() };
  assert.equal(decideEnroll({ ...base, course: course('archived'), existing: withdrawn }).ok, false, 'no re-enrolment into an archived course');
  assert.equal(lifecycle.decideCourseOpenForSale(course('archived')).status, 409);
  assert.equal(lifecycle.decideCourseOpenForSale(null).status, 404);
  const checkout = read('pages/api/payments/paystack/init-course.ts');
  assert.ok(checkout.includes('const open = decideCourseOpenForSale(course);'));
  assert.ok(checkout.includes('{ projection: { _id: 1, status: 1 } }'));
});

test('Decision 1: an instructor edits content only while the course is a draft; admins in any state', () => {
  const lesson = { _id: 'l1', courseId: COURSE };
  const questions = [{ question: 'Q', options: ['a', 'b'], correctAnswer: 1 }];
  for (const status of ['in_review', 'published', 'archived', undefined]) {
    const c = course(status, body());
    for (const decision of [
      access.decideCourseUpdate({ member: instructor, course: c, patch: { title: 'Changed' } }),
      access.decideLessonCreate({ member: instructor, course: c, body: { title: 'New' } }),
      access.decideLessonUpdate({ member: instructor, lesson, course: c, patch: { title: 'Changed' } }),
      access.decideLessonDelete({ member: instructor, lesson, course: c }),
      access.decideQuizMutation({ member: instructor, lesson, course: c, questions }),
      order.decideLessonReorder({ member: instructor, course: c, lessonIds: [], currentLessonIds: [] }),
    ]) {
      assert.equal(decision.ok, false, `instructor in ${status}`);
      assert.equal(decision.status, 409);
      assert.equal(decision.code, 'course_not_editable');
    }
    for (const staff of [admin, superadmin]) {
      assert.equal(access.decideLessonUpdate({ member: staff, lesson, course: c, patch: { title: 'Fix' } }).ok, true);
      assert.equal(access.decideCourseUpdate({ member: staff, course: c, patch: { title: 'Fix' } }).ok, true);
    }
  }
  assert.equal(access.decideLessonUpdate({ member: instructor, lesson, course: course('draft'), patch: { title: 'Draft edit' } }).ok, true);
  assert.equal(access.decideLessonUpdate({ member: otherInstructor, lesson, course: course('draft'), patch: { title: 'x' } }).status, 403);
  assert.equal(access.decideLessonUpdate({ member: student, lesson, course: course('draft'), patch: { title: 'x' } }).status, 403);
  // The routes re-check the state at write time.
  assert.ok(read('pages/api/courses/[id].ts').includes("const sameState = course!.status === undefined ? { status: { $exists: false } } : { status: course!.status };"));
  assert.ok(read('pages/api/lessons/[id].ts').includes("status: 'draft' }, { limit: 1 }"));
});

test('Decision 1: the status route writes only from the checked state and records an audit entry', async () => {
  const source = read('pages/api/courses/[id]/status.ts');
  assert.ok(source.includes('decideCourseTransition({ member, course, to })'));
  assert.ok(source.includes('{ _id: new ObjectId(decision.courseId), ...decision.filter }'));
  assert.ok(source.includes('AUDIT_COLLECTION'));
  assert.ok(source.includes("withAuth(handler, ['instructor', 'admin', 'superadmin'])"));
  // The conditional write: a second change from the same starting state finds nothing to update.
  const db = memoryDb({ courses: [{ _id: new ObjectId(COURSE), instructorId: INSTRUCTOR, status: 'in_review' }] });
  const decision = lifecycle.decideCourseTransition({ member: admin, course: course('in_review'), to: 'published' });
  const first = await db.collection('courses').updateOne({ _id: new ObjectId(COURSE), ...decision.filter }, { $set: { status: 'published' } });
  const second = await db.collection('courses').updateOne({ _id: new ObjectId(COURSE), ...decision.filter }, { $set: { status: 'published' } });
  assert.deepEqual([first.matchedCount, second.matchedCount], [1, 0]);
});

test('Decision 1: unpublished courses and lessons are not served to students', async () => {
  const courseId = new ObjectId();
  const lessonId = new ObjectId();
  const seed = (status) => memoryDb({
    courses: [{ _id: courseId, instructorId: INSTRUCTOR, status }],
    lessons: [{ _id: lessonId, courseId: String(courseId), title: 'One', order: 1, content: '<p>secret</p>', isFreePreview: true }],
    progress: [{ userId: STUDENT, courseId: String(courseId), progress: 0, completedLessons: [] }],
  });
  for (const status of ['draft', 'in_review']) {
    const result = await listCourseLessons(seed(status), { member: student, courseId: String(courseId), env: {} });
    assert.equal(result.status, 404, status);
    const other = await listCourseLessons(seed(status), { member: otherInstructor, courseId: String(courseId), env: {} });
    assert.equal(other.status, 404);
    const own = await listCourseLessons(seed(status), { member: instructor, courseId: String(courseId), env: {} });
    assert.equal(own.ok, true);
  }
  const archived = await listCourseLessons(seed('archived'), { member: student, courseId: String(courseId), env: {} });
  assert.equal(archived.ok, true, 'an actively enrolled student keeps an archived course');
  assert.equal(archived.lessons[0].content, '<p>secret</p>');
});

// ---------------------------------------------------------------------------
// Batch 2: free previews, ordering, progress
// ---------------------------------------------------------------------------

const ENTITLEMENT = { staff: false, coursePaid: false, legacyLessonIds: new Set() };
const priced = (lessons, explicitPreview) => {
  const map = priceCourseLessons(lessons, ENTITLEMENT, { PAYSTACK_SECRET_KEY: 'x' }, { explicitPreview });
  return Object.fromEntries(lessons.map((lesson) => [String(lesson._id), map.get(String(lesson._id)).locked ? 'locked' : 'free']));
};

test('Decision 3: with explicit previews, position never makes a lesson free or paid', () => {
  const lessons = [
    { _id: 'a', order: 1, isFreePreview: false },
    { _id: 'b', order: 2, isFreePreview: true },
    { _id: 'c', order: 3 },
  ];
  assert.deepEqual(priced(lessons, true), { a: 'locked', b: 'free', c: 'locked' });
  const reordered = [{ ...lessons[2], order: 1 }, { ...lessons[0], order: 2 }, { ...lessons[1], order: 3 }];
  assert.deepEqual(priced(reordered, true), { c: 'locked', a: 'locked', b: 'free' }, 'reordering keeps the same free lesson');
  const added = [...lessons, { _id: 'd', order: 0 }];
  assert.deepEqual(priced(added, true), { a: 'locked', b: 'free', c: 'locked', d: 'locked' }, 'a new lesson at the top is not free');
  const marked = [{ _id: 'x', order: 5, isFirstLesson: true }, { _id: 'y', order: 1 }];
  assert.deepEqual(priced(marked, true), { x: 'free', y: 'locked' }, 'the older explicit isFirstLesson flag still counts');
  const map = priceCourseLessons(lessons, ENTITLEMENT, { PAYSTACK_SECRET_KEY: 'x' }, { explicitPreview: true });
  assert.equal(map.get('b').isFreePreview, true);
  assert.equal(map.get('b').monetization.isFreeTier, true);
  assert.equal(map.get('a').isFreePreview, false);
});

test('Decision 3: courses not yet migrated keep their earlier free lesson, so no student loses it', () => {
  const lessons = [{ _id: 'a', order: 1 }, { _id: 'b', order: 2 }];
  assert.deepEqual(priced(lessons, false), { a: 'free', b: 'locked' });
});

test('Decision 3: a free preview opens that lesson only, and only for enrolled students', async () => {
  const courseId = new ObjectId();
  const [free, paid] = [new ObjectId(), new ObjectId()];
  const db = memoryDb({
    courses: [{ _id: courseId, instructorId: INSTRUCTOR, status: 'published', freePreviewExplicit: true }],
    lessons: [
      { _id: paid, courseId: String(courseId), title: 'Paid', order: 1, content: '<p>paid</p>', videoUrl: 'https://v/paid' },
      { _id: free, courseId: String(courseId), title: 'Free', order: 2, content: '<p>free</p>', isFreePreview: true },
    ],
    progress: [{ userId: STUDENT, courseId: String(courseId), progress: 0, completedLessons: [] }],
  });
  const result = await listCourseLessons(db, { member: student, courseId: String(courseId), env: { PAYSTACK_SECRET_KEY: 'x' } });
  const byTitle = Object.fromEntries(result.lessons.map((lesson) => [lesson.title, lesson]));
  assert.equal(byTitle.Free.content, '<p>free</p>');
  assert.equal(byTitle.Paid.locked, true);
  assert.equal(byTitle.Paid.content, null);
  assert.equal(byTitle.Paid.videoUrl, null);
  const outsider = await listCourseLessons(db, { member: member('student', '64b0000000000000000000ff'), courseId: String(courseId), env: { PAYSTACK_SECRET_KEY: 'x' } });
  assert.equal(outsider.lessons.find((lesson) => lesson.title === 'Free').content, undefined, 'an unenrolled student gets the outline only');
});

test('Decision 3: the free-preview flag is saved only through the checked lesson input', () => {
  assert.equal(access.checkLessonInput({ isFreePreview: true }).patch.isFreePreview, true);
  assert.equal(access.checkLessonInput({ isFreePreview: 'yes' }).patch.isFreePreview, undefined);
  const created = access.decideLessonCreate({ member: instructor, course: course('draft'), body: { title: 'T' } });
  assert.equal(created.document.isFreePreview, false);
  assert.equal(created.document.order, undefined, 'the route assigns the position');
  assert.ok(read('lib/lesson-monetization.ts').includes('isFreePreviewSlot(self as Record<string, unknown>, index, explicitPreview)'), 'the quiz paywall uses the same rule');
});

test('M3: new lessons get distinct positions at the end, even when created at the same moment', async () => {
  const courseId = new ObjectId();
  const db = memoryDb({
    courses: [{ _id: courseId }],
    lessons: [{ _id: new ObjectId(), courseId: String(courseId), order: 4 }, { _id: new ObjectId(), courseId: String(courseId), order: 4 }],
  });
  const positions = await Promise.all([1, 2, 3].map(() => order.nextLessonPosition(db, String(courseId))));
  assert.deepEqual([...positions].sort(), [5, 6, 7]);
  assert.equal(db.docs('courses')[0].lessonOrderVersion, 3, 'each new lesson invalidates pending reorders');
});

test('M3: a reorder must list exactly the current lessons and loses to any concurrent change', async () => {
  const ids = [new ObjectId(), new ObjectId(), new ObjectId()].map(String);
  const c = course('draft');
  const decide = (lessonIds, who = instructor, target = c) => order.decideLessonReorder({ member: who, course: target, lessonIds, currentLessonIds: ids });
  assert.equal(decide([ids[2], ids[0], ids[1]]).ok, true);
  assert.equal(decide([ids[0], ids[0], ids[1]]).status, 400, 'duplicate');
  assert.equal(decide([ids[0], ids[1]]).status, 409, 'missing lesson');
  assert.equal(decide([...ids, String(new ObjectId())]).status, 409, 'unknown lesson');
  assert.equal(decide(['not-an-id']).status, 400);
  assert.equal(decide('x').status, 400);
  assert.equal(decide(ids, otherInstructor).status, 403);
  assert.equal(decide(ids, student).status, 403);
  assert.equal(decide(ids, admin, course('published')).ok, true);

  const courseId = new ObjectId(COURSE);
  const db = memoryDb({
    courses: [{ _id: courseId, lessonOrderVersion: 7 }],
    lessons: ids.map((id, i) => ({ _id: new ObjectId(id), courseId: COURSE, order: i + 1 })),
  });
  const newOrder = [ids[2], ids[0], ids[1]];
  assert.equal(await order.applyLessonReorder(db, { courseId: COURSE, lessonIds: newOrder, version: 7 }), true);
  assert.deepEqual(db.docs('lessons').sort((a, b) => a.order - b.order).map((l) => String(l._id)), newOrder);
  assert.equal(await order.applyLessonReorder(db, { courseId: COURSE, lessonIds: ids, version: 7 }), false, 'a stale reorder is refused');
  const positions = db.docs('lessons').map((l) => l.order).sort();
  assert.deepEqual(positions, [1, 2, 3], 'no duplicate positions');
  assert.equal(await order.applyLessonReorder(memoryDb({ courses: [{ _id: courseId }], lessons: [] }), { courseId: COURSE, lessonIds: [], version: undefined }), true);
});

test('M3: lesson saves cannot move a lesson; deleting one invalidates pending reorders', () => {
  assert.equal(access.checkLessonInput({ title: 'x', order: 99 }).patch.order, undefined);
  const del = read('pages/api/lessons/[id].ts');
  assert.ok(del.includes('await touchLessonSet(db, decision.courseId);'));
  const create = read('pages/api/lessons/index.ts');
  assert.ok(create.includes('const order = await nextLessonPosition(db, decision.courseId);'));
});

test('M1: progress counts only lessons that still exist and never passes 100', () => {
  assert.equal(progress.progressPercent(['a', 'b', 'gone1', 'gone2'], ['a', 'b', 'c', 'd']), 50);
  assert.equal(progress.progressPercent(['a', 'b', 'c', 'x', 'y'], ['a', 'b', 'c']), 100);
  assert.equal(progress.progressPercent(['a', 'a'], ['a', 'b']), 50, 'duplicates count once');
  assert.equal(progress.progressPercent(['a'], []), 0);
});

test('Decision 4: completion is kept when lessons are added; inflated legacy rows are not trusted', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const recorded = progress.courseCompletion({ enrollment: { completedLessons: ['a'], completedAt: at }, currentLessonIds: ['a', 'b', 'c'] });
  assert.deepEqual([recorded.complete, recorded.basis], [true, 'recorded']);
  assert.ok(recorded.percent < 100, 'the percentage shows how much of the current course is covered');
  const current = progress.courseCompletion({ enrollment: { completedLessons: ['a', 'b', 'gone'] }, currentLessonIds: ['a', 'b'] });
  assert.deepEqual([current.complete, current.basis], [true, 'current']);
  const historical = progress.courseCompletion({ enrollment: { completedLessons: ['a', 'b'], progress: 100 }, currentLessonIds: ['a', 'b', 'new'] });
  assert.deepEqual([historical.complete, historical.basis], [true, 'historical']);
  const inflated = progress.courseCompletion({ enrollment: { completedLessons: ['a', 'gone'], progress: 100 }, currentLessonIds: ['a', 'b'] });
  assert.deepEqual([inflated.complete, inflated.basis], [false, 'unverified']);
  const fresh = progress.courseCompletion({ enrollment: { completedLessons: ['a'], progress: 50 }, currentLessonIds: ['a', 'b'] });
  assert.equal(fresh.complete, false);

  const fields = progress.progressFields({ enrollment: { completedLessons: ['a', 'gone'], progress: 100 }, currentLessonIds: ['a', 'b'] });
  assert.equal(fields.progress, 50);
  assert.equal(fields.legacyProgress, 100, 'the unverified value is kept for review');
  assert.equal(fields.completedAt, undefined);
  const again = progress.progressFields({ enrollment: { completedLessons: ['a', 'gone'], progress: 50, legacyProgress: 100 }, currentLessonIds: ['a', 'b'] });
  assert.equal(again.legacyProgress, undefined, 'never overwritten');
});

test('M1: recording completions is atomic and recomputes against current lessons', async () => {
  const courseId = new ObjectId();
  const ids = [new ObjectId(), new ObjectId()];
  const db = memoryDb({
    lessons: ids.map((id) => ({ _id: id, courseId: String(courseId) })),
    progress: [{ _id: new ObjectId(), userId: STUDENT, courseId: String(courseId), completedLessons: ['deleted-lesson'], progress: 50 }],
  });
  await Promise.all(ids.map((id) => progress.recordLessonCompletion(db, { userId: STUDENT, courseId: String(courseId), lessonId: String(id) })));
  const row = db.docs('progress')[0];
  assert.equal(row.completedLessons.length, 3, 'both parallel completions kept, history kept');
  assert.equal(row.progress, 100);
  assert.ok(row.completedAt instanceof Date);
  const firstCompletion = row.completedAt;
  db.docs('lessons').push({ _id: new ObjectId(), courseId: String(courseId) });
  await progress.recomputeCourseProgress(db, String(courseId));
  assert.ok(Math.abs(db.docs('progress')[0].progress - 66.67) < 0.1, 'a new lesson lowers coverage');
  assert.equal(db.docs('progress')[0].completedAt, firstCompletion, 'and keeps the completion');
  assert.equal(await progress.recordLessonCompletion(db, { userId: 'nobody', courseId: String(courseId), lessonId: 'x' }), null);
});

test('M1: lesson deletion and creation recount enrolments; certificates use completion, not the stored number', () => {
  assert.ok(read('pages/api/lessons/[id].ts').includes('await recomputeCourseProgress(db, decision.courseId);'));
  assert.ok(read('pages/api/lessons/index.ts').includes('await recomputeCourseProgress(db, decision.courseId);'));
  const cert = read('pages/api/certificates/index.ts');
  assert.ok(cert.includes('const completion = courseCompletion({ enrollment: userProgress, currentLessonIds });'));
  assert.equal(cert.includes('userProgress.progress < 100'), false);
  for (const file of ['pages/api/progress/index.ts', 'pages/api/quizzes/[lessonId].ts', 'server.js']) {
    const source = read(file);
    assert.ok(source.includes('recordLessonCompletion('), file);
    assert.equal(source.includes('completedLessons.length / courseLessons.length'), false, file);
  }
});

// ---------------------------------------------------------------------------
// Batch 4: deletion
// ---------------------------------------------------------------------------

test('Decision 2: only the Super Admin deletes permanently, and never a published course', () => {
  for (const who of [admin, instructor, student, null]) {
    const decision = deletion.decideCourseDeletion({ member: who, course: course('archived') });
    assert.equal(decision.ok, false);
    assert.equal(decision.status, 403);
    assert.equal(decision.code, 'archive_instead');
  }
  assert.equal(deletion.decideCourseDeletion({ member: superadmin, course: course('published') }).code, 'course_published');
  assert.equal(deletion.decideCourseDeletion({ member: superadmin, course: course(undefined) }).code, 'course_published', 'legacy courses are published');
  assert.equal(deletion.decideCourseDeletion({ member: superadmin, course: null }).status, 404);
  for (const status of ['draft', 'in_review', 'archived']) {
    assert.equal(deletion.decideCourseDeletion({ member: superadmin, course: course(status) }).ok, true, status);
  }
});

function deletionSeed(extra = {}) {
  const courseId = new ObjectId(COURSE);
  const lessonId = new ObjectId();
  return {
    lessonId,
    db: memoryDb({
      courses: [{ _id: courseId, status: 'archived', title: 'Old', thumbnail: '' }],
      lessons: [{ _id: lessonId, courseId: COURSE, title: 'L', content: '<p>x</p>' }],
      quizzes: [{ _id: new ObjectId(), lessonId: String(lessonId), questions: [] }],
      assignments: [{ _id: new ObjectId(), courseId: COURSE, title: 'A' }],
      ...extra,
    }),
  };
}

test('Decision 2: a course with any protected record is refused and nothing is deleted', async () => {
  const kinds = {
    progress: { courseId: COURSE, userId: STUDENT },
    userCourseAccess: { courseId: COURSE, userId: STUDENT },
    coursePurchases: { courseId: COURSE },
    paystackPaymentIntents: { courseId: COURSE },
    paystackPayments: { courseId: COURSE },
    paymentExceptions: { courseId: COURSE },
    certificates: { courseId: COURSE, userId: STUDENT },
    quizScores: { courseId: COURSE, userId: STUDENT },
    assignmentSubmissions: { courseId: COURSE },
    classes: { courseId: new ObjectId(COURSE) },
  };
  for (const [collection, row] of Object.entries(kinds)) {
    const { db } = deletionSeed({ [collection]: [row] });
    const result = await deletion.deleteCoursePermanently(db, { courseId: COURSE, from: 'archived', actor: { userId: SUPER } });
    assert.equal(result.ok, false, collection);
    assert.equal(result.code, 'course_has_dependents');
    assert.ok(result.dependents.length >= 1);
    assert.equal(db.docs('courses').length, 1, `${collection}: course kept`);
    assert.equal(db.docs('lessons').length, 1, `${collection}: lessons kept`);
    assert.equal(db.docs('courses')[0].deletionStartedAt, undefined, 'the claim is released');
  }
  for (const collection of ['userLessonAccess', 'lessonPurchases', 'messages']) {
    const { db, lessonId } = deletionSeed();
    db.docs(collection).push({ lessonId: String(lessonId) });
    const result = await deletion.deleteCoursePermanently(db, { courseId: COURSE, from: 'archived', actor: { userId: SUPER } });
    assert.equal(result.code, 'course_has_dependents', collection);
  }
});

test('Decision 2: a course without history is deleted with its lessons, quizzes and assignments, and audited', async () => {
  const { db } = deletionSeed({ adminAuditLog: [] });
  const result = await deletion.deleteCoursePermanently(db, {
    courseId: COURSE,
    from: 'archived',
    actor: { userId: SUPER, email: 'owner@example.com' },
    assetsOf: () => ['forexorbit/instructors/abc'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.deleted, { lessons: 1, quizzes: 1, assignments: 1 });
  assert.deepEqual(result.assets, ['forexorbit/instructors/abc']);
  for (const name of ['courses', 'lessons', 'quizzes', 'assignments']) assert.equal(db.docs(name).length, 0, name);
  const audit = db.docs('adminAuditLog');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'course_deleted');
  assert.equal(audit[0].entityId, COURSE);
});

test('Decision 2: the deletion claim stops a second delete or a status change running at the same time', async () => {
  const { db } = deletionSeed();
  db.docs('courses')[0].deletionStartedAt = new Date();
  const blocked = await deletion.deleteCoursePermanently(db, { courseId: COURSE, from: 'archived', actor: { userId: SUPER } });
  assert.equal(blocked.code, 'course_changed');
  const restore = lifecycle.decideCourseTransition({ member: admin, course: course('archived'), to: 'published' });
  const written = await db.collection('courses').updateOne({ _id: new ObjectId(COURSE), ...restore.filter }, { $set: { status: 'published' } });
  assert.equal(written.matchedCount, 0, 'no restore while a deletion holds the course');
  db.docs('courses')[0].deletionStartedAt = new Date(Date.now() - deletion.CLAIM_TTL_MS - 1000);
  const retried = await deletion.deleteCoursePermanently(db, { courseId: COURSE, from: 'archived', actor: { userId: SUPER } });
  assert.equal(retried.ok, true, 'an abandoned claim expires');
  const moved = deletionSeed().db;
  const stale = await deletion.deleteCoursePermanently(moved, { courseId: COURSE, from: 'draft', actor: { userId: SUPER } });
  assert.equal(stale.code, 'course_changed', 'the state checked must still hold');
});

test('Decision 2: the UI describes archive and permanent deletion accurately', () => {
  for (const file of ['pages/admin/index.tsx', 'pages/instructor/courses/[courseId].tsx']) {
    const source = read(file);
    assert.equal(source.includes('This will also delete all associated lessons'), false, file);
    assert.ok(source.includes("user?.role === 'superadmin'"), `${file}: delete offered to the Super Admin only`);
    assert.ok(source.includes('archive it instead'), file);
  }
  const route = read('pages/api/courses/[id].ts');
  assert.ok(route.includes('decideCourseDeletion({'));
  assert.ok(route.includes('deleteCoursePermanently(db, {'));
  assert.equal(route.includes("courses.deleteOne({ _id: new ObjectId(id as string) })"), false);
});

// ---------------------------------------------------------------------------
// Batch 5: outline, uploads, rate limits
// ---------------------------------------------------------------------------

test('M4: the outline reads navigation fields, not lesson bodies', async () => {
  assert.equal(OUTLINE_LESSON_PROJECTION.content, undefined);
  assert.equal(OUTLINE_LESSON_PROJECTION.lessonSummary, undefined);
  assert.equal(OUTLINE_LESSON_PROJECTION.resources, undefined);
  assert.equal(OUTLINE_LESSON_PROJECTION.videoUrl, undefined);
  assert.equal(OUTLINE_LESSON_PROJECTION.isFreePreview, 1);
  const courseId = new ObjectId();
  const db = memoryDb({
    courses: [{ _id: courseId, instructorId: INSTRUCTOR, status: 'published' }],
    lessons: [{ _id: new ObjectId(), courseId: String(courseId), title: 'One', order: 1 }],
  });
  await listCourseLessons(db, { member: student, courseId: String(courseId), env: {}, outline: true });
  const lessonFind = db.log.find((entry) => entry.name === 'lessons' && entry.method === 'find');
  assert.equal(lessonFind.options.projection, OUTLINE_LESSON_PROJECTION);
  await listCourseLessons(db, { member: student, courseId: String(courseId), env: {} });
  const full = db.log.filter((entry) => entry.name === 'lessons' && entry.method === 'find')[1];
  assert.equal(full.options, undefined, 'the full list (lesson readers) is unchanged');
  assert.ok(read('pages/api/courses/[id]/lessons.ts').includes('outline,'));
});

test('M4: the outline blurb check still recognises a copy of the body from its first characters', () => {
  const view = access.presentLessonRead({ _id: 'l', title: 'T', description: 'Same text', outlineContentHead: ' Same text ' }, false, 'c');
  assert.equal(view.description, undefined, 'a description that is the body is not shown as a blurb');
  const blurb = access.presentLessonRead({ _id: 'l', title: 'T', description: 'Short intro', outlineContentHead: '<p>Long body</p>' }, false, 'c');
  assert.equal(blurb.description, 'Short intro');
  assert.equal(blurb.outlineContentHead, undefined, 'the head is never sent');
});

test('L2: only this account\'s course-content images are cleanup candidates', () => {
  const env = { CLOUDINARY_CLOUD_NAME: 'forexorbit' };
  const html = [
    '<img src="https://res.cloudinary.com/forexorbit/image/upload/v1712/forexorbit/instructors/abc123.png">',
    '<img src="https://res.cloudinary.com/forexorbit/image/upload/f_auto,q_auto,c_limit,w_960/v1/forexorbit/visual-aids/def.jpg">',
    '<img src="https://res.cloudinary.com/forexorbit/image/upload/v1/forexorbit/profiles/me.png">',
    '<img src="https://res.cloudinary.com/someone-else/image/upload/v1/forexorbit/instructors/zzz.png">',
    '<a href="https://example.com/forexorbit/instructors/x.png">x</a>',
  ].join('');
  assert.deepEqual(media.courseAssetIds(html, env).sort(), ['forexorbit/instructors/abc123', 'forexorbit/visual-aids/def']);
  assert.deepEqual(media.courseAssetIds(html, {}), [], 'without the cloud name nothing is considered');
  const before = { content: html, resources: [{ url: 'https://res.cloudinary.com/forexorbit/image/upload/v2/forexorbit/instructors/res.png' }] };
  const after = { content: '<img src="https://res.cloudinary.com/forexorbit/image/upload/v1712/forexorbit/instructors/abc123.png">', resources: [] };
  assert.deepEqual(media.removedAssets(before, after, media.LESSON_TEXT_FIELDS, env).sort(), ['forexorbit/instructors/res', 'forexorbit/visual-aids/def']);
});

test('L2: cleanup never deletes an image still referenced elsewhere, reports by default, and survives storage failures', async () => {
  const env = { CLOUDINARY_CLOUD_NAME: 'forexorbit' };
  const db = memoryDb({
    lessons: [{ _id: 1, content: '<img src="https://res.cloudinary.com/forexorbit/image/upload/v1/forexorbit/instructors/shared.png">' }],
    courses: [{ _id: 2, thumbnail: 'https://res.cloudinary.com/forexorbit/image/upload/v1/forexorbit/instructors/thumb.png' }],
    instructors: [{ _id: 3, imageUrl: 'https://res.cloudinary.com/forexorbit/image/upload/v1/forexorbit/instructors/face.png' }],
  });
  const destroyed = [];
  const destroy = async (id) => {
    if (id.endsWith('broken')) throw new Error('storage down');
    destroyed.push(id);
  };
  const ids = ['forexorbit/instructors/shared', 'forexorbit/instructors/thumb', 'forexorbit/instructors/face', 'forexorbit/instructors/orphan', 'forexorbit/instructors/broken'];
  const report = await media.cleanupUnreferencedAssets(db, ids, { destroy, env });
  assert.equal(report.mode, 'report');
  assert.deepEqual(destroyed, [], 'nothing is deleted until MEDIA_CLEANUP=delete');
  assert.deepEqual(report.candidates.sort(), ['forexorbit/instructors/broken', 'forexorbit/instructors/orphan']);
  const live = await media.cleanupUnreferencedAssets(db, ids, { destroy, env: { ...env, MEDIA_CLEANUP: 'delete' } });
  assert.deepEqual(live.kept.sort(), ['forexorbit/instructors/face', 'forexorbit/instructors/shared', 'forexorbit/instructors/thumb']);
  assert.deepEqual(live.deleted, ['forexorbit/instructors/orphan']);
  assert.deepEqual(live.failed, ['forexorbit/instructors/broken']);
});

test('L2: uploads use random names, always remove the temporary file, and log no email addresses', () => {
  const cloud = read('lib/cloudinary.ts');
  assert.equal(cloud.includes('${options.userId}_${Date.now()}'), false);
  assert.equal((cloud.match(/public_id: randomPublicId\(\)/g) || []).length, 2);
  const handler = read('lib/course-image-upload.ts');
  assert.ok(handler.includes('} finally {\n    removeTemp(tempPaths);') || handler.includes('} finally {\r\n    removeTemp(tempPaths);'));
  for (const file of ['pages/api/upload/visual-aid.ts', 'pages/api/upload/instructor.ts', 'lib/course-image-upload.ts']) {
    assert.equal(/req\.user[!?]?\.email/.test(read(file)), false, file);
  }
  assert.ok(read('pages/api/upload/visual-aid.ts').includes("withAuth(uploadVisualAid, ['instructor', 'admin', 'superadmin'])"));
  assert.ok(read('pages/api/upload/instructor.ts').includes("withAuth(uploadInstructorImage, ['admin', 'superadmin', 'instructor'])"));
});

test('L4: authoring and uploads are rate limited per account; a failed shared store refuses', async () => {
  const limits = require('../lib/content-rate-limit');
  const getDb = async () => ({ collection: () => ({}) });
  const userId = String(new ObjectId());
  const responses = [];
  const res = () => {
    const r = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; responses.push(this); return this; } };
    return r;
  };
  for (let i = 0; i < limits.UPLOAD_RULES[0].max; i += 1) {
    assert.equal(await limits.allowRequest(limits.uploadLimiter, { userId, res: res(), getDb, env: {} }), true);
  }
  const blocked = res();
  assert.equal(await limits.allowRequest(limits.uploadLimiter, { userId, res: blocked, getDb, env: {} }), false);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  assert.equal(await limits.allowRequest(limits.uploadLimiter, { userId: String(new ObjectId()), res: res(), getDb, env: {} }), true, 'other accounts are unaffected');
  const down = res();
  const failing = async () => { throw new Error('store unreachable'); };
  assert.equal(await limits.allowRequest(limits.authoringLimiter, { userId: String(new ObjectId()), res: down, getDb: failing, env: { SHARED_RATE_LIMIT: 'mongodb' } }), false);
  assert.equal(down.statusCode, 503);
  for (const file of ['pages/api/courses/index.ts', 'pages/api/courses/[id].ts', 'pages/api/courses/[id]/status.ts', 'pages/api/courses/[id]/lesson-order.ts', 'pages/api/lessons/index.ts', 'pages/api/lessons/[id].ts', 'pages/api/lessons/[id]/summary.ts']) {
    assert.ok(read(file).includes('allowRequest(authoringLimiter'), file);
  }
  assert.ok(read('lib/course-image-upload.ts').includes('allowRequest(uploadLimiter'));
});

// ---------------------------------------------------------------------------
// Migration script (memory-db)
// ---------------------------------------------------------------------------

test('migration: the default run only reads, even if the code tries to write', async () => {
  const migration = require('../scripts/phase-4-course-migration');
  const db = memoryDb({ courses: [{ _id: new ObjectId() }], lessons: [], progress: [] });
  const result = await migration.run(db, { log: () => {} });
  assert.equal(result.applied, false);
  assert.equal(db.docs('courses')[0].status, undefined);
  const guarded = migration.readOnly(db);
  assert.throws(() => guarded.collection('courses').updateOne({}, { $set: { a: 1 } }), /read-only/, 'refused before any request is sent');
  assert.throws(() => guarded.collection('courses').deleteMany, /read-only/);
});

test('migration: --apply needs the planned counts and a rollback file; completion only when asked', () => {
  const { parseArgs } = require('../scripts/phase-4-course-migration');
  const base = ['node', 'script', '--database', 'Forex_elearning'];
  assert.deepEqual(parseArgs(base).steps, ['status', 'preview']);
  assert.match(parseArgs([...base, '--apply', '--rollback-file', 'r.json']).error, /--expect status=<n>,previewCourses=<n>,previewLessons=<n>/);
  assert.match(parseArgs([...base, '--apply', '--expect', 'status=1,previewCourses=1,previewLessons=1']).error, /--rollback-file/);
  assert.match(parseArgs([...base, '--steps', 'status,completion', '--apply', '--rollback-file', 'r', '--expect', 'status=1']).error, /completion=<n>/);
  assert.match(parseArgs([...base, '--steps', 'everything']).error, /--steps/);
  assert.match(parseArgs([...base, '--expect', 'status=x']).error, /--expect/);
  assert.match(parseArgs(['node', 'script']).error, /--database/);
  const ok = parseArgs([...base, '--apply', '--rollback-file', 'r.json', '--expect', 'status=6,previewCourses=6,previewLessons=6']);
  assert.deepEqual([ok.apply, ok.expect.status, ok.rollbackFile], [true, 6, 'r.json']);
});

function migrationSeed() {
  const legacy = new ObjectId();
  const explicit = new ObjectId();
  const lessons = { first: new ObjectId(), second: new ObjectId(), flagged: new ObjectId(), last: new ObjectId() };
  const at = new Date('2026-05-01T00:00:00Z');
  const all = Object.values(lessons).map(String);
  return {
    ids: { legacy, explicit, ...lessons },
    db: memoryDb({
      courses: [{ _id: legacy }, { _id: explicit, status: 'draft', freePreviewExplicit: true }],
      lessons: [
        { _id: lessons.second, courseId: String(legacy), order: 2 },
        { _id: lessons.first, courseId: String(legacy), order: 1 },
        { _id: lessons.flagged, courseId: String(legacy), order: 3, isFirstLesson: true, isFreePreview: false },
        { _id: lessons.last, courseId: String(legacy), order: 4 },
      ],
      progress: [
        { _id: new ObjectId(), courseId: String(legacy), completedLessons: all, progress: 100, updatedAt: at },
        { _id: new ObjectId(), courseId: String(legacy), completedLessons: all, progress: 100 },
        { _id: new ObjectId(), courseId: String(legacy), completedLessons: [all[0], all[1], all[2], 'deleted-lesson'], progress: 100, updatedAt: at },
        { _id: new ObjectId(), courseId: String(legacy), completedLessons: [all[0]], progress: 25, updatedAt: at },
      ],
      certificates: [{ _id: new ObjectId(), courseId: String(legacy), userId: 'u' }],
    }),
  };
}

test('migration: apply stops before any write when the data changed since the dry run', async () => {
  const migration = require('../scripts/phase-4-course-migration');
  const { db } = migrationSeed();
  const files = [];
  const result = await migration.run(db, {
    apply: true,
    expect: { status: 2, previewCourses: 1, previewLessons: 1 },
    rollbackFile: 'r.json',
    writeFile: (...a) => files.push(a),
    log: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.applied, false);
  assert.match(result.mismatches[0], /status: planned 1, expected 2/);
  assert.equal(files.length, 0, 'no rollback file, no write');
  assert.equal(db.docs('courses')[0].status, undefined);
});

test('migration: default steps add only status and explicit previews; never touch progress or certificates', async () => {
  const migration = require('../scripts/phase-4-course-migration');
  const { db, ids } = migrationSeed();
  const progressBefore = JSON.stringify(db.docs('progress'));
  const certBefore = JSON.stringify(db.docs('certificates'));
  const files = [];
  const quiet = () => {};
  const dry = await migration.run(db, { log: quiet });
  assert.deepEqual([dry.counts.status, dry.counts.previewCourses, dry.counts.previewLessons, dry.counts.previewLessonsAlreadySet], [1, 1, 1, 1]);
  const now = new Date('2026-10-31T12:00:00Z');
  const applied = await migration.run(db, {
    database: 'Forex_elearning',
    apply: true,
    expect: { status: 1, previewCourses: 1, previewLessons: 1 },
    rollbackFile: 'r.json',
    writeFile: (name, text) => files.push([name, JSON.parse(text)]),
    log: quiet,
    now,
  });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.written, { status: 1, previewLessons: 1, previewCourses: 1 });
  assert.deepEqual([applied.after.status, applied.after.previewCourses, applied.after.previewLessons], [0, 0, 0]);
  const flags = Object.fromEntries(db.docs('lessons').map((l) => [String(l._id), l.isFreePreview]));
  assert.equal(flags[String(ids.first)], true, 'the old free lesson stays free');
  assert.equal(flags[String(ids.flagged)], false, 'an explicit value is never overwritten');
  assert.equal(flags[String(ids.second)], undefined);
  assert.equal(db.docs('courses')[0].status, 'published');
  assert.equal(db.docs('courses')[1].status, 'draft', 'existing states are untouched');
  assert.equal(JSON.stringify(db.docs('progress')), progressBefore, 'progress untouched by default');
  assert.equal(JSON.stringify(db.docs('certificates')), certBefore);
  const [[name, record]] = files;
  assert.equal(name, 'r.json');
  assert.deepEqual(record.courseStatusSet, [String(ids.legacy)]);
  assert.deepEqual(record.lessonIsFreePreviewSet, [String(ids.first)]);
  assert.equal(record.database, 'Forex_elearning');
  const again = await migration.run(db, { apply: true, expect: { status: 0, previewCourses: 0, previewLessons: 0 }, rollbackFile: 'r2.json', writeFile: () => {}, log: quiet });
  assert.deepEqual(again.written, { status: 0, previewLessons: 0, previewCourses: 0 }, 'a second run changes nothing');

  const undo = await migration.rollback(db, record, { apply: true, toId: (id) => new ObjectId(id) });
  assert.deepEqual([undo['courses.status'], undo['courses.freePreviewExplicit'], undo['lessons.isFreePreview']], [1, 1, 1]);
  assert.equal(db.docs('courses')[0].status, undefined);
  assert.equal(flags[String(ids.flagged)], false);
  assert.equal(db.docs('lessons').find((l) => String(l._id) === String(ids.flagged)).isFreePreview, false, 'rollback leaves values it did not write');
});

test('migration: the completion step records only evidenced completions and never invents dates', async () => {
  const migration = require('../scripts/phase-4-course-migration');
  const { db } = migrationSeed();
  const dry = await migration.run(db, { steps: ['completion'], log: () => {} });
  assert.equal(dry.counts.completionCandidates, 3);
  assert.equal(dry.counts.completion, 1);
  assert.deepEqual(dry.counts.completionUnresolved, { deletedLessonsInHundred: 1, notAllCurrentLessons: 0, noUpdatedAt: 1 });
  const done = await migration.run(db, { steps: ['completion'], apply: true, expect: { completion: 1 }, rollbackFile: 'r', writeFile: () => {}, log: () => {} });
  assert.equal(done.written.completion, 1);
  const rows = db.docs('progress');
  assert.equal(rows[0].completedAt.toISOString(), '2026-05-01T00:00:00.000Z', 'the row\'s own date');
  assert.equal(rows[0].completionEvidence, 'phase4-migration:all-current-lessons-completed');
  assert.equal(rows[1].completedAt, undefined, 'no updatedAt: left unresolved, no invented date');
  assert.equal(rows[2].completedAt, undefined, 'a 100% that includes a deleted lesson is never marked complete');
  assert.equal(rows[2].progress, 100, 'and its stored progress is kept');
});

// ---------------------------------------------------------------------------
// Certificate safeguards (issuance policy unchanged)
// ---------------------------------------------------------------------------

test('certificates: staff input must be plain strings, so no query operator reaches the database', () => {
  const { checkStaffCertificateInput } = require('../lib/certificate-issue');
  for (const body of [
    { studentIdentifier: { $gt: '' }, courseId: COURSE },
    { studentIdentifier: ['a@b.c'], courseId: COURSE },
    { studentIdentifier: 'a@b.c', courseId: { $ne: null } },
    { studentIdentifier: 'a@b.c', courseId: 'not-an-id' },
    { studentIdentifier: '  ', courseId: COURSE },
    { studentIdentifier: 'x'.repeat(321), courseId: COURSE },
    { studentIdentifier: 'a@b.c', courseId: COURSE, reason: { $ne: 1 } },
    { studentIdentifier: 'a@b.c', courseId: COURSE, reason: 'x'.repeat(501) },
    null,
  ]) {
    const result = checkStaffCertificateInput(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.status, 400);
  }
  assert.deepEqual(checkStaffCertificateInput({ studentIdentifier: ' Student@Example.com ', courseId: COURSE }).lookup, { byEmail: 'Student@Example.com' });
  assert.deepEqual(checkStaffCertificateInput({ studentIdentifier: STUDENT.toUpperCase(), courseId: COURSE }).lookup, { byId: STUDENT });
  assert.equal(checkStaffCertificateInput({ studentIdentifier: STUDENT, courseId: COURSE, sendEmail: 'yes' }).sendEmail, false);
});

test('certificates: staff may still issue without a recorded completion, but only with a reason; the basis is recorded', () => {
  const { decideStaffCertificateIssue } = require('../lib/certificate-issue');
  const verified = decideStaffCertificateIssue({ completion: { complete: true, basis: 'current' }, reason: '' });
  assert.deepEqual([verified.ok, verified.completionBasis, verified.completionVerified], [true, 'current', true]);
  const missing = decideStaffCertificateIssue({ completion: { complete: false, basis: 'unverified' }, reason: '' });
  assert.deepEqual([missing.ok, missing.status, missing.code], [false, 400, 'reason_required']);
  const override = decideStaffCertificateIssue({ completion: { complete: false, basis: null }, reason: 'Completed in the classroom cohort' });
  assert.deepEqual([override.ok, override.completionBasis, override.completionVerified], [true, 'staff_override:not_completed', false]);
});

test('certificates: the admin route keeps its roles, audits every issue, refuses races, and logs no email', () => {
  const route = read('pages/api/admin/send-certificate.ts');
  assert.ok(route.includes('decideStaffCertificate({ role: req.user!.role })'), 'who may issue is unchanged');
  assert.ok(route.includes('checkStaffCertificateInput(req.body)'));
  assert.ok(route.includes('decideStaffCertificateIssue({ completion, reason })'));
  assert.ok(route.includes("action: 'certificate_issued_by_staff'"));
  assert.ok(route.includes('isDuplicateKey(insertError)'));
  assert.ok(route.includes('completionBasis: issue.completionBasis'));
  assert.equal(/console\.(log|error|warn)\([^)]*student\.email/.test(route), false, 'no student email in logs');
  assert.equal(route.includes('email: studentIdentifier'), false);
  const own = read('pages/api/certificates/index.ts');
  assert.ok(own.includes('isDuplicateKey(insertError)'));
});

test('certificates: the unique index is built only when the data allows it', async () => {
  const { certificateIndexReport, CERTIFICATE_UNIQUE_INDEX } = require('../lib/certificate-indexes');
  assert.deepEqual(CERTIFICATE_UNIQUE_INDEX.key, { userId: 1, courseId: 1 });
  assert.equal(CERTIFICATE_UNIQUE_INDEX.options.unique, true);
  const clean = await certificateIndexReport(memoryDb({ certificates: [{ userId: 'a', courseId: 'c' }, { userId: 'b', courseId: 'c' }] }));
  assert.deepEqual([clean.duplicatePairs, clean.safeToBuild], [0, true]);
  const dup = await certificateIndexReport(memoryDb({ certificates: [{ userId: 'a', courseId: 'c' }, { userId: 'a', courseId: 'c' }] }));
  assert.equal(dup.safeToBuild, false);
  const mixed = await certificateIndexReport(memoryDb({ certificates: [{ userId: 'a', courseId: new ObjectId(COURSE) }] }));
  assert.deepEqual([mixed.nonStringIds, mixed.safeToBuild], [1, false], 'an ObjectId and a string for the same id would not collide');
  const script = require('../scripts/certificate-indexes');
  const db = memoryDb({ certificates: [{ userId: 'a', courseId: 'c' }, { userId: 'a', courseId: 'c' }] });
  db.collection('certificates').indexes = async () => [{ name: '_id_', key: { _id: 1 } }];
  db.collection('certificates').createIndex = async () => { throw new Error('must not build'); };
  const refused = await script.run(db, { apply: true, log: () => {} });
  assert.equal(refused.ok, false);
});

test('assignments: students cannot use assignments of draft or in-review courses', () => {
  const enrollment = { userId: STUDENT, courseId: COURSE, progress: 10 };
  for (const [status, allowed] of [['draft', false], ['in_review', false], ['published', true], ['archived', true], [undefined, true]]) {
    assert.equal(access.decideAssignmentRead({ member: student, course: course(status), enrollment }).ok, allowed, String(status));
  }
  assert.equal(access.decideAssignmentRead({ member: instructor, course: course('draft'), enrollment: null }).ok, true);
  for (const file of ['pages/api/assignments/index.ts', 'pages/api/assignments/[id].ts', 'pages/api/assignments/[id]/submit.ts']) {
    assert.ok(read(file).includes('projection: { instructorId: 1, status: 1 }'), file);
  }
});

test('certificates: an account that cannot list indexes gets "unknown", never "missing", and apply refuses', async () => {
  const script = require('../scripts/certificate-indexes');
  const db = memoryDb({ certificates: [{ userId: 'a', courseId: 'c' }] });
  db.collection('certificates').indexes = async () => { const e = new Error('not allowed to do action [listIndexes]'); e.code = 13; throw e; };
  db.collection('certificates').createIndex = async () => { throw new Error('must not build'); };
  assert.equal(await script.indexState(db), 'unknown');
  const lines = [];
  const check = await script.run(db, { apply: false, log: (l) => lines.push(l) });
  assert.deepEqual([check.ok, check.state], [true, 'unknown']);
  assert.ok(lines.some((l) => /cannot list indexes/.test(l)));
  const applied = await script.run(db, { apply: true, log: () => {} });
  assert.deepEqual([applied.ok, applied.state], [false, 'unknown']);
});

test('certificates: the index script prefers a privileged connection, keeps it out of Git, and never prints it', () => {
  const script = require('../scripts/certificate-indexes');
  const read = () => 'CERTIFICATE_INDEX_MONGO_URI=mongodb://admin.example.test:27017\n';
  const outside = () => false;
  const viaFile = script.connectionFrom({ env: { MONGO_URI: 'mongodb://app.example.test:27017' }, envFile: 'C:/keys/admin.env', readFile: read, insideGitWorktree: outside });
  assert.deepEqual(viaFile, { uri: 'mongodb://admin.example.test:27017', variable: 'CERTIFICATE_INDEX_MONGO_URI (from --connection-file)' });
  const refused = script.connectionFrom({ env: {}, envFile: 'repo/.env.admin', readFile: read, insideGitWorktree: () => true });
  assert.match(refused.error, /outside any Git repository/);
  assert.equal(script.connectionFrom({ env: {}, envFile: 'x', readFile: () => { throw new Error('no'); }, insideGitWorktree: outside }).error, 'The --connection-file could not be read.');
  assert.deepEqual(script.connectionFrom({ env: { MONGO_URI: 'mongodb://app.example.test' }, envFile: null, readFile: read, insideGitWorktree: outside }).variable, 'MONGO_URI');
  assert.match(script.connectionFrom({ env: {}, envFile: null, readFile: read, insideGitWorktree: outside }).error, /No connection/);
  assert.match(script.parseArgs(['n', 's', '--database', 'Forex_elearning', '--connection-file']).error, /--connection-file <path>/);
  assert.equal(script.parseArgs(['n', 's', '--database', 'Forex_elearning', '--connection-file', 'C:/k/a.env', '--apply']).envFile, 'C:/k/a.env');
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'certificate-indexes.js'), 'utf8');
  assert.equal(/console\.(log|error)\([^)]*\buri\b[^)]*\)/.test(source), false, 'the connection string is never logged');
});

test('certificates: a collection that does not exist yet means "missing"; sparse or partial look-alikes are conflicts', async () => {
  const script = require('../scripts/certificate-indexes');
  const fresh = memoryDb({});
  fresh.collection('certificates').indexes = async () => { const e = new Error('ns does not exist'); e.code = 26; e.codeName = 'NamespaceNotFound'; throw e; };
  assert.equal(await script.indexState(fresh), 'missing');
  const make = (extra) => { const db = memoryDb({}); db.collection('certificates').indexes = async () => [{ name: '_id_', key: { _id: 1 } }, { name: 'uniq_certificate_user_course', key: { userId: 1, courseId: 1 }, unique: true, ...extra }]; return db; };
  assert.equal(await script.indexState(make({})), 'present');
  assert.equal(await script.indexState(make({ sparse: true })), 'conflicting');
  assert.equal(await script.indexState(make({ partialFilterExpression: { userId: { $exists: true } } })), 'conflicting');
});

test('routes pass the course lifecycle state to every access decision (found by the acceptance run)', () => {
  const fs = require('fs');
  const path = require('path');
  const files = [];
  (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|js)$/.test(e.name)) files.push(p); } })(path.join(__dirname, '..', 'pages', 'api'));
  files.push(path.join(__dirname, '..', 'server.js'));
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/course: [\w.!]*course \? \{ _id: [\w.!]*course\._id, instructorId: [\w.!]*course\.instructorId[^}]*\}/g)) {
      if (!m[0].includes('status')) missing.push(`${path.relative(path.join(__dirname, '..'), file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(missing, []);
  const create = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'lessons', 'index.ts'), 'utf8');
  assert.ok(create.includes('course: course ? { _id: course._id, instructorId: course.instructorId, status: course.status } : null,\n      body: req.body') || create.includes('course: course ? { _id: course._id, instructorId: course.instructorId, status: course.status } : null,\r\n      body: req.body'));
});

test('lib has no JavaScript module that shadows a TypeScript module with fewer exports (found by the acceptance run)', () => {
  // The bundler resolves "@/lib/x" to x.js before x.ts. lib/learning-level.js exported only
  // canAccessRoom, so updateLearningLevelIfEligible was undefined in the running app and every
  // POST /api/progress answered 500 after recording the completion.
  const fs = require('fs');
  const path = require('path');
  const lib = path.join(__dirname, '..', 'lib');
  const problems = [];
  for (const name of fs.readdirSync(lib).filter((f) => f.endsWith('.js'))) {
    const ts = path.join(lib, name.replace(/\.js$/, '.ts'));
    if (!fs.existsSync(ts)) continue;
    // Read statically: some modules (lib/mongodb.js) refuse to load without a database URI.
    const exportsObject = fs.readFileSync(path.join(lib, name), 'utf8').match(/module\.exports\s*=\s*\{([^}]*)\}/);
    const jsExports = exportsObject ? exportsObject[1].split(',').map((x) => x.trim().split(':')[0]).filter(Boolean) : [];
    const tsExports = [...fs.readFileSync(ts, 'utf8').matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]).sort();
    const missing = tsExports.filter((n) => !jsExports.includes(n));
    if (missing.length) problems.push(`${name} lacks ${missing.join(', ')}`);
  }
  assert.deepEqual(problems, []);
  assert.equal(fs.existsSync(path.join(lib, 'learning-level.js')), false);
});

test('community room seeding writes to the application database, never the URI default (found by the acceptance run)', async () => {
  const { loadModule } = require('./helpers/ts-loader');
  const used = [];
  class FakeClient {
    async connect() {}
    async close() {}
    db(name) {
      used.push(name);
      return { collection: () => ({ findOne: async () => ({ _id: 'existing' }), insertOne: async () => ({}), find: () => ({ toArray: async () => [] }) }) };
    }
  }
  const saved = { uri: process.env.MONGO_URI, name: process.env.MONGODB_DB_NAME, log: console.log };
  console.log = () => {};
  try {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017';
    process.env.MONGODB_DB_NAME = 'forexorbit_phase4_acceptance';
    const seed = loadModule('scripts/seed-rooms.js', { mongodb: { MongoClient: FakeClient } });
    await seed.seedRooms();
    delete process.env.MONGODB_DB_NAME;
    await seed.seedRooms();
    assert.deepEqual(used, ['forexorbit_phase4_acceptance', 'Forex_elearning']);
    assert.equal(used.includes(undefined), false, 'client.db() without a name is never used');
  } finally {
    console.log = saved.log;
    if (saved.uri === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = saved.uri;
    if (saved.name === undefined) delete process.env.MONGODB_DB_NAME; else process.env.MONGODB_DB_NAME = saved.name;
  }
});

test('certificates: a production run uses only the env file, only the Atlas cluster, only Forex_elearning', () => {
  const script = require('../scripts/certificate-indexes');
  const outside = () => false;
  const appOnly = script.connectionFrom({ env: { MONGO_URI: 'mongodb://app.example.test', CERTIFICATE_INDEX_MONGO_URI: 'mongodb://shell.example.test' }, envFile: 'C:/k/a.env', readFile: () => 'MONGO_URI=mongodb://other.example.test\n', insideGitWorktree: outside });
  assert.match(appOnly.error, /does not define CERTIFICATE_INDEX_MONGO_URI/, 'no fallback to MONGO_URI or the shell');
  const atlas = 'mongodb+' + 'srv://cluster0.abcde.mongodb.net/?retryWrites=true';
  const local = 'mongodb://127.0.0.1:27017';
  const cases = [
    [{ uri: atlas, database: 'Forex_elearning', envFile: 'x' }, true],
    [{ uri: atlas, database: 'Forex_elearning_dev', envFile: 'x' }, false],
    [{ uri: atlas, database: 'forexorbit_phase4_acceptance', envFile: 'x' }, false],
    [{ uri: local, database: 'Forex_elearning', envFile: 'x' }, false],
    [{ uri: local, database: 'Forex_elearning', envFile: null }, false],
    [{ uri: 'mongodb://db.example.net:27017', database: 'Forex_elearning', envFile: 'x' }, false],
    [{ uri: local, database: 'forexorbit_phase4_acceptance', envFile: null }, true],
    [{ uri: local, database: 'anything', envFile: null }, false],
    [{ uri: 'not-a-uri', database: 'Forex_elearning', envFile: 'x' }, false],
  ];
  for (const [input, ok] of cases) {
    const decision = script.decideTarget(input);
    assert.equal(decision.ok, ok, JSON.stringify({ database: input.database, envFile: input.envFile, host: script.hostsOf(input.uri) }));
    if (!ok) assert.equal(String(decision.error).includes('abcde'), false, 'refusals never echo the connection string');
  }
  assert.equal(script.decideTarget(cases[0][0]).hostKind, 'Atlas cluster (*.mongodb.net)');
});
