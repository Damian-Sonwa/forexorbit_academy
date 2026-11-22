#!/usr/bin/env node
'use strict';

/**
 * Query profiling (Phase 15): explain plans for the hot queries added in Phases 13-14 and the
 * practical tasks, at representative volumes, with the current indexes and with each candidate.
 *
 *   PROFILE_MONGO_URI=mongodb://127.0.0.1:27017 node scripts/query-profile.js
 *
 * Local or disposable test servers only (the same host rule as scripts/restore-drill.js). Seeds
 * Forex_elearning_profile_test, prints a JSON report and drops the database. Never reads MONGO_URI.
 */

const { MongoClient, ObjectId } = require('mongodb');

const DB = 'Forex_elearning_profile_test';
const USERS = 2000;
const NOTIFICATIONS = 60000;
const TASKS = 400;
const NEWS = 3000;

async function seed(db) {
  const now = Date.now();
  const users = Array.from({ length: USERS }, () => new ObjectId().toHexString());
  const states = ['sent', 'sent', 'sent', 'delivered', 'delivered', 'failed', 'suppressed', 'skipped'];
  let batch = [];
  for (let i = 0; i < NOTIFICATIONS; i += 1) {
    const queued = i % 400 === 0; // ~0.25% waiting in the email queue, as in steady state
    batch.push({
      userId: users[i % USERS], type: 'task_feedback', category: 'learning', title: 't', message: 'm', read: i % 3 === 0,
      createdAt: new Date(now - i * 60000), inApp: i % 50 !== 0,
      channels: { email: queued ? { state: 'queued', attempts: 0, nextAttemptAt: new Date(now - 1000) } : { state: states[i % states.length], attempts: 1, providerId: `em_${i}`, updatedAt: new Date(now - i * 60000) } },
    });
    if (batch.length === 5000) { await db.collection('notifications').insertMany(batch); batch = []; }
  }
  if (batch.length) await db.collection('notifications').insertMany(batch);
  await db.collection('notifications').createIndex({ userId: 1, createdAt: -1 }, { name: 'perf_notifications_user_recent' }); // L4 (exists in production)

  const tasks = Array.from({ length: TASKS }, (_, i) => ({
    schema: i % 4 ? 'practical_v2' : undefined, title: `Task ${i}`, status: ['draft', 'published', 'published', 'closed'][i % 4], courseId: new ObjectId().toHexString(),
    recipients: users.filter((_, u) => (u + i) % 7 === 0).slice(0, 250), publishedAt: new Date(now - i * 3600000), assignedTo: i % 4 ? 'practical_v2' : null, createdAt: new Date(now - i * 3600000), updatedAt: new Date(now - i * 3600000),
  }));
  await db.collection('demoTasks').insertMany(tasks);
  await db.collection('demoTasks').createIndex({ assignedTo: 1, createdAt: -1 }, { name: 'demo_task_assignee_recent' }); // T14

  await db.collection('communityNews').insertMany(Array.from({ length: NEWS }, (_, i) => (i % 3
    ? { title: `News ${i}`, category: 'market', createdAt: new Date(now - i * 3600000) }
    : { kind: 'announcement', title: `A ${i}`, body: 'b', audience: ['all', 'students', 'course'][i % 3], courseId: new ObjectId().toHexString(), status: i % 9 ? 'published' : 'draft', publishedAt: new Date(now - i * 3600000), expiresAt: null, createdAt: new Date(now - i * 3600000) })));
  return { users };
}

function summary(plan) {
  const s = plan.executionStats;
  const stages = [];
  const walk = (st) => { if (!st) return; stages.push(st.stage + (st.indexName ? `(${st.indexName})` : '')); walk(st.inputStage); (st.inputStages || []).forEach(walk); };
  walk(plan.queryPlanner.winningPlan.queryPlan || plan.queryPlanner.winningPlan);
  return { returned: s.nReturned, docsExamined: s.totalDocsExamined, keysExamined: s.totalKeysExamined, ms: s.executionTimeMillis, plan: stages.join(' < ') };
}

async function measure(db, label, coll, filter, { sort, limit } = {}) {
  let cursor = db.collection(coll).find(filter);
  if (sort) cursor = cursor.sort(sort);
  if (limit) cursor = cursor.limit(limit);
  return { query: label, ...summary(await cursor.explain('executionStats')) };
}

(async () => {
  const uri = (process.env.PROFILE_MONGO_URI || '').trim();
  const host = (/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/:?,]+)/.exec(uri) || [])[2] || '';
  if (!uri || !['127.0.0.1', 'localhost'].includes(host)) {
    console.error('Set PROFILE_MONGO_URI to a local MongoDB server.');
    process.exit(2);
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(DB);
    await db.dropDatabase();
    const { users } = await seed(db);
    const now = new Date();
    const one = users[17];
    const queries = [
      ['email queue (worker, every 30 s)', 'notifications', { $or: [{ 'channels.email.state': { $in: ['queued', 'retrying'] }, 'channels.email.nextAttemptAt': { $lte: now } }, { 'channels.email.state': 'sending', 'channels.email.leaseUntil': { $lte: now } }] }, { limit: 25 }],
      ['webhook lookup by provider id', 'notifications', { 'channels.email.providerId': 'em_31337' }, { limit: 1 }],
      ['notification list (one member, page)', 'notifications', { userId: one, inApp: { $ne: false } }, { sort: { createdAt: -1 }, limit: 21 }],
      ['unread count (one member)', 'notifications', { userId: one, read: false, inApp: { $ne: false } }, {}],
      ['practical tasks for one student', 'demoTasks', { schema: 'practical_v2', recipients: { $in: [one] }, status: { $in: ['published', 'closed'] } }, { sort: { publishedAt: -1 }, limit: 200 }],
      ['announcements visible to a student', 'communityNews', { kind: 'announcement', status: 'published', audience: { $in: ['all', 'students'] } }, { sort: { publishedAt: -1 }, limit: 21 }],
    ];
    const before = [];
    for (const [label, coll, filter, opts] of queries) before.push(await measure(db, label, coll, filter, opts));

    // Candidate indexes (each justified by one of the queries above).
    const candidates = [
      ['notifications', { 'channels.email.state': 1, 'channels.email.nextAttemptAt': 1 }, { name: 'comm_email_state_due' }],
      ['notifications', { 'channels.email.providerId': 1 }, { name: 'comm_email_provider_id', sparse: true }],
      ['demoTasks', { recipients: 1, publishedAt: -1 }, { name: 'practical_recipient_recent', partialFilterExpression: { schema: 'practical_v2' } }],
      ['communityNews', { kind: 1, status: 1, publishedAt: -1 }, { name: 'announcement_status_recent', partialFilterExpression: { kind: 'announcement' } }],
    ];
    const sizes = {};
    for (const [coll, key, options] of candidates) await db.collection(coll).createIndex(key, options);
    for (const coll of ['notifications', 'demoTasks', 'communityNews']) {
      const st = await db.command({ collStats: coll });
      sizes[coll] = { documents: st.count, indexSizes: st.indexSizes };
    }
    const after = [];
    for (const [label, coll, filter, opts] of queries) after.push(await measure(db, label, coll, filter, opts));
    console.log(JSON.stringify({ event: 'queryProfile', volumes: { users: USERS, notifications: NOTIFICATIONS, practicalTasks: TASKS, communityNews: NEWS }, before, after, candidates: candidates.map(([c, k, o]) => ({ collection: c, key: k, options: o })), indexSizesBytes: sizes }, null, 2));
  } finally {
    await client.db(DB).dropDatabase().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
})();
