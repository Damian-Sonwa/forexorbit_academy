/**
 * Copies the committed pre-commit hook into this clone.
 * Does not change Git config and does not print secrets.
 * A fresh clone gets the hook by running: node scripts/install-git-hooks.js
 * npm install also runs this through the prepare script when .git exists.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const gitDir = path.join(root, '.git');
if (!fs.existsSync(gitDir)) {
  process.exit(0);
}

const source = path.join(root, 'scripts', 'git-hooks', 'pre-commit');
const targetDir = path.join(gitDir, 'hooks');
const target = path.join(targetDir, 'pre-commit');
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
try {
  fs.chmodSync(target, 0o755);
} catch (error) {
  // Windows may ignore the executable bit. Git still runs a hook with a shell shebang.
}
console.log('Installed scripts/git-hooks/pre-commit into .git/hooks/pre-commit');
