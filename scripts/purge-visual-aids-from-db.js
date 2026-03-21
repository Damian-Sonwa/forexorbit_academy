/**
 * Optional: persist placeholder cleanup in MongoDB (empty screenshots + remove "Visual aids" heading/paragraph only).
 * Does not strip images — re-run after changing strip rules if needed.
 * Usage: MONGO_URI="..." node scripts/purge-visual-aids-from-db.js
 */
const { MongoClient } = require('mongodb');

const VISUAL_AIDS_LABEL = 'visual\\s*aid[s]?';

function stripVisualAidsPlaceholderHtml(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html;
  s = s.replace(new RegExp(`<h([1-6])[^>]*>\\s*${VISUAL_AIDS_LABEL}\\s*</h\\1>`, 'gi'), '');
  s = s.replace(
    new RegExp(
      `<p[^>]*>\\s*(?:<(?:strong|b|em|i)[^>]*>)?\\s*${VISUAL_AIDS_LABEL}\\s*(?:</(?:strong|b|em|i)>)?\\s*</p>`,
      'gi'
    ),
    ''
  );
  s = s.replace(new RegExp(`<div[^>]*>\\s*${VISUAL_AIDS_LABEL}\\s*</div>`, 'gi'), '');
  return s;
}

function transformLesson(doc) {
  const out = { ...doc };
  if (typeof out.description === 'string') {
    out.description = stripVisualAidsPlaceholderHtml(out.description);
  }
  if (typeof out.summary === 'string') {
    out.summary = stripVisualAidsPlaceholderHtml(out.summary);
  }
  if (typeof out.content === 'string') {
    out.content = stripVisualAidsPlaceholderHtml(out.content);
  }
  if (out.lessonSummary && typeof out.lessonSummary === 'object') {
    const ls = { ...out.lessonSummary };
    if (typeof ls.overview === 'string') {
      ls.overview = stripVisualAidsPlaceholderHtml(ls.overview);
    }
    if (typeof ls.summary === 'string') {
      ls.summary = stripVisualAidsPlaceholderHtml(ls.summary);
    }
    ls.screenshots = [];
    out.lessonSummary = ls;
  }
  return out;
}

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGO_URI');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const lessons = client.db().collection('lessons');
  const all = await lessons.find({}).toArray();
  for (const doc of all) {
    const updated = transformLesson(doc);
    await lessons.replaceOne({ _id: doc._id }, updated);
  }
  console.log('Replaced lessons:', all.length);
  await client.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
