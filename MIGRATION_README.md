# Lesson Content Migration Guide

This guide explains how to migrate lesson content storage in MongoDB for the Forexorbit app.

## Problem
The lesson content was previously stored in `lessonSummary.overview` or `lessonSummary.summary`, but the application expects it in the `content` field for TinyMCE editors to load properly.

## Solution
The migration script updates all lessons to:
- Set `content` = `lessonSummary.overview` (or `lessonSummary.summary`)
- Ensure `description` contains HTML for TinyMCE
- Create `summary` field if missing
- Preserve all other fields (videoUrl, pdfUrl, resources, visualAids, etc.)

## Running the Migration

### Option 1: Node.js Script (Recommended)
```bash
# Run the migration script
node scripts/migrate-lesson-content.js
```

### Option 2: API Endpoint
```bash
# Start the Next.js development server
npm run dev

# Then call the API endpoint
curl -X POST http://localhost:3000/api/migrate-lessons
```

Or visit: http://localhost:3000/api/migrate-lessons in your browser and use a tool like Postman to send a POST request.

## What the Migration Does

For each lesson document in the "lessons" collection:

1. **Content Field**: Sets `content` to the detailed summary from `lessonSummary.overview`
2. **Summary Field**: Creates or ensures the `summary` field exists with the content
3. **Description Field**: Converts plain text descriptions to HTML format for TinyMCE
4. **Preservation**: Keeps all other fields intact (videoUrl, pdfUrl, resources, visualAids, order, type, timestamps, etc.)

## Database Connection

The script automatically tries to connect to:
1. MongoDB Atlas (using the connection string from your task)
2. Local MongoDB (mongodb://localhost:27017) as fallback

## Expected Output

```
🚀 Starting lesson content migration...
📡 Attempting connection to MongoDB Atlas...
✅ Connected to MongoDB Atlas
📊 Found X lessons to migrate
✅ Updated lesson "Lesson Title": [ 'content', 'description' ]
✅ Updated lesson "Another Lesson": [ 'summary' ]

📈 Migration Summary:
✅ Lessons updated: X
⏭️  Lessons skipped: Y
🎉 Migration completed successfully!
```

## Verification

After migration, verify that:
- TinyMCE editors load content correctly in both Instructor and Student dashboards
- Lesson descriptions display properly
- No data is lost in other lesson fields
- The `content` field contains the detailed summary content

## Safety Features

- **No Data Loss**: Only adds/updates specific fields, never deletes data
- **Idempotent**: Can be run multiple times safely
- **Logging**: Shows exactly which lessons were updated and why
- **Error Handling**: Graceful failure with detailed error messages