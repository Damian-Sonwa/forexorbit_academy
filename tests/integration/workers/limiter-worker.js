'use strict';

/**
 * One server instance for the multi-process rate-limit test: a separate Node process with its
 * own MongoDB connection and its own in-process counts, running the production limiter module
 * (lib/auth-rate-limit.js) against the shared test database.
 *
 * Input (env): WORKER_ATTEMPTS, WORKER_EMAIL, WORKER_IP, WORKER_NOW (ms), plus the test database
 * settings read by tests/helpers/mongo-test-db.js. Output: one JSON line on stdout.
 */

const { openTestDatabase } = require('../../helpers/mongo-test-db');
const { LOGIN_RULES, createAuthLimiter } = require('../../../lib/auth-rate-limit');

async function main() {
  const attempts = Number(process.env.WORKER_ATTEMPTS || 1);
  const now = Number(process.env.WORKER_NOW || Date.now());
  const conn = await openTestDatabase();
  try {
    const limiter = createAuthLimiter(LOGIN_RULES);
    const env = { SHARED_RATE_LIMIT: 'mongodb', JWT_SECRET: process.env.WORKER_SECRET || 'test-only-r1-secret' };
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        limiter.consume({ ip: process.env.WORKER_IP, email: process.env.WORKER_EMAIL, getDb: async () => conn.db, env, now })
      )
    );
    const allowed = results.filter((r) => r.allowed).length;
    process.stdout.write(`${JSON.stringify({ pid: process.pid, allowed, refused: results.length - allowed, statuses: results.map((r) => (r.allowed ? 200 : r.status)) })}\n`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
});
