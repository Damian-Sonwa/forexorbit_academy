/**
 * MongoDB Connection Utility
 * Wrapper around db/mongoClient.ts for backward compatibility
 * Uses the centralized MongoDB client from db/mongoClient.ts
 */

import clientPromise from '@/db/mongoClient';
import { Db, MongoClient } from 'mongodb';

/**
 * Get database instance
 * @param dbName - Database name (default: MONGODB_DB_NAME, else Forex_elearning). Set
 *   MONGODB_DB_NAME to isolate local or test data from the shared database.
 */
export async function getDb(dbName: string = process.env.MONGODB_DB_NAME?.trim() || 'Forex_elearning'): Promise<Db> {
  const client = await clientPromise;
  return client.db(dbName);
}

/**
 * Get MongoDB client (for advanced operations)
 */
export async function getClient(): Promise<MongoClient> {
  return clientPromise;
}

export default clientPromise;

