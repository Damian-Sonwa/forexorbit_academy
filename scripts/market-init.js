/**
 * Creates and activates the simulated market. Read-only unless --apply.
 *
 *   node scripts/market-init.js --database <name> --start 2026-09-01T00:00:00Z
 *   node scripts/market-init.js --database <name> --start 2026-09-01T00:00:00Z --apply
 *
 * The seed is generated here, stored in the market document and never printed. One market is created
 * once and then kept: changing its seed or model would change its history, so a new one needs a new id.
 * Connection: MONGO_URI.
 */
const { newMarket } = require('../lib/market/health');
const { COLLECTIONS, marketTick } = require('../lib/trading/market-data');

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
  if (existing) return { ok: true, created: false };
  log(`Market ${id}, from ${startAt.toISOString()}. ${apply ? 'Creating.' : 'Report only: nothing written.'}`);
  if (!apply) return { ok: true, created: false };
  const market = { ...newMarket({ id, startAt }), active: true };
  await db.collection(COLLECTIONS.datasets).updateOne({ _id: id }, { $setOnInsert: market }, { upsert: true });
  for (let pass = 0; pass < 200; pass += 1) {
    const result = await marketTick(db, { now });
    if (result && result.status === 'ACTIVE') return { ok: true, created: true, status: result.status };
  }
  return { ok: false, reason: 'the market did not reach ACTIVE' };
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv);
    if (args.error) { console.error(args.error); process.exit(2); }
    if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const result = await run(client.db(args.database), args);
    await client.close();
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  })();
}

module.exports = { parseArgs, run };
