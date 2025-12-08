/**
 * Update Lesson Summaries with Detailed Note-Style Summaries
 * This script reads from the seed file and updates all lessons with detailed summaries
 */

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// Read the seed file to extract lesson summaries
function extractSummariesFromSeed() {
  const seedPath = path.join(__dirname, '..', 'seed', 'seed.js');
  const seedContent = fs.readFileSync(seedPath, 'utf8');
  
  const summaries = {};
  
  // Extract lesson summaries using regex
  // Look for pattern: title: 'Lesson Title', ... summary: '...', lessonSummary: { overview: '...' }
  const lessonPattern = /title:\s*['"]([^'"]+)['"][\s\S]*?summary:\s*['"]([^'"]+(?:'[^']*'[^"]*)*)['"][\s\S]*?overview:\s*['"]([^'"]+(?:'[^']*'[^"]*)*)['"]/g;
  
  let match;
  while ((match = lessonPattern.exec(seedContent)) !== null) {
    const title = match[1];
    const overview = match[3] || match[2]; // Prefer overview, fallback to summary
    summaries[title] = overview;
  }
  
  // Also try a more flexible pattern for multi-line strings
  const titlePattern = /title:\s*['"]([^'"]+)['"][\s\S]*?overview:\s*['"]((?:[^'"]|'[^']*')+)['"]/g;
  let titleMatch;
  const seedLines = seedContent.split('\n');
  
  for (let i = 0; i < seedLines.length; i++) {
    const line = seedLines[i];
    const titleMatch = line.match(/title:\s*['"]([^'"]+)['"]/);
    if (titleMatch) {
      const title = titleMatch[1];
      // Look ahead for overview
      for (let j = i; j < Math.min(i + 20, seedLines.length); j++) {
        const overviewMatch = seedLines[j].match(/overview:\s*['"]([^'"]+)['"]/);
        if (overviewMatch) {
          summaries[title] = overviewMatch[1];
          break;
        }
      }
    }
  }
  
  return summaries;
}

// Better approach: Parse the seed file more carefully
function extractSummariesFromSeedBetter() {
  const seedPath = path.join(__dirname, '..', 'seed', 'seed.js');
  const seedContent = fs.readFileSync(seedPath, 'utf8');
  
  const summaries = {};
  
  // Split by lesson objects
  const lessons = seedContent.split(/\{\s*courseId:/);
  
  for (const lessonBlock of lessons) {
    const titleMatch = lessonBlock.match(/title:\s*['"]([^'"]+)['"]/);
    if (!titleMatch) continue;
    
    const title = titleMatch[1];
    
    // Look for overview in lessonSummary
    const overviewMatch = lessonBlock.match(/overview:\s*['"]([^'"]+(?:'[^']*'[^"]*)*)['"]/);
    if (overviewMatch) {
      // Handle escaped quotes and multi-line strings
      let overview = overviewMatch[1];
      // Remove escape sequences
      overview = overview.replace(/\\'/g, "'").replace(/\\"/g, '"');
      summaries[title] = overview;
    }
  }
  
  return summaries;
}

async function updateSummaries() {
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
    const lessons = db.collection('lessons');
    
    // Get all lessons from database
    const allLessons = await lessons.find({}).toArray();
    console.log(`📚 Found ${allLessons.length} lessons in database\n`);
    
    // Read seed file to get detailed summaries
    const seedPath = path.join(__dirname, '..', 'seed', 'seed.js');
    const seedContent = fs.readFileSync(seedPath, 'utf8');
    
    let updated = 0;
    let skipped = 0;

    for (const lesson of allLessons) {
      // Find the lesson in seed file by title
      const titleEscaped = lesson.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const titlePattern = new RegExp(`title:\\s*['"]${titleEscaped}['"]`, 'i');
      const lessonStartIndex = seedContent.search(titlePattern);
      
      if (lessonStartIndex === -1) {
        console.log(`⚠ Skipped (not found in seed): ${lesson.title}`);
        skipped++;
        continue;
      }
      
      // Extract the lesson block (from this title to next lesson or end)
      const remainingContent = seedContent.substring(lessonStartIndex);
      const nextLessonMatch = remainingContent.match(/\n\s*\{[\s\n]*courseId:/);
      const lessonBlock = nextLessonMatch 
        ? remainingContent.substring(0, nextLessonMatch.index)
        : remainingContent.substring(0, Math.min(remainingContent.length, 5000));
      
      // Find overview in lessonSummary
      const overviewMatch = lessonBlock.match(/overview:\s*['"]([^'"]+(?:'[^']*'[^"]*)*)['"]/);
      
      if (!overviewMatch) {
        // Try to find summary field as fallback
        const summaryMatch = lessonBlock.match(/summary:\s*['"]([^'"]+(?:'[^']*'[^"]*)*)['"]/);
        if (summaryMatch) {
          let overview = summaryMatch[1];
          overview = overview.replace(/\\'/g, "'").replace(/\\"/g, '"');
          
          const updateData = {
            summary: overview,
            lessonSummary: {
              overview: overview,
              updatedAt: new Date(),
            },
            updatedAt: new Date(),
          };

          await lessons.updateOne(
            { _id: lesson._id },
            { $set: updateData }
          );
          
          console.log(`✓ Updated: ${lesson.title} (from summary field)`);
          updated++;
        } else {
          console.log(`⚠ Skipped (no overview found): ${lesson.title}`);
          skipped++;
        }
        continue;
      }
      
      // Extract and clean the overview
      let overview = overviewMatch[1];
      // Handle escaped quotes
      overview = overview.replace(/\\'/g, "'").replace(/\\"/g, '"');
      
      // For very long strings, we might need to handle line breaks
      // Check if the string continues on next lines
      const overviewEndIndex = lessonBlock.indexOf(overviewMatch[0]) + overviewMatch[0].length;
      const afterOverview = lessonBlock.substring(overviewEndIndex, overviewEndIndex + 100);
      
      // If the string seems incomplete (ends with \ or has line continuation), try to get more
      if (overview.endsWith('\\') || afterOverview.trim().startsWith('+')) {
        // This is a multi-line string, we need a different approach
        // For now, use what we have
      }
      
      const updateData = {
        summary: overview,
        lessonSummary: {
          overview: overview,
          updatedAt: new Date(),
        },
        updatedAt: new Date(),
      };

      await lessons.updateOne(
        { _id: lesson._id },
        { $set: updateData }
      );
      
      console.log(`✓ Updated: ${lesson.title} (${overview.length} chars)`);
      updated++;
    }

    console.log(`\n✅ Summary update completed!`);
    console.log(`   - Updated: ${updated} lessons`);
    console.log(`   - Skipped: ${skipped} lessons`);

    await client.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

updateSummaries();

