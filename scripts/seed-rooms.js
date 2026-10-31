/**
 * Seed Community Rooms
 * Ensures Beginner, Intermediate, Advanced rooms exist in MongoDB
 * Run this script once to initialize rooms
 */

const { MongoClient } = require('mongodb');

/** Same rule as lib/mongodb getDb: MONGODB_DB_NAME, else the shared Forex_elearning database. */
function databaseName(env = process.env) {
  return (env.MONGODB_DB_NAME && env.MONGODB_DB_NAME.trim()) || 'Forex_elearning';
}

async function seedRooms() {
  // Validate MONGO_URI before attempting connection
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI || (!MONGO_URI.startsWith('mongodb://') && !MONGO_URI.startsWith('mongodb+srv://'))) {
    console.warn('⚠ Invalid or missing MONGO_URI - skipping room seeding');
    return;
  }
  
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    // Never the connection string's default database: that would write outside the database the
    // application uses (in a test environment, outside the isolated test database).
    const db = client.db(databaseName());
    const rooms = db.collection('communityRooms');
    
    const roomNames = ['Beginner', 'Intermediate', 'Advanced'];
    const descriptions = {
      'Beginner': 'Perfect for newcomers learning basic concepts, market introductions, and simple analysis.',
      'Intermediate': 'For mid-level traders sharing strategies, chart analysis, and trading setups.',
      'Advanced': 'For experienced traders discussing deep technical analysis, macro news, and advanced strategies.',
    };
    
    console.log('Checking for existing rooms...');
    
    for (const roomName of roomNames) {
      const existing = await rooms.findOne({ name: roomName, type: 'global' });
      
      if (!existing) {
        const result = await rooms.insertOne({
          name: roomName,
          description: descriptions[roomName],
          type: 'global',
          participants: [],
          avatar: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`✓ Created room: ${roomName} (ID: ${result.insertedId})`);
      } else {
        console.log(`✓ Room already exists: ${roomName} (ID: ${existing._id})`);
      }
    }
    
    console.log('\n✅ All rooms seeded successfully!');
    
    // Verify all rooms exist
    const allRooms = await rooms.find({ type: 'global' }).toArray();
    console.log(`\n📋 Total rooms in database: ${allRooms.length}`);
    allRooms.forEach(room => {
      console.log(`   - ${room.name} (${room._id})`);
    });
    
  } catch (error) {
    console.error('Error seeding rooms');
    // Don't exit process if called from server.js (non-critical)
    if (require.main === module) {
      process.exit(1);
    }
    throw error; // Re-throw if called from server.js
  } finally {
    await client.close();
    console.log('\n✓ Database connection closed');
  }
}

// Run if called directly
if (require.main === module) {
  seedRooms()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { databaseName, seedRooms };
