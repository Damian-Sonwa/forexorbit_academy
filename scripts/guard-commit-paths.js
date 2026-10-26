/**
 * Rejects a commit that stages ignored secrets or the local database URI.
 * Prints paths and fixed messages only. Does not print secret values.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const denied = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$).+/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)backups(\/|$)/,
  /(^|\/)forexorbit-evidence(\/|$)/,
  /\.pem$/,
  /\.pack$/,
  /\.pack\.gz$/,
  /\.log$/,
];

function stagedFiles() {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function localUri() {
  if (!fs.existsSync('.env')) return '';
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((item) => item.startsWith('MONGO_URI=')) || '';
  return line.slice('MONGO_URI='.length).trim().replace(/^["']|["']$/g, '');
}

function localSeedPassword() {
  if (!fs.existsSync('.env')) return '';
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((item) => item.startsWith('DEMO_SEED_PASSWORD=')) || '';
  return line.slice('DEMO_SEED_PASSWORD='.length).trim().replace(/^["']|["']$/g, '');
}

function username(value) {
  const normalized = value.replace(/^mongodb\+srv:\/\//, 'https://').replace(/^mongodb:\/\//, 'http://');
  try {
    return decodeURIComponent(new URL(normalized).username || '');
  } catch (error) {
    return '';
  }
}

const files = stagedFiles();
const blocked = files.filter((file) => denied.some((pattern) => pattern.test(file.replace(/\\/g, '/'))));
if (blocked.length > 0) {
  console.error('Commit blocked. These paths are local-only:');
  blocked.forEach((file) => console.error(file));
  process.exit(1);
}

const uri = localUri();
const seedPassword = localSeedPassword();
for (const file of files) {
  if (!fs.existsSync(file) || fs.statSync(file).size > 1024 * 1024) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (uri && text.includes(uri)) {
    console.error(`Commit blocked. ${file} contains the local database URI.`);
    process.exit(1);
  }
  if (seedPassword && text.includes(seedPassword)) {
    console.error(`Commit blocked. ${file} contains the local demo seed password.`);
    process.exit(1);
  }
  const marker = 'mongodb+srv://';
  const plain = 'mongodb://';
  let start = 0;
  while (start < text.length) {
    const srvAt = text.indexOf(marker, start);
    const plainAt = text.indexOf(plain, start);
    let at = -1;
    let token = '';
    if (plainAt !== -1 && (srvAt === -1 || plainAt < srvAt)) {
      at = plainAt;
      token = plain;
    } else if (srvAt !== -1) {
      at = srvAt;
      token = marker;
    } else {
      break;
    }
    let end = at + token.length;
    while (end < text.length && !/\s/.test(text[end]) && text[end] !== '"' && text[end] !== "'" && text[end] !== '`') end += 1;
    const found = text.slice(at, end);
    const user = username(found);
    if (user === 'forexorbit_app' || user === 'Damian25') {
      console.error(`Commit blocked. ${file} contains a database username that must stay out of Git.`);
      process.exit(1);
    }
    start = end;
  }
}
