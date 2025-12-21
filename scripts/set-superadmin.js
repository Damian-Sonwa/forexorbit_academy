/**
 * Set Super Admin Script
 * Creates or updates a super admin user
 * Usage: node scripts/set-superadmin.js
 */

const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Load .env.local file
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
} else if (fs.existsSync('.env')) {
  require('dotenv').config({ path: '.env' });
} else {
  // Try to load from environment variables directly
  require('dotenv').config();
}

async function setSuperAdmin() {
  try {
    const email = 'mikedeeson@gmail.com';
    const password = 'photohub';
    
    console.log('🔐 Setting Super Admin...');
    console.log('📧 Email:', email);
    
    // Get MONGO_URI from environment variable or command line argument
    const uri = process.env.MONGO_URI || process.argv[2];
    if (!uri) {
      console.error('\n❌ Error: MONGO_URI not found!');
      console.error('Please provide MONGO_URI in one of these ways:');
      console.error('1. Create .env.local file with: MONGO_URI=your_connection_string');
      console.error('2. Set environment variable: set MONGO_URI=your_connection_string (Windows)');
      console.error('3. Pass as argument: node scripts/set-superadmin.js "your_connection_string"\n');
      throw new Error('MONGO_URI not defined');
    }
    
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    const db = client.db('Forex_elearning');
    const users = db.collection('users');
    
    // Check if user exists
    const existingUser = await users.findOne({ email: email });
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    if (!existingUser) {
      // Create new super admin
      console.log('📝 Creating new Super Admin...');
      await users.insertOne({
        name: 'Super Admin',
        email: email,
        password: hashedPassword,
        role: 'superadmin',
        status: 'approved',
        points: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('✅ Super Admin created successfully!');
    } else {
      // Update existing user to super admin
      console.log('📝 Updating existing user to Super Admin...');
      const result = await users.updateOne(
        { email: email },
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
        console.log('✅ Super Admin updated successfully!');
      } else {
        console.log('ℹ️  User was already a Super Admin. Password updated.');
      }
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Super Admin Account Ready!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Role: superadmin');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting Super Admin:', error);
    process.exit(1);
  }
}

setSuperAdmin();

