/**
 * Batched _id lookups (lib/batch-lookup.js) that replace per-row findOne calls in the demo task,
 * journal and leaderboard routes. In-memory stand-in only; no database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { findByIds, objectIdsFrom } = require('../lib/batch-lookup');

function recordingCollection(docs) {
  const calls = [];
  return {
    calls,
    find(query, options) {
      calls.push({ query, options });
      const wanted = query._id.$in;
      // Exact matching, like MongoDB: an ObjectId never equals its hex string.
      const hit = (doc) => wanted.some((id) => (id instanceof ObjectId && doc._id instanceof ObjectId ? id.equals(doc._id) : id === doc._id));
      return { toArray: async () => docs.filter(hit) };
    },
  };
}

test('one query for many ids, de-duplicated, keyed by the string id', async () => {
  const a = new ObjectId();
  const b = new ObjectId();
  const users = recordingCollection([{ _id: a, name: 'Ada' }, { _id: b, name: 'Bo' }]);
  const map = await findByIds(users, [a, b, a, null, undefined], { name: 1 });
  assert.equal(users.calls.length, 1);
  assert.equal(users.calls[0].query._id.$in.length, 2);
  assert.deepEqual(users.calls[0].options, { projection: { name: 1 } });
  assert.equal(map.get(String(a)).name, 'Ada');
  assert.equal(map.get(String(b)).name, 'Bo');
});

test('no ids means no query', async () => {
  const users = recordingCollection([]);
  assert.equal((await findByIds(users, [null], { name: 1 })).size, 0);
  assert.equal(users.calls.length, 0);
});

test('ids are matched as given, so string ids stay strings', async () => {
  const id = new ObjectId();
  const users = recordingCollection([{ _id: id, name: 'Ada' }]);
  const asString = await findByIds(users, [String(id)], { name: 1 });
  assert.equal(asString.size, 0, 'a string does not match an ObjectId _id, exactly as findOne({ _id: string }) did');
  const asObjectId = await findByIds(users, objectIdsFrom([String(id)]), { name: 1 });
  assert.equal(asObjectId.get(String(id)).name, 'Ada');
});

test('objectIdsFrom keeps valid 24-character ids and skips the rest', () => {
  const id = new ObjectId();
  const out = objectIdsFrom([String(id), 'not-an-id', null, '', 'abcdefabcdef']);
  assert.equal(out.length, 1);
  assert.ok(out[0].equals(id));
});
