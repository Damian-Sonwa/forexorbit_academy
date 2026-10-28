/**
 * Read-only check of the app database user's privileges (D9).
 *
 *   node scripts/check-db-role.js --database <name>               connect and check the signed-in user
 *   node scripts/check-db-role.js --database <name> --print-role  print the role's privileges; no connection
 *
 * The connection string comes from MONGO_URI (or MONGODB_URI) and is never printed. Nothing is
 * written: the only command sent is `connectionStatus`.
 */
const { ROLE_NAME, evaluatePrivileges, rolePrivileges } = require('../lib/app-database-role');

function parseArgs(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--database');
  const database = at !== -1 ? String(args[at + 1] || '').trim() : '';
  if (!database || database.startsWith('--')) return { error: 'Pass the target database name with --database <name>.' };
  return { database, printRole: args.includes('--print-role') };
}

function report(result, log = console.log) {
  result.auditViolations.forEach((item) => log(`FAIL ${item.collection} allows: ${item.actions.join(', ')}`));
  result.missing.forEach((item) => log(`FAIL ${item.collection} lacks: ${item.actions.join(', ')}`));
  (result.excessive || []).forEach((item) => log(`FAIL ${item.resource} grants more than the role: ${item.actions.join(', ')}`));
  result.warnings.forEach((item) => log(`WARN ${item}`));
  log(result.ok ? 'PASS: the audit log is append-only, every app collection is covered, and nothing beyond the role is granted.' : 'FAIL: see the lines above.');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  if (args.printRole) {
    console.log(JSON.stringify({ role: ROLE_NAME, privileges: rolePrivileges(args.database), roles: [] }, null, 2));
    return;
  }
  require('dotenv').config({ quiet: true });
  const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('Set MONGO_URI (or MONGODB_URI) for the app user to check.');
    process.exit(2);
  }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const status = await client.db(args.database).command({ connectionStatus: 1, showPrivileges: true });
    const info = status.authInfo || {};
    const users = (info.authenticatedUsers || []).map((item) => item.user).join(', ') || '(none)';
    const roles = (info.authenticatedUserRoles || []).map((item) => `${item.role}@${item.db}`).join(', ') || '(none)';
    console.log(`database: ${args.database} | user: ${users} | roles: ${roles}`);
    const result = evaluatePrivileges(info.authenticatedUserPrivileges || [], args.database);
    report(result);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Failed: ${error.codeName || error.name || 'error'}`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { parseArgs, report };
