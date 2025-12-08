/**
 * MongoDB Data Restore Script
 * Restores data from a backup
 * Usage: node scripts/restore-data.js <backup-timestamp>
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

async function restoreData(backupTimestamp) {
  try {
    if (!backupTimestamp) {
      console.error('❌ Please provide a backup timestamp');
      console.log('Usage: node scripts/restore-data.js <backup-timestamp>');
      console.log('Example: node scripts/restore-data.js 2024-01-15T10-30-00-000Z');
      return;
    }

    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI not found in .env.local');
      return;
    }

    const backupPath = path.join(__dirname, '..', 'backups', `backup-${backupTimestamp}`);
    if (!fs.existsSync(backupPath)) {
      console.error(`❌ Backup not found: ${backupPath}`);
      return;
    }

    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB Atlas\n');

    const db = client.db('Forex_elearning');
    const files = fs.readdirSync(backupPath);

    console.log('📦 Restoring backup...\n');

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const collectionName = file.replace('.json', '');
      const filePath = path.join(backupPath, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      const collection = db.collection(collectionName);
      
      // Clear existing data
      await collection.deleteMany({});
      
      // Restore data
      if (data.length > 0) {
        await collection.insertMany(data);
      }
      
      console.log(`   ✓ Restored ${collectionName}: ${data.length} documents`);
    }

    console.log(`\n✅ Restore completed from: ${backupTimestamp}`);

    await client.close();
  } catch (error) {
    console.error('❌ Restore failed:', error.message);
  }
}

const backupTimestamp = process.argv[2];
restoreData(backupTimestamp);

