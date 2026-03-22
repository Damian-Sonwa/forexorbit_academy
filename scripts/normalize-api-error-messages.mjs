/**
 * One-off migration: API error payloads use { message } and generic 500 bodies.
 * Run: node scripts/normalize-api-error-messages.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(__dirname, '..', 'pages', 'api');
const GENERIC = 'Something went wrong. Please try again later.';

function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, acc);
    else if (f.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

function patch(content) {
  let s = content;

  // Todos / reminders: dual error+technical message on 500
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to fetch todos',\s*message:\s*error instanceof Error \? error\.message : 'Internal server error'\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to create todo',\s*message:\s*error instanceof Error \? error\.message : 'Internal server error'\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to update todo',\s*message:\s*error instanceof Error \? error\.message : 'Internal server error'\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to delete todo',\s*message:\s*error instanceof Error \? error\.message : 'Internal server error'\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );

  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to fetch reminders',\s*message:\s*errorMessage\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to create reminder',\s*message:\s*errorMessage\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to update reminder',\s*message:\s*errorMessage\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*'Failed to delete reminder',\s*message:\s*errorMessage\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );

  // Standard: first property in JSON error object
  s = s.replace(/\.json\(\{\s*error\s*:/g, '.json({ message:');

  // Leaked internal messages on 500
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*message:\s*(\w+)\.message\s*\|\|\s*'Internal server error'\s*\}\)/g,
    `console.error($1); res.status(500).json({ message: '${GENERIC}' })`
  );
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*message:\s*(\w+)\.message\s*\|\|\s*"Internal server error"\s*\}\)/g,
    `console.error($1); res.status(500).json({ message: '${GENERIC}' })`
  );

  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*message:\s*errorMessage\s*\}\)/g,
    `console.error(errorMessage); res.status(500).json({ message: '${GENERIC}' })`
  );

  // Forgot-password generic 500
  s = s.replace(
    /res\.status\(500\)\.json\(\{\s*message:\s*'Failed to process request'\s*\}\)/g,
    `res.status(500).json({ message: '${GENERIC}' })`
  );

  return s;
}

let changed = 0;
for (const file of walk(apiRoot)) {
  const before = fs.readFileSync(file, 'utf8');
  const after = patch(before);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changed++;
    console.log('patched', path.relative(path.join(__dirname, '..'), file));
  }
}
console.log('done, files changed:', changed);
