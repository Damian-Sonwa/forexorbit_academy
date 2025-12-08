/**
 * Generate JWT Secret
 * Run: node scripts/generate-jwt-secret.js
 * 
 * This script generates a secure random JWT secret key for production use.
 */

const crypto = require('crypto');

const secret = crypto.randomBytes(32).toString('hex');

console.log('');
console.log('═══════════════════════════════════════════════════');
console.log('  JWT Secret Generated');
console.log('═══════════════════════════════════════════════════');
console.log('');
console.log('Copy this value to your .env.local file:');
console.log('');
console.log(`JWT_SECRET=${secret}`);
console.log('');
console.log('⚠️  Keep this secret secure and never commit it to version control!');
console.log('═══════════════════════════════════════════════════');
console.log('');

