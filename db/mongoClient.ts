/**
 * MongoDB Client Connection
 * Reusable MongoDB client that ensures one connection in dev & production
 * Uses MONGO_URI or MONGODB_URI from environment variables (same string; Atlas often documents MONGODB_URI).
 */

import { MongoClient } from 'mongodb';

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

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

// In development, use a global variable to preserve the connection across hot reloads
declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement)
  if (!(global as any)._mongoClientPromise) {
    client = new MongoClient(uri);
    (global as any)._mongoClientPromise = client.connect();
    console.log('✓ MongoDB client connected (development)');
  }
  clientPromise = (global as any)._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable
  client = new MongoClient(uri);
  clientPromise = client.connect();
  console.log('✓ MongoDB client connected (production)');
}

// Export the client promise for use in API routes and services
export default clientPromise;


