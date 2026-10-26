/**
 * MongoDB Connection Utility
 * Wrapper around db/mongoClient.ts for backward compatibility
 * Uses the centralized MongoDB client from db/mongoClient.ts
 */

import clientPromise from '@/db/mongoClient';
import { Db, MongoClient } from 'mongodb';

/**
 * Get database instance
 * @param dbName - Database name (default: Forex_elearning)
 */
export async function getDb(dbName: string = 'Forex_elearning'): Promise<Db> {
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

