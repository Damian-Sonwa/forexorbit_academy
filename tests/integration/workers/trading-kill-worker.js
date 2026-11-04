'use strict';

/**
 * A server process that dies. It runs one simulator operation against the real test database and
 * terminates itself with SIGKILL (TerminateProcess on Windows) right after the chosen database call
 * completes: no exception, no cleanup, no finally blocks, no flushed state.
 *
 * Input (env): KILL_SCENARIO, KILL_AT ("collection.method#n", empty for none), KILL_NOW, KILL_USER,
 * KILL_POSITION, KILL_ORDER_KEY and the test database settings.
 */

const { openTestDatabase } = require('../../helpers/mongo-test-db');
const E = require('../../../lib/trading/engine');
const D = require('../../../lib/trading/market-data');

const die = () => process.kill(process.pid, 'SIGKILL');

function killing(db, plan) {
  const counts = new Map();
  return {
    collection(name) {
      const real = db.collection(name);
      return new Proxy(real, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value !== 'function') return value;
          return (...args) => {
            const label = `${name}.${String(prop)}`;
            const count = (counts.get(label) || 0) + 1;
            counts.set(label, count);
            const result = value.apply(target, args);
            if (plan && plan.label === label && plan.nth === count) {
              return Promise.resolve(result).then(() => { die(); return new Promise(() => {}); }, () => { die(); return new Promise(() => {}); });
            }
            return result;
          };
        },
      });
    },
  };
}

async function main() {
  const { KILL_SCENARIO: scenario, KILL_AT: at, KILL_USER: userId, KILL_POSITION: positionId, KILL_ORDER_KEY: clientOrderId } = process.env;
  const now = new Date(process.env.KILL_NOW);
  const conn = await openTestDatabase();
  const plan = at ? { label: at.split('#')[0], nth: Number(at.split('#')[1]) } : null;
  const db = killing(conn.db, plan);
  if (scenario === 'order') {
    await E.placeOrder(db, { userId, now, body: { clientOrderId, type: 'market', instrument: 'EUR_USD', side: 'buy', units: '10000', stopLoss: '1.09000' } });
  } else if (scenario === 'close') {
    await E.closePosition(db, { userId, positionId, now });
  } else if (scenario === 'evaluate') {
    const account = await E.activeAccount(conn.db, userId);
    await E.evaluateAccount(db, account._id, { now });
  } else if (scenario === 'reset') {
    await E.resetAccount(db, { userId, now });
  } else if (scenario === 'market') {
    await D.marketTick(db, { now });
  } else if (scenario === 'recover') {
    // A fresh process: this is what a restart runs.
    await E.recoverOperations(conn.db, { now });
    await D.marketTick(conn.db, { now });
  }
  await conn.close();
  process.stdout.write('finished\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack}\n`);
  process.exit(1);
});
