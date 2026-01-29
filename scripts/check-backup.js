/**
 * Check MongoDB Atlas for Backup/Recovery Options
 * This script helps identify if there are any recovery options available
 */

const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function checkBackupOptions() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI not found in .env.local');
      return;
    }

    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB Atlas\n');

    const adminDb = client.db().admin();
    
    // Check database info
    const db = client.db('Forex_elearning');
    const collections = await db.listCollections().toArray();
    
    console.log('📊 Current Database Status:');
    console.log(`   Database: Forex_elearning`);
    console.log(`   Collections: ${collections.length}`);
    collections.forEach(col => {
      console.log(`   - ${col.name}`);
    });

    console.log('\n⚠️  IMPORTANT: Data Recovery Options\n');
    console.log('1. MongoDB Atlas Point-in-Time Recovery:');
    console.log('   - Go to MongoDB Atlas Dashboard');
    console.log('   - Navigate to your cluster');
    console.log('   - Check "Backup" or "Continuous Backup" section');
    console.log('   - If enabled, you can restore to a point before the seed script ran\n');

    console.log('2. Manual Backups:');
    console.log('   - Check if you have any manual backups');
    console.log('   - Look for exported JSON files or MongoDB dumps\n');

    console.log('3. If no backups exist:');
    console.log('   - Unfortunately, the data cannot be recovered');
    console.log('   - You will need to re-upload all content through the instructor dashboard\n');

    console.log('📝 To prevent this in the future:');
    console.log('   - The seed script delete operations are now commented out');
    console.log('   - Consider enabling MongoDB Atlas automated backups');
    console.log('   - Create manual backups before running seed scripts\n');

    await client.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkBackupOptions();




