/**
 * Lesson Content Migration Script
 * Migrates lesson content storage in MongoDB for Forexorbit app
 *
 * This script:
 * 1. Connects to MongoDB (local or Atlas)
 * 2. Updates all lessons in the 'lessons' collection
 * 3. Sets content = lessonSummary.overview (or lessonSummary.summary)
 * 4. Ensures description contains proper HTML for TinyMCE
 * 5. Creates summary field if missing
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  require('dotenv').config({ path: '.env.local' });
} else {
  require('dotenv').config();
}

async function migrateLessonContent() {
  let client;

  try {
    console.log('🚀 Starting lesson content migration...');

    const uri = (process.env.MONGO_URI || process.env.MONGODB_URI)?.trim();
    if (!uri) {
      console.error('❌ Set MONGO_URI or MONGODB_URI (e.g. in .env.local).');
      process.exit(1);
    }
    console.log('📡 Connecting with MONGO_URI / MONGODB_URI...');
    client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('Forex_elearning');
    const lessonsCollection = db.collection('lessons');

    // Get all lessons
    const lessons = await lessonsCollection.find({}).toArray();
    console.log(`📊 Found ${lessons.length} lessons to migrate`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const lesson of lessons) {
      const lessonId = lesson._id;
      const title = lesson.title;

      // Determine the source content for migration
      let sourceContent = '';

      if (lesson.lessonSummary?.overview) {
        sourceContent = lesson.lessonSummary.overview;
      } else if (lesson.lessonSummary?.summary) {
        sourceContent = lesson.lessonSummary.summary;
      } else if (lesson.summary) {
        sourceContent = lesson.summary;
      }

      // Skip if no content to migrate
      if (!sourceContent) {
        console.log(`⏭️  Skipping lesson "${title}" - no summary content found`);
        skippedCount++;
        continue;
      }

      // Prepare update object
      const updateData = {};

      // Set content field to the detailed summary
      if (!lesson.content || lesson.content !== sourceContent) {
        updateData.content = sourceContent;
      }

      // Ensure summary field exists and is populated
      if (!lesson.summary) {
        updateData.summary = sourceContent;
      }

      // Convert description to HTML if it's plain text
      if (lesson.description && !lesson.description.includes('<p>') && !lesson.description.includes('<')) {
        // Wrap plain text description in HTML paragraph tags for TinyMCE
        updateData.description = `<p>${lesson.description}</p>`;
      }

      // Update the lesson if there are changes
      if (Object.keys(updateData).length > 0) {
        const result = await lessonsCollection.updateOne(
          { _id: lessonId },
          {
            $set: {
              ...updateData,
              updatedAt: new Date()
            }
          }
        );

        if (result.modifiedCount > 0) {
          console.log(`✅ Updated lesson "${title}":`, Object.keys(updateData));
          updatedCount++;
        } else {
          console.log(`⏭️  No changes needed for lesson "${title}"`);
        }
      } else {
        console.log(`⏭️  No migration needed for lesson "${title}"`);
        skippedCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`✅ Lessons updated: ${updatedCount}`);
    console.log(`⏭️  Lessons skipped: ${skippedCount}`);
    console.log('🎉 Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run the migration
migrateLessonContent().catch(console.error);