/**
 * Generate Password Hash
 * Generates a bcrypt hash for a password
 * Usage: node scripts/generate-password-hash.js [password]
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2] || 'password123';

async function generateHash() {
  try {
    const hash = await bcrypt.hash(password, 10);
    console.log('\n✅ Password Hash Generated:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Password:', password);
    console.log('Hash:', hash);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📋 MongoDB Update Query:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`db.users.updateOne(
  { email: "madudamian25@gmail.com" },
  { 
    $set: { 
      password: "${hash}",
      updatedAt: new Date()
    } 
  }
)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error) {
    console.error('Error generating hash:', error);
  }
}

generateHash();

