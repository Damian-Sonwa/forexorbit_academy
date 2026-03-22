import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const GENERIC = 'Something went wrong. Please try again later.';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'api');

function walk(dir, acc = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, acc);
    else if (f.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const replacements = [
  [/message: 'Internal server error'/g, `message: '${GENERIC}'`],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to upload file'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to upload profile photo'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to upload image'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to upload instructor image'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to upload screenshot'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to close position'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to place order\. Please check your order parameters\.'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
  [
    /res\.status\(500\)\.json\(\{\s*message:\s*error\.message\s*\|\|\s*'Failed to create demo account\. Please ensure broker API is configured correctly\.'\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`,
  ],
];

for (const file of walk(root)) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  for (const [re, rep] of replacements) {
    s = s.replace(re, rep);
  }
  // reminders/check duplicate message
  s = s.replace(
    /const errorMessage = error instanceof Error \? error\.message : 'Internal server error';\s*res\.status\(500\)\.json\(\{\s*message:\s*'Failed to check reminders',\s*message:\s*errorMessage\s*\}\)/g,
    `console.error(error); res.status(500).json({ message: '${GENERIC}' })`
  );
  if (s !== before) fs.writeFileSync(file, s, 'utf8');
}

console.log('patch-api-500-leaks done');
