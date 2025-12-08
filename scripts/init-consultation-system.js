/**
 * Initialize Consultation System
 * Adds expert fields to users collection and marks some users as experts
 * Run with: node scripts/init-consultation-system.js
 */

require('dotenv').config({ path: '.env.local' });
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Error: MONGO_URI not defined in .env.local');
  process.exit(1);
}

async function initConsultationSystem() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db('Forex_elearning');
    const users = db.collection('users');

    // Add expert fields to all users (default to false/true)
    console.log('Adding expert fields to users...');
    await users.updateMany(
      { isExpert: { $exists: false } },
      { 
        $set: { 
          isExpert: false,
          expertAvailable: true, // Default to available
          consultationSuspended: false,
        } 
      }
    );

    // Mark instructors and admins as experts
    console.log('Marking instructors and admins as experts...');
    await users.updateMany(
      { 
        $or: [
          { role: 'instructor' },
          { role: 'admin' },
          { role: 'superadmin' }
        ],
        isExpert: { $ne: true }
      },
      { 
        $set: { 
          isExpert: true,
          expertAvailable: true,
        } 
      }
    );

    // Add consultationEnabled to super admin
    const superAdmin = await users.findOne({ email: 'madudamian25@gmail.com' });
    if (superAdmin) {
      await users.updateOne(
        { email: 'madudamian25@gmail.com' },
        { 
          $set: { 
            consultationEnabled: true, // Default to enabled
          } 
        }
      );
      console.log('✓ Super admin consultation settings initialized');
    }

    // Create collections if they don't exist
    console.log('Creating consultation collections...');
    await db.createCollection('consultationRequests');
    await db.createCollection('consultationSessions');
    await db.createCollection('consultationMessages');

    // Create indexes
    await db.collection('consultationRequests').createIndex({ studentId: 1 });
    await db.collection('consultationRequests').createIndex({ expertId: 1 });
    await db.collection('consultationRequests').createIndex({ status: 1 });
    await db.collection('consultationSessions').createIndex({ studentId: 1 });
    await db.collection('consultationSessions').createIndex({ expertId: 1 });
    await db.collection('consultationSessions').createIndex({ status: 1 });
    await db.collection('consultationMessages').createIndex({ sessionId: 1 });
    await db.collection('consultationMessages').createIndex({ createdAt: 1 });

    console.log('✓ Consultation system initialized successfully!');
    console.log('');
    console.log('Summary:');
    console.log('- Expert fields added to all users');
    console.log('- Instructors and admins marked as experts');
    console.log('- Consultation collections created');
    console.log('- Indexes created for performance');

  } catch (error) {
    console.error('❌ Error initializing consultation system:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

initConsultationSystem();





