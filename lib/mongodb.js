/**
 * MongoDB Connection Utility (CommonJS)
 * For use in server.js
 * Uses the same connection pattern as db/mongoClient.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MongoClient } = require('mongodb');

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

let client;
let clientPromise;

// In development, use a global variable
if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
    console.log('✓ MongoDB client connected (development)');
  }
  clientPromise = global._mongoClientPromise;
} else {
  client = new MongoClient(uri);
  clientPromise = client.connect();
  console.log('✓ MongoDB client connected (production)');
}

async function getDb(dbName = 'Forex_elearning') {
  const client = await clientPromise;
  return client.db(dbName);
}

module.exports = { getDb, getClient: () => clientPromise };

