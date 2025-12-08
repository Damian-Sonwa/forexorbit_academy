/**
 * Reset Super Admin Password Script
 * Resets the password for madudamian25@gmail.com to 'password123'
 * Run with: node scripts/reset-superadmin-password.js
 */

const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Load .env.local file
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config({ path: '.env.local' });
}

async function resetPassword() {
  try {
    console.log('🔐 Resetting Super Admin password...');
    
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGO_URI not defined in .env.local');
    }
    
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    const db = client.db('Forex_elearning');
    const users = db.collection('users');
    
    // Find Super Admin
    const superAdmin = await users.findOne({ email: 'madudamian25@gmail.com' });
    
    if (!superAdmin) {
      console.log('❌ Super Admin not found. Creating new Super Admin...');
      const hashedPassword = await bcrypt.hash('password123', 10);
      await users.insertOne({
        name: 'Super Admin',
        email: 'madudamian25@gmail.com',
        password: hashedPassword,
        role: 'superadmin',
        status: 'approved',
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('✅ Super Admin created successfully!');
    } else {
      // Reset password
      const hashedPassword = await bcrypt.hash('password123', 10);
      const result = await users.updateOne(
        { email: 'madudamian25@gmail.com' },
        { 
          $set: { 
            password: hashedPassword,
            role: 'superadmin',
            status: 'approved',
            updatedAt: new Date()
          } 
        }
      );
      
      if (result.modifiedCount > 0) {
        console.log('✅ Super Admin password reset successfully!');
        console.log('📧 Email: madudamian25@gmail.com');
        console.log('🔑 Password: password123');
      } else {
        console.log('ℹ️  Super Admin password was already set correctly.');
      }
    }
    
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting password:', error);
    process.exit(1);
  }
}

resetPassword();







