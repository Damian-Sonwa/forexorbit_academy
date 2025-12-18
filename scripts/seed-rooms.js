/**
 * Seed Community Rooms
 * Ensures Beginner, Intermediate, Advanced rooms exist in MongoDB
 * Run this script once to initialize rooms
 */

const { MongoClient } = require('mongodb');

// Use environment variable or default
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not defined');
  process.exit(1);
}

async function seedRooms() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    const db = client.db();
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
    console.error('❌ Error seeding rooms:', error);
    process.exit(1);
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

module.exports = { seedRooms };

