/**
 * MongoDB Connection Utility (CommonJS)
 * For use in server.js
 * Uses the same connection pattern as db/mongoClient.ts
 */

const { MongoClient } = require('mongodb');

// Validate MONGO_URI exists at runtime
const uri = process.env.MONGO_URI;
if (!uri) {
  throw new Error('MONGO_URI not defined in .env.local. Please add your MongoDB connection string.');
}

// Validate URI format
if (!uri.startsWith('mongodb')) {
  throw new Error('MONGO_URI must be a valid MongoDB connection string starting with mongodb:// or mongodb+srv://');
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

