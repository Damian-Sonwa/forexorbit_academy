/**
 * Generate a bcrypt hash for a password supplied on the command line.
 * Usage: node scripts/generate-password-hash.js <password>
 *
 * This script does not connect to the database and does not update any user.
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage: node scripts/generate-password-hash.js <password>');
  process.exit(1);
}

async function generateHash() {
  try {
    const hash = await bcrypt.hash(password, 10);
    console.log(hash);
  } catch (error) {
    console.error('Error generating hash:', error);
    process.exit(1);
  }
}

generateHash();
