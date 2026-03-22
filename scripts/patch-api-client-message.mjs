import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const subs = [
  ['error.response?.data?.error', 'error.response?.data?.message || error.response?.data?.error'],
  ['ax.response?.data?.error', 'ax.response?.data?.message || ax.response?.data?.error'],
  ['apiError.response?.data?.error', 'apiError.response?.data?.message || apiError.response?.data?.error'],
  ['err.response?.data?.error', 'err.response?.data?.message || err.response?.data?.error'],
];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) {
      let s = fs.readFileSync(p, 'utf8');
      const o = s;
      for (const [a, b] of subs) {
        s = s.split(a).join(b);
      }
      if (s !== o) {
        fs.writeFileSync(p, s);
        console.log('patched', p);
      }
    }
  }
}

walk(root);
