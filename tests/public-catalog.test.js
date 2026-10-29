/**
 * Pre-rendered landing-page catalog (lib/public-catalog.ts).
 *
 * The catalog is rendered into the page HTML, so it must read only the card fields and keep
 * descriptions to a short plain-text preview. TypeScript sources (and their `@/` imports) are
 * transpiled in memory; the database is an in-memory stand-in that records the query.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

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

const { loadPublicCatalog, CATALOG_PREVIEW_CHARS } = loadTs('lib/public-catalog.ts');

function recordingDb(rows) {
  const calls = [];
  return {
    calls,
    collection(name) {
      return {
        find(query, options) {
          calls.push({ name, query, options });
          return { toArray: async () => rows.map((row) => ({ ...row })) };
        },
      };
    },
  };
}

test('reads only the card fields, in the stored order', async () => {
  const db = recordingDb([
    { _id: 'a1', title: 'First', description: '<p>Short</p>', category: 'basics', difficulty: 'beginner', thumbnail: '' },
    { _id: 'b2', title: 'Second', description: '', category: 'technical', difficulty: 'advanced', thumbnail: 'https://x/y.png' },
  ]);
  const courses = await loadPublicCatalog(db);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].name, 'courses');
  assert.deepEqual(db.calls[0].query, {});
  assert.deepEqual(db.calls[0].options.projection, { title: 1, description: 1, category: 1, difficulty: 1, thumbnail: 1 });
  assert.deepEqual(courses.map((c) => c.id), ['a1', 'b2']);
  assert.deepEqual(Object.keys(courses[0]).sort(), ['_id', 'category', 'description', 'difficulty', 'id', 'thumbnail', 'title']);
});

test('descriptions become short plain-text previews with entities decoded', async () => {
  const long = `<p>${'Support &amp; resistance explained. '.repeat(40)}</p><script>alert(1)</script>`;
  const [course] = await loadPublicCatalog(recordingDb([{ _id: 'c', title: 'T', description: long }]));
  assert.ok(course.description.length <= CATALOG_PREVIEW_CHARS + 1);
  assert.ok(course.description.endsWith('…'));
  assert.ok(course.description.includes('Support & resistance'));
  assert.ok(!/[<>]/.test(course.description), 'no markup in the preview');
  assert.ok(!course.description.includes('alert'), 'script content is not carried over');
});

test('missing or non-string fields become empty strings so the page props serialize', async () => {
  const [course] = await loadPublicCatalog(recordingDb([{ _id: { toString: () => 'oid1' }, title: 7 }]));
  assert.deepEqual(course, { _id: 'oid1', id: 'oid1', title: '', description: '', category: '', difficulty: '', thumbnail: '' });
  assert.doesNotThrow(() => JSON.stringify(course));
});
