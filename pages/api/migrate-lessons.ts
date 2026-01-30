import { MongoClient } from 'mongodb';
import { NextApiRequest, NextApiResponse } from 'next';

interface Lesson {
  _id: string;
  courseId: string;
  title: string;
  description?: string;
  summary?: string;
  content?: string;
  lessonSummary?: {
    overview?: string;
    summary?: string;
    updatedAt?: Date;
  };
  videoUrl?: string;
  pdfUrl?: string;
  type?: string;
  order?: number;
  createdAt?: Date;
  updatedAt?: Date;
  resources?: any[];
  visualAids?: any[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;

  try {
    console.log('🚀 Starting lesson content migration via API...');

    // Use the connection string from environment or the one provided in the task
    const uri = process.env.MONGO_URI || 'mongodb+srv://Damian25:sopuluchukwu@cluster0.tcjhicx.mongodb.net/Forex_elearning?appName=Cluster0';

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
    const updatedLessons = [];

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
      const updateData: Partial<Lesson> = {};

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
          const updateInfo = {
            lessonId: lessonId.toString(),
            title,
            updatedFields: Object.keys(updateData)
          };
          updatedLessons.push(updateInfo);
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

    const summary = {
      totalLessons: lessons.length,
      updatedCount,
      skippedCount,
      updatedLessons
    };

    console.log('\n📈 Migration Summary:');
    console.log(`✅ Lessons updated: ${updatedCount}`);
    console.log(`⏭️  Lessons skipped: ${skippedCount}`);
    console.log('🎉 Migration completed successfully!');

    res.status(200).json({
      success: true,
      message: 'Lesson content migration completed',
      summary
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Database connection closed');
    }
  }
}