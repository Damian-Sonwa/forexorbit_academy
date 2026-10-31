'use strict';

/**
 * A small in-memory stand-in for the MongoDB collections API, enough for the Phase 4 flows:
 * find/findOne (with sort, limit and projections recorded but not applied), countDocuments,
 * insertOne, updateOne/updateMany/findOneAndUpdate ($set, $unset, $inc, $max, $addToSet),
 * deleteOne/deleteMany and bulkWrite of updateOne operations. Each single-document update is
 * applied synchronously, as MongoDB applies it atomically. Not a real database: tests that use
 * it say so, and nothing here is claimed as real-MongoDB coverage.
 */

const { ObjectId } = require('mongodb');

function same(a, b) {
  if (a instanceof ObjectId || b instanceof ObjectId) return a != null && b != null && String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function getPath(doc, path) {
  return path.split('.').reduce((value, key) => {
    if (value == null) return undefined;
    if (Array.isArray(value)) return value.map((item) => (item == null ? undefined : item[key]));
    return value[key];
  }, doc);
}

function isOperators(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof ObjectId) && !(value instanceof Date)
    && Object.keys(value).length > 0 && Object.keys(value).every((key) => key.startsWith('$'));
}

function compare(a, b) {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

function valueMatches(value, cond) {
  if (isOperators(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case '$in': return arg.some((candidate) => (Array.isArray(value) ? value.some((v) => same(v, candidate)) : same(value, candidate)));
        case '$exists': return arg ? value !== undefined : value === undefined;
        case '$ne': return !same(value, arg);
        case '$gte': return value !== undefined && compare(value, arg) >= 0;
        case '$lt': return value !== undefined && compare(value, arg) < 0;
        case '$regex': {
          const re = new RegExp(arg, cond.$options || '');
          const values = Array.isArray(value) ? value : [value];
          return values.some((v) => typeof v === 'string' && re.test(v));
        }
        case '$options': return true;
        default: throw new Error(`memory-db: unsupported operator ${op}`);
      }
    });
  }
  if (Array.isArray(value) && !Array.isArray(cond)) return value.some((v) => same(v, cond));
  return same(value, cond);
}

function matches(doc, query) {
  return Object.entries(query || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    if (key === '$and') return cond.every((sub) => matches(doc, sub));
    return valueMatches(getPath(doc, key), cond);
  });
}

function applyUpdate(doc, update) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [key, value] of Object.entries(fields)) {
      if (op === '$set') doc[key] = value;
      else if (op === '$unset') delete doc[key];
      else if (op === '$inc') doc[key] = (typeof doc[key] === 'number' ? doc[key] : 0) + value;
      else if (op === '$max') doc[key] = doc[key] === undefined || compare(value, doc[key]) > 0 ? value : doc[key];
      else if (op === '$addToSet') {
        const list = Array.isArray(doc[key]) ? doc[key] : [];
        if (!list.some((item) => same(item, value))) list.push(value);
        doc[key] = list;
      } else throw new Error(`memory-db: unsupported update ${op}`);
    }
  }
}

function seedOf(op, filter) {
  const doc = {};
  for (const [key, value] of Object.entries(filter || {})) if (!key.startsWith('$') && !isOperators(value)) doc[key] = value;
  return doc;
}

function memoryDb(seed = {}) {
  const collections = new Map();
  const log = [];
  const clone = (doc) => (doc ? { ...doc } : doc);
  function collection(name) {
    if (!collections.has(name)) {
      const docs = (seed[name] || []).map((doc) => ({ ...doc }));
      const col = {
        docs,
        async findOne(query, options) {
          log.push({ name, method: 'findOne', query, options });
          return clone(docs.find((doc) => matches(doc, query))) || null;
        },
        find(query, options) {
          log.push({ name, method: 'find', query, options });
          let rows = docs.filter((doc) => matches(doc, query));
          const cursor = {
            project: (projection) => { log.push({ name, method: 'project', projection }); return cursor; },
            sort: (spec) => {
              const entries = Object.entries(spec);
              rows = [...rows].sort((a, b) => {
                for (const [field, dir] of entries) {
                  const c = compare(a[field] ?? 0, b[field] ?? 0);
                  if (c) return c * dir;
                }
                return 0;
              });
              return cursor;
            },
            limit: (n) => { rows = rows.slice(0, n); return cursor; },
            toArray: async () => rows.map(clone),
          };
          return cursor;
        },
        async countDocuments(query, options = {}) {
          const count = docs.filter((doc) => matches(doc, query)).length;
          return options.limit ? Math.min(count, options.limit) : count;
        },
        async insertOne(doc) {
          const stored = { _id: doc._id || new ObjectId(), ...doc };
          docs.push(stored);
          log.push({ name, method: 'insertOne' });
          return { insertedId: stored._id };
        },
        async updateOne(filter, update, options = {}) {
          log.push({ name, method: 'updateOne', filter, update });
          let doc = docs.find((row) => matches(row, filter));
          if (!doc && options.upsert) {
            doc = { _id: new ObjectId(), ...seedOf('updateOne', filter) };
            docs.push(doc);
          }
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };
          applyUpdate(doc, update);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async updateMany(filter, update) {
          const rows = docs.filter((row) => matches(row, filter));
          rows.forEach((row) => applyUpdate(row, update));
          return { matchedCount: rows.length, modifiedCount: rows.length };
        },
        async findOneAndUpdate(filter, update, options = {}) {
          log.push({ name, method: 'findOneAndUpdate', filter, update });
          let doc = docs.find((row) => matches(row, filter));
          if (!doc && options.upsert) {
            doc = { ...seedOf('findOneAndUpdate', filter) };
            if (doc._id === undefined) doc._id = new ObjectId();
            docs.push(doc);
          }
          if (!doc) return null;
          const before = clone(doc);
          applyUpdate(doc, update);
          return options.returnDocument === 'after' ? clone(doc) : before;
        },
        async deleteOne(filter) {
          const at = docs.findIndex((row) => matches(row, filter));
          if (at >= 0) docs.splice(at, 1);
          log.push({ name, method: 'deleteOne' });
          return { deletedCount: at >= 0 ? 1 : 0 };
        },
        async deleteMany(filter) {
          let deleted = 0;
          for (let i = docs.length - 1; i >= 0; i -= 1) {
            if (matches(docs[i], filter)) { docs.splice(i, 1); deleted += 1; }
          }
          log.push({ name, method: 'deleteMany', deleted });
          return { deletedCount: deleted };
        },
        async bulkWrite(operations) {
          let modified = 0;
          for (const operation of operations) {
            if (!operation.updateOne) throw new Error('memory-db: bulkWrite supports updateOne only');
            const result = await col.updateOne(operation.updateOne.filter, operation.updateOne.update);
            modified += result.modifiedCount;
          }
          return { modifiedCount: modified };
        },
      };
      collections.set(name, col);
    }
    return collections.get(name);
  }
  return { collection, log, docs: (name) => collection(name).docs };
}

module.exports = { matches, memoryDb };
