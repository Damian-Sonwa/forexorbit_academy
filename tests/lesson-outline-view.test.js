/**
 * Course navigation payloads (lib/lesson-outline-view.ts and the two course routes).
 * The course page and the lesson sidebar list lessons by title, order and lock state; they must
 * not download every lesson body to do it. TypeScript is transpiled in memory; no database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function loadTs(file) {
  const cache = new Map();
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    mod.require = (id) => {
      if (id.startsWith('@/')) {
        const base = path.join(ROOT, id.slice(2));
        for (const ext of ['.ts', '.tsx', '.js']) {
          if (fs.existsSync(base + ext)) return ext === '.js' ? require(base + ext) : load(base + ext);
        }
      }
      return require(id);
    };
    mod._compile(outputText, filename);
    return mod.exports;
  };
  return load(path.join(ROOT, file));
}

const { toLessonOutline, LESSON_OUTLINE_PREVIEW_CHARS } = loadTs('lib/lesson-outline-view.ts');

const unlockedView = {
  _id: 'l1',
  id: 'l1',
  courseId: 'c1',
  title: 'Support and resistance',
  type: 'video',
  order: 2,
  locked: false,
  accessible: true,
  isFirstLesson: false,
  isDemo: false,
  monetization: { requiresPurchase: false },
  description: `<p>Levels &amp; zones. ${'Price reacts at prior highs. '.repeat(30)}</p>`,
  content: `<p>${'<img src="data:image/png;base64,' + 'A'.repeat(400000) + '">'}</p>`,
  summary: 'Full essay',
  lessonSummary: { overview: 'Full essay' },
  videoUrl: 'https://videos.example/private',
  pdfUrl: 'https://files.example/notes.pdf',
  resources: [{ url: 'https://files.example/notes.pdf' }],
  quiz: { questions: [] },
};

test('an outline keeps navigation fields and drops lesson bodies', () => {
  const outline = toLessonOutline(unlockedView);
  for (const key of ['_id', 'id', 'courseId', 'title', 'type', 'order', 'locked', 'accessible', 'isFirstLesson', 'isDemo', 'monetization']) {
    assert.deepEqual(outline[key], unlockedView[key], key);
  }
  for (const key of ['content', 'summary', 'lessonSummary', 'videoUrl', 'pdfUrl', 'resources', 'quiz']) {
    assert.equal(key in outline, false, `${key} is not sent`);
  }
});

test('the description becomes a short plain-text preview', () => {
  const { description } = toLessonOutline(unlockedView);
  assert.ok(description.startsWith('Levels & zones.'));
  assert.ok(description.length <= LESSON_OUTLINE_PREVIEW_CHARS + 1);
  assert.ok(description.endsWith('…'));
  assert.doesNotMatch(description, /[<>]/);
});

test('a summary stands in for a missing description, and no text means no description', () => {
  assert.equal(toLessonOutline({ _id: 'a', summary: '<p>Quick recap</p>' }).description, 'Quick recap');
  assert.equal('description' in toLessonOutline({ _id: 'b', description: '<p><br></p>' }), false);
});

test('a locked lesson outline carries no more than the locked list row', () => {
  const locked = { _id: 'l2', title: 'Locked', order: 3, locked: true, accessible: false, monetization: { requiresPurchase: true } };
  assert.deepEqual(toLessonOutline(locked), locked);
});

test('the outline is a small fraction of the full row for an image-heavy lesson', () => {
  const full = JSON.stringify(unlockedView).length;
  const outline = JSON.stringify(toLessonOutline(unlockedView)).length;
  assert.ok(full > 400000);
  assert.ok(outline < 1000, `outline is ${outline} bytes`);
});

test('the routes offer the lighter views and the pages request them', () => {
  const lessonsRoute = read('pages/api/courses/[id]/lessons.ts');
  assert.match(lessonsRoute, /const outline = req\.query\.view === 'outline';/);
  assert.match(lessonsRoute, /outline \? lessons\.map\(toLessonOutline\) : lessons/);
  const courseRoute = read('pages/api/courses/[id].ts');
  assert.match(courseRoute, /const withLessons = req\.query\.lessons !== 'none';/);
  assert.match(courseRoute, /\.\.\.\(withLessons \? \{ lessons \} : \{\}\)/);
  // Lesson content still passes the read rule and the paywall when it is sent.
  assert.match(courseRoute, /if \(price\.locked === true\) \{\s*view\.content = null;/);

  assert.match(read('hooks/useLesson.ts'), /`\/courses\/\$\{courseId\}\/lessons\?view=outline`/);
  assert.equal((read('hooks/useCourses.ts').match(/`\/courses\/\$\{courseId\}\?lessons=none`/g) || []).length, 2);
  assert.match(read('pages/instructor/courses/[courseId].tsx'), /`\/courses\/\$\{id\}\?lessons=none`/);
});

test('opening one lesson prices it without loading the sibling lesson bodies', async () => {
  const { readLessonDetail } = require('../lib/course-lesson-list');
  const { ObjectId } = require('mongodb');
  const userId = new ObjectId();
  const courseId = new ObjectId();
  const lessonId = new ObjectId();
  const finds = [];
  const cursor = (rows) => {
    const c = { sort: () => c, project: () => c, limit: () => c, toArray: async () => rows };
    return c;
  };
  const docs = {
    users: { _id: userId, email: 's@example.com', role: 'student', status: 'approved' },
    lessons: { _id: lessonId, courseId: String(courseId), title: 'One', order: 1, content: '<p>body</p>' },
    courses: { _id: courseId, instructorId: new ObjectId(), difficulty: 'beginner' },
    progress: { userId: String(userId), courseId: String(courseId), completedLessons: [] },
  };
  const db = {
    collection: (name) => ({
      findOne: async () => docs[name] || null,
      find: (query, options) => {
        finds.push({ name, query, options });
        return cursor(name === 'lessons' ? [{ _id: lessonId, order: 1 }] : []);
      },
      countDocuments: async () => 0,
    }),
  };
  const result = await readLessonDetail(db, { userId: String(userId), lessonId: String(lessonId), env: {} });
  assert.equal(result.status, 200);
  const siblingFind = finds.find((f) => f.name === 'lessons');
  assert.deepEqual(siblingFind.options && siblingFind.options.projection, { _id: 1, order: 1, isFirstLesson: 1, isFreePreview: 1, isDemo: 1 });
});
