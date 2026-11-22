/**
 * MongoDB Client Connection
 * Reusable MongoDB client that ensures one connection in dev & production
 * Uses MONGO_URI or MONGODB_URI from environment variables (same string; Atlas often documents MONGODB_URI).
 */

import { MongoClient } from 'mongodb';
import { connectShared } from '@/lib/mongo-options';
import { assertDevelopmentDatabase } from '@/lib/dev-database-guard';

const uri = (process.env.MONGO_URI || process.env.MONGODB_URI)?.trim();
if (!uri) {
  throw new Error(
    'MongoDB URI not set. Add MONGO_URI (or MONGODB_URI) to .env.local with your connection string.'
  );
}

// Validate URI format
if (!uri.startsWith('mongodb')) {
  throw new Error('MONGO_URI / MONGODB_URI must start with mongodb:// or mongodb+srv://');
}

// Outside production, an explicit non-production MONGODB_DB_NAME is required (lib/dev-database-guard.js).
assertDevelopmentDatabase();

let clientPromise: Promise<MongoClient>;

// In development, use a global variable to preserve the connection across hot reloads
declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

// One client per process, in every environment. server.js (lib/mongodb.js) and the Next API
// routes share it through this global, so the process keeps one connection pool and pays the
// connection set-up once instead of once per client. In development it also survives HMR.
// Phase 15: bounded timeouts and pool, and a failed connection is retried on the next request
// instead of failing every request until a restart (lib/mongo-options.js).
clientPromise = connectShared(MongoClient, uri as string);

/** The shared client, reconnecting if an earlier attempt failed. */
export function getClientPromise(): Promise<MongoClient> {
  return connectShared(MongoClient, uri as string);
}

// Export the client promise for use in API routes and services
export default clientPromise;


