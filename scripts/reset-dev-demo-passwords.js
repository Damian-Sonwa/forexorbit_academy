'use strict';

/**
 * Development-only: sets a new password on the demo accounts created by scripts/seed-dev.js.
 * Uses the same database, user, and permission guards as the seed. Only the password and
 * updatedAt fields of the listed @demo.com accounts are changed; nothing is inserted or deleted.
 *
 * DEMO_SEED_PASSWORD must come from the current terminal session.
 *   node scripts/reset-dev-demo-passwords.js
 */

const path = require('path');
const bcrypt = require('bcryptjs');
const {
  SeedRefusal,
  validateDemoPassword,
  loadAppEnvFiles,
  resolveDevConfig,
  verifyConnectionIdentity,
  buildUsers,
} = require('./seed-dev');

const BCRYPT_ROUNDS = 10;

function demoEmails() {
  return buildUsers('unused').map((user) => user.email);
}

function requireUpdatePrivilege(status, dbName) {
  const privileges = (status && status.authInfo && status.authInfo.authenticatedUserPrivileges) || [];
  const canUpdate = privileges.some(
    (p) => p && p.resource && p.resource.db === dbName && (p.actions || []).includes('update')
  );
  if (!canUpdate) {
    throw new SeedRefusal('identity_unverified', 'update on the development database is not granted. No data was changed.');
  }
}

async function main({
  env = process.env,
  root = path.join(__dirname, '..'),
  MongoClient = require('mongodb').MongoClient,
  log = console.log,
} = {}) {
  const password = validateDemoPassword(env.DEMO_SEED_PASSWORD);
  loadAppEnvFiles(root, env);
  const config = resolveDevConfig(env);
  log(`Target database: ${config.dbName} as ${config.username}`);

  const emails = demoEmails();
  if (emails.length === 0 || !emails.every((email) => /^[^@\s]+@demo\.com$/.test(email))) {
    throw new SeedRefusal('bad_account_list', 'The demo account list is not limited to @demo.com addresses.');
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 15000, appName: 'forexorbit-reset-dev-demo' });
  try {
    try {
      await client.connect();
    } catch (error) {
      throw new SeedRefusal('connect_failed', `Could not connect (${error.codeName || error.name}). No data was changed.`);
    }
    const db = client.db(config.dbName);

    let status;
    try {
      status = await db.command({ connectionStatus: 1, showPrivileges: true });
    } catch (error) {
      throw new SeedRefusal('identity_unverified', `connectionStatus failed (${error.codeName || error.name}). No data was changed.`);
    }
    verifyConnectionIdentity(status, config);
    requireUpdatePrivilege(status, config.dbName);
    log('Identity verified: single user, read/readWrite roles on the development database only.');

    const users = db.collection('users');
    const filter = { email: { $in: emails } };
    const matched = await users.countDocuments(filter);
    if (matched === 0) {
      throw new SeedRefusal('no_demo_accounts', 'No demo accounts were found. Run scripts/seed-dev.js first. No data was changed.');
    }
    if (matched > emails.length) {
      throw new SeedRefusal('duplicate_demo_accounts', `Found ${matched} matching accounts for ${emails.length} demo addresses. No data was changed.`);
    }

    const result = await users.updateMany(filter, { $set: { password: hashedPassword, updatedAt: new Date() } });
    log(`Demo accounts matched: ${result.matchedCount}, updated: ${result.modifiedCount} of ${emails.length} expected.`);

    const sample = await users.findOne({ email: 'superadmin@demo.com' }, { projection: { password: 1 } });
    const verified = Boolean(sample && sample.password && (await bcrypt.compare(password, sample.password)));
    log(`New password verified against the stored hash: ${verified}`);
    if (!verified) {
      throw new SeedRefusal('verify_failed', 'The stored hash did not match after the update. Review before retrying.');
    }
    return { matched: result.matchedCount, modified: result.modifiedCount, expected: emails.length, verified };
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (error) => {
      if (error instanceof SeedRefusal) {
        console.error(`Refused (${error.code}): ${error.message}`);
        process.exit(2);
      }
      console.error(`Password reset failed (${error.codeName || error.name}).`);
      process.exit(1);
    }
  );
}

module.exports = { demoEmails, main };
