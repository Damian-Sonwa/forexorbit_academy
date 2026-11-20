/**
 * Creates and activates the simulated market. Read-only unless --apply.
 *
 *   node scripts/market-init.js --database <name> --start 2026-09-01T00:00:00Z
 *   node scripts/market-init.js --database <name> --start 2026-09-01T00:00:00Z --apply
 *
 * The seed is generated here, stored in the market document and never printed. One market is created
 * once and then kept: changing its seed or model would change its history, so a new one needs a new id.
 * Connection: MONGO_URI (or MONGODB_URI), as the other operator scripts; never printed.
 */
const { COLLECTIONS: HEALTH, newMarket } = require('../lib/market/health');
const { COLLECTIONS, marketTick } = require('../lib/trading/market-data');
const { MISSING_URI, mongoUri } = require('./mongo-uri');

function parseArgs(argv) {
  const args = argv.slice(2);
  const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const database = value('--database');
  const start = value('--start');
  if (!database) return { error: 'Give --database <name>.' };
  if (!start || Number.isNaN(new Date(start).getTime())) return { error: 'Give --start <ISO time>, in the past, on the hour.' };
  return { database, start, id: value('--id') || 'simulated-market-1', apply: args.includes('--apply') };
}

async function run(db, { id, start, apply, now = new Date(), log = console.log }) {
  const startAt = new Date(start);
  if (startAt.getTime() % 3600000 !== 0 || startAt >= now) return { ok: false, reason: 'start must be in the past, on the hour' };
  const existing = await db.collection(COLLECTIONS.datasets).findOne({ active: true });
  if (existing && existing._id !== id) return { ok: false, reason: `another market is active: ${existing._id}` };
  if (existing) {
    // A rerun never changes the market document. It reports the market's health and, with --apply,
    // finishes an interrupted catch-up with the same pass the server runs every 15 seconds (which
    // never lifts SUSPENDED or ERROR: that is the admin market page, POST /api/admin/market, an owner decision).
    const health = await db.collection(HEALTH.health).findOne({ _id: id });
    const status = health ? health.status : 'INITIALISING';
    log(`Market ${id} already exists. Status: ${status}. Nothing to create.`);
    if (status === 'ACTIVE' || !apply) return { ok: status === 'ACTIVE', created: false, status };
    return catchUp(db, now, false);
  }
  log(`Market ${id}, from ${startAt.toISOString()}. ${apply ? 'Creating.' : 'Report only: nothing written.'}`);
  if (!apply) return { ok: true, created: false };
  const market = { ...newMarket({ id, startAt }), active: true };
  await db.collection(COLLECTIONS.datasets).updateOne({ _id: id }, { $setOnInsert: market }, { upsert: true });
  return catchUp(db, now, true);
}

async function catchUp(db, now, created) {
  let result = null;
  for (let pass = 0; pass < 200; pass += 1) {
    result = await marketTick(db, { now });
    if (!result || result.status !== 'RECOVERING') break;
  }
  const status = result ? result.status : 'INITIALISING';
  if (status === 'ACTIVE') return { ok: true, created, status };
  return { ok: false, created, status, reason: `the market is ${status}; rerun with --apply to continue, or see the runbook` };
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv);
    if (args.error) { console.error(args.error); process.exit(2); }
    require('dotenv').config({ quiet: true });
    const uri = mongoUri();
    if (!uri) { console.error(MISSING_URI); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    let result;
    try {
      await client.connect();
      result = await run(client.db(args.database), args);
    } finally {
      await client.close().catch(() => {});
    }
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  })().catch((error) => {
    // The driver's message can name the host; only the error class is printed.
    console.error(`Market init failed: ${(error && (error.codeName || error.name)) || 'error'}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, run };
