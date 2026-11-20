/**
 * Generates the forexorbitAppRole JSON from lib/app-database-role.js (rolePrivileges). No connection,
 * nothing is sent to Atlas: applying the role is a separate, manual owner step.
 *
 *   node scripts/atlas-role.js --database Forex_elearning            print both documents
 *   node scripts/atlas-role.js --database Forex_elearning --write    (re)write docs/audits/atlas/*.json
 *   node scripts/atlas-role.js --database Forex_elearning --check    exit 1 if the files have drifted
 *
 * Files:
 *   forexorbitAppRole.atlas-admin-api.json  Atlas Admin API / Atlas UI custom-role format
 *   forexorbitAppRole.createRole.json       mongosh db.createRole / db.updateRole format
 */
const fs = require('fs');
const path = require('path');
const { atlasAdminApiRole, createRoleDocument } = require('../lib/app-database-role');

const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'audits', 'atlas');

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  return { database, write: args.includes('--write'), check: args.includes('--check') };
}

/** File name -> exact file content (two-space JSON, trailing newline). */
function roleFiles(database) {
  const text = (value) => `${JSON.stringify(value, null, 2)}\n`;
  return {
    'forexorbitAppRole.atlas-admin-api.json': text(atlasAdminApiRole(database)),
    'forexorbitAppRole.createRole.json': text(createRoleDocument(database)),
  };
}

/** Names of files that are missing or differ from what rolePrivileges() generates. */
function driftedFiles(database, dir = OUTPUT_DIR) {
  return Object.entries(roleFiles(database))
    .filter(([name, content]) => {
      const file = path.join(dir, name);
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content;
    })
    .map(([name]) => name);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  const files = roleFiles(args.database);
  if (args.check) {
    const drifted = driftedFiles(args.database);
    drifted.forEach((name) => console.log(`DRIFT ${name}: regenerate with --write`));
    if (!drifted.length) console.log('OK: the role files match rolePrivileges().');
    process.exitCode = drifted.length ? 1 : 0;
    return;
  }
  if (args.write) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUTPUT_DIR, name), content);
    console.log(`Wrote ${Object.keys(files).join(', ')} to docs/audits/atlas/.`);
    return;
  }
  for (const [name, content] of Object.entries(files)) console.log(`// ${name}\n${content}`);
}

if (require.main === module) main();

module.exports = { OUTPUT_DIR, driftedFiles, parseArgs, roleFiles };
