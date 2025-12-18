/**
 * Environment Variable Validation
 * Validates required environment variables at server startup
 */

export function validateEnv() {
  const required = ['MONGO_URI', 'JWT_SECRET'];
  const missing: string[] = [];

  required.forEach((key) => {
    if (!process.env[key]) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env.local file'
    );
  }

  // Validate MONGO_URI format
  if (process.env.MONGO_URI && !process.env.MONGO_URI.startsWith('mongodb')) {
    throw new Error('MONGO_URI must be a valid MongoDB connection string');
  }

  console.log('✓ Environment variables validated');
}

// Run validation on import (server-side only)
if (typeof window === 'undefined') {
  try {
    validateEnv();
  } catch (error: any) {
    console.error('Environment validation failed:', error.message);
    // Don't throw in development to allow graceful handling
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

