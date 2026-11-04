'use strict';

/**
 * In-memory stand-in for the MongoDB driver subset the payment code uses, with the real unique
 * index definitions enforced (including partial filters), so duplicate and concurrency rules are
 * tested against the same indexes production uses. Based on tests/course-purchase.test.js; adds
 * $unset, updateMany, limit and ObjectId-aware matching. Not real-MongoDB coverage.
 *
 * Options:
 *   uniqueIndexes: index definitions ({ collection, key, options: { unique, partialFilterExpression } })
 *   racy: every read and upsert yields first, so concurrent calls interleave like network round trips
 */

const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));

function isOperatorObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
    && typeof value.toHexString !== 'function'
    && Object.keys(value).some((key) => key.startsWith('$'));
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (right === null) return left === null || left === undefined;
  if (left && right && typeof left === 'object' && typeof right === 'object'
    && (typeof left.toHexString === 'function' || typeof right.toHexString === 'function')) {
    return String(left) === String(right);
  }
  return left === right;
}

const comparable = (value) => (value instanceof Date ? value.getTime() : value);

function matches(doc, query) {
  return Object.entries(query || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    if (key === '$and') return cond.every((sub) => matches(doc, sub));
    // Dotted paths, including array positions ("completedLessons.3"), as MongoDB resolves them.
    const value = key.includes('.') ? key.split('.').reduce((v, part) => (v == null ? undefined : v[part]), doc) : doc[key];
    if (isOperatorObject(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$in') return arg.some((candidate) => (Array.isArray(value) ? value.some((v) => sameValue(v, candidate)) : sameValue(value, candidate)));
        if (op === '$nin') return !arg.some((candidate) => sameValue(value, candidate));
        if (op === '$ne') return Array.isArray(value) ? !value.some((v) => sameValue(v, arg)) : !sameValue(value, arg);
        if (op === '$exists') return arg ? value !== undefined : value === undefined;
        if (op === '$lt') return value !== undefined && value !== null && comparable(value) < comparable(arg);
        if (op === '$gt') return value !== undefined && value !== null && comparable(value) > comparable(arg);
        if (op === '$lte') return value !== undefined && value !== null && comparable(value) <= comparable(arg);
        if (op === '$gte') return value !== undefined && value !== null && comparable(value) >= comparable(arg);
        if (op === '$type') return typeof value === arg;
        throw new Error(`payment-memory-db: unsupported operator ${op}`);
      });
    }
    return sameValue(value, cond);
  });
}

function indexKey(doc, index) {
  const partial = index.options.partialFilterExpression;
  if (partial && !matches(doc, partial)) return null;
  return JSON.stringify(Object.keys(index.key).map((field) => (doc[field] === undefined ? null : String(doc[field]))));
}

function duplicateKeyError(index) {
  return Object.assign(new Error(`E11000 duplicate key error index: ${index.options.name}`), { code: 11000, codeName: 'DuplicateKey' });
}

/** Sets a dotted path ("answers.q1") as MongoDB does: nested objects, created when missing. */
function setPath(doc, key, value) {
  if (!key.includes('.')) { doc[key] = value; return; }
  const parts = key.split('.');
  let target = doc;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object') target[part] = {};
    target = target[part];
  }
  target[parts[parts.length - 1]] = value;
}

function unsetPath(doc, key) {
  if (!key.includes('.')) { delete doc[key]; return; }
  const parts = key.split('.');
  let target = doc;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object') return;
    target = target[part];
  }
  delete target[parts[parts.length - 1]];
}

function applyUpdate(doc, update) {
  for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
  for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
  for (const [key, value] of Object.entries(update.$push || {})) doc[key] = [...(doc[key] || []), value];
  for (const [key, value] of Object.entries(update.$pull || {})) doc[key] = (doc[key] || []).filter((item) => !sameValue(item, value));
  for (const key of Object.keys(update.$unset || {})) unsetPath(doc, key);
  for (const [key, value] of Object.entries(update.$max || {})) if (doc[key] === undefined || comparable(value) > comparable(doc[key])) doc[key] = value;
  for (const [key, value] of Object.entries(update.$addToSet || {})) {
    const list = Array.isArray(doc[key]) ? doc[key] : [];
    if (!list.some((item) => sameValue(item, value))) list.push(value);
    doc[key] = list;
  }
}

class MemoryCollection {
  constructor(name, options) {
    this.name = name;
    this.docs = [];
    this.seq = 0;
    this.racy = Boolean(options.racy);
    this.uniqueIndexes = (options.uniqueIndexes || []).filter((index) => index.collection === name && index.options.unique);
    this.failNext = options.failNext || {};
  }

  maybeFail(op) {
    const key = `${this.name}.${op}`;
    if (this.failNext[key] > 0) {
      this.failNext[key] -= 1;
      throw new Error(`injected failure: ${key}`);
    }
  }

  assertUnique(candidate) {
    for (const index of this.uniqueIndexes) {
      const key = indexKey(candidate, index);
      if (key === null) continue;
      if (this.docs.some((row) => row !== candidate && indexKey(row, index) === key)) throw duplicateKeyError(index);
    }
  }

  async findOne(query) {
    if (this.racy) await yieldTurn();
    const doc = this.docs.find((row) => matches(row, query));
    return doc ? { ...doc } : null;
  }

  find(query) {
    const { racy } = this;
    let rows = this.docs.filter((row) => matches(row, query));
    const cursor = {
      project: () => cursor,
      sort: (spec) => {
        const fields = Object.entries(spec || {});
        const key = (value) => (value && typeof value.toHexString === 'function' ? String(value) : comparable(value));
        rows = rows.slice().sort((a, b) => {
          for (const [field, direction] of fields) {
            const [left, right] = [key(a[field]), key(b[field])];
            if (left === right) continue;
            if (left === undefined || left === null) return -direction;
            if (right === undefined || right === null) return direction;
            return left < right ? -direction : direction;
          }
          return 0;
        });
        return cursor;
      },
      skip: (n) => { rows = rows.slice(n); return cursor; },
      limit: (n) => { rows = rows.slice(0, n); return cursor; },
      toArray: async () => {
        if (racy) await yieldTurn();
        return rows.map((row) => ({ ...row }));
      },
    };
    return cursor;
  }

  async countDocuments(query, options = {}) {
    if (this.racy) await yieldTurn();
    const count = this.docs.filter((row) => matches(row, query)).length;
    return options.limit ? Math.min(count, options.limit) : count;
  }

  async insertOne(doc) {
    if (this.racy) await yieldTurn();
    this.maybeFail('insertOne');
    const row = { _id: doc._id ?? `id_${this.name}_${++this.seq}`, ...doc };
    if (this.docs.some((existing) => sameValue(existing._id, row._id))) throw duplicateKeyError({ options: { name: '_id_' } });
    this.assertUnique(row);
    this.docs.push(row);
    return { insertedId: row._id };
  }

  async updateOne(filter, update, options = {}) {
    this.maybeFail('updateOne');
    let doc = this.docs.find((row) => matches(row, filter));
    let upserted = false;
    if (!doc) {
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      if (this.racy) await yieldTurn();
      doc = this.docs.find((row) => matches(row, filter));
      if (!doc) {
        doc = { _id: `id_${this.name}_${++this.seq}` };
        for (const [key, value] of Object.entries(filter)) if (!key.startsWith('$') && !isOperatorObject(value)) doc[key] = value;
        Object.assign(doc, update.$setOnInsert || {});
        this.docs.push(doc);
        upserted = true;
      }
    }
    const before = { ...doc };
    applyUpdate(doc, update);
    try {
      this.assertUnique(doc);
    } catch (error) {
      if (upserted) this.docs.splice(this.docs.indexOf(doc), 1);
      else {
        for (const key of Object.keys(doc)) delete doc[key];
        Object.assign(doc, before);
      }
      throw error;
    }
    return { matchedCount: upserted ? 0 : 1, modifiedCount: upserted ? 0 : 1, upsertedCount: upserted ? 1 : 0 };
  }

  /**
   * Atomic find-and-modify, as MongoDB: the match and the write happen together (in racy mode the
   * yield comes first, so concurrent callers interleave between whole operations, never inside
   * one). With upsert, a document whose _id matches but whose other conditions do not raises a
   * duplicate key error, as on a real server.
   */
  async findOneAndUpdate(filter, update, options = {}) {
    if (this.racy) await yieldTurn();
    this.maybeFail('findOneAndUpdate');
    let doc = this.docs.find((row) => matches(row, filter));
    let inserted = false;
    if (!doc) {
      if (!options.upsert) return null;
      const id = filter._id;
      if (id !== undefined && !isOperatorObject(id) && this.docs.some((row) => sameValue(row._id, id))) throw duplicateKeyError({ options: { name: '_id_' } });
      doc = { _id: id !== undefined && !isOperatorObject(id) ? id : `id_${this.name}_${++this.seq}` };
      for (const [key, value] of Object.entries(filter)) if (!key.startsWith('$') && !isOperatorObject(value)) doc[key] = value;
      Object.assign(doc, update.$setOnInsert || {});
      this.docs.push(doc);
      inserted = true;
    }
    const before = JSON.parse(JSON.stringify(doc));
    applyUpdate(doc, update);
    try {
      this.assertUnique(doc);
    } catch (error) {
      if (inserted) this.docs.splice(this.docs.indexOf(doc), 1);
      throw error;
    }
    if (options.returnDocument === 'after') return { ...doc };
    return inserted ? null : before;
  }

  /** updateOne operations only (lib/course-progress.js recomputeCourseProgress). */
  async bulkWrite(operations) {
    let modifiedCount = 0;
    for (const op of operations) {
      if (!op.updateOne) throw new Error('payment-memory-db: bulkWrite supports updateOne only');
      modifiedCount += (await this.updateOne(op.updateOne.filter, op.updateOne.update)).modifiedCount;
    }
    return { modifiedCount };
  }

  async updateMany(filter, update) {
    const rows = this.docs.filter((row) => matches(row, filter));
    rows.forEach((row) => applyUpdate(row, update));
    return { matchedCount: rows.length, modifiedCount: rows.length };
  }

  async deleteOne(filter) {
    const at = this.docs.findIndex((row) => matches(row, filter));
    if (at >= 0) this.docs.splice(at, 1);
    return { deletedCount: at >= 0 ? 1 : 0 };
  }

  async deleteMany(filter) {
    const before = this.docs.length;
    this.docs = this.docs.filter((row) => !matches(row, filter));
    return { deletedCount: before - this.docs.length };
  }
}

function paymentMemoryDb(options = {}) {
  const collections = new Map();
  return {
    collection(name) {
      if (!collections.has(name)) collections.set(name, new MemoryCollection(name, options));
      return collections.get(name);
    },
    rows(name) {
      return this.collection(name).docs;
    },
  };
}

module.exports = { matches, paymentMemoryDb, yieldTurn };
