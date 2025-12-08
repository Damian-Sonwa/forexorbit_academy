/**
 * MongoDB Data Backup Script
 * Creates a backup of all collections before running seed scripts
 * Run this before any major data operations
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

async function backupData() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('❌ MONGO_URI not found in .env.local');
      return;
    }

    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB Atlas\n');

    const db = client.db('Forex_elearning');
    const collections = await db.listCollections().toArray();
    
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}`);

    console.log('📦 Creating backup...\n');

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = db.collection(collectionName);
      const data = await collection.find({}).toArray();
      
      const filePath = path.join(backupPath, `${collectionName}.json`);
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`   ✓ Backed up ${collectionName}: ${data.length} documents`);
    }

    console.log(`\n✅ Backup completed: ${backupPath}`);
    console.log(`\n📝 To restore this backup, use: node scripts/restore-data.js ${timestamp}`);

    await client.close();
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
  }
}

backupData();




