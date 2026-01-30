/**
 * Migration: Add summary field to existing lessons
 * This script ensures all lessons have a summary field for TinyMCE editor compatibility
 * It migrates existing lessonSummary.overview content to the summary field
 */

const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function connectWithRetry(uri, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔌 Attempting MongoDB connection (attempt ${attempt}/${maxRetries})...`);
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      await client.connect();
      console.log('✓ Connected to MongoDB');
      return client;
    } catch (error) {
      console.log(`❌ Connection attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function migrateLessonSummaries() {
  let client;
  try {
    console.log('🔄 Starting lesson summary migration...');

    // Validate MONGO_URI
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGO_URI not defined in .env.local');
    }

    client = await connectWithRetry(uri);
    const db = client.db('Forex_elearning');
    const lessons = db.collection('lessons');

    // Get all lessons
    const allLessons = await lessons.find({}).toArray();
    console.log(`📊 Found ${allLessons.length} lessons to process`);

    let updated = 0;
    let skipped = 0;

    for (const lesson of allLessons) {
      let summaryValue = '';

      // Priority: lessonSummary.overview > existing summary field > empty string
      if (lesson.lessonSummary && lesson.lessonSummary.overview) {
        summaryValue = lesson.lessonSummary.overview;
        console.log(`📝 Migrating summary from lessonSummary.overview for: ${lesson.title}`);
      } else if (lesson.summary) {
        summaryValue = lesson.summary;
        console.log(`✅ Summary already exists for: ${lesson.title}`);
        skipped++;
        continue; // Already has summary, skip
      } else {
        summaryValue = '';
        console.log(`📝 Adding empty summary for: ${lesson.title}`);
      }

      // Update the lesson with the summary field
      await lessons.updateOne(
        { _id: lesson._id },
        {
          $set: {
            summary: summaryValue,
            updatedAt: new Date()
          }
        }
      );

      updated++;
    }

    console.log(`\n✅ Migration completed successfully!`);
    console.log(`   - Updated: ${updated} lessons`);
    console.log(`   - Skipped: ${skipped} lessons (already had summary)`);
    console.log(`   - Total processed: ${allLessons.length} lessons`);

    // Verify the migration
    const sampleLessons = await lessons.find({}).limit(3).toArray();
    console.log('\n🔍 Verification - Sample lessons after migration:');
    sampleLessons.forEach((lesson, index) => {
      console.log(`   ${index + 1}. ${lesson.title}: summary length = ${lesson.summary ? lesson.summary.length : 0} chars`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 MongoDB connection closed');
    }
  }
}

// Run the migration
migrateLessonSummaries();