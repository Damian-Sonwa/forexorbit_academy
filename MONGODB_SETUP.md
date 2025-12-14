# MongoDB Atlas Integration Guide

## Connection String

The MongoDB connection string should be stored in `.env.local`:

```env
MONGO_URI=mongodb+srv://Damian25:sopuluchukwu@cluster0.tcjhicx.mongodb.net/?appName=Cluster0
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
NEXT_PUBLIC_SOCKET_URL=http://localhost:3000
```

**Important**: The database name (`Forex_elearning`) is specified in the code, not in the connection string.

## Database Structure

All data is stored in the `Forex_elearning` database with the following collections:

- **users** - User accounts (email, password, role, name)
- **courses** - Course information (title, description, category, difficulty)
- **lessons** - Lesson content (courseId, title, videoUrl, content)
- **quizzes** - Quiz questions (lessonId, questions array)
- **progress** - User progress tracking (userId, courseId, completedLessons, progress %)
- **messages** - Chat messages (lessonId, userId, text, timestamp)
- **quizScores** - Quiz submission scores (userId, lessonId, score, answers)

## Seeding the Database

Run the seeder to populate MongoDB Atlas with sample data:

```bash
npm run seed
```

This will create:
- 3 users (student, instructor, admin)
- 3 courses
- 6 lessons
- 3 quizzes
- 1 progress entry

## Verifying Connection

1. Check server logs - you should see:
   ```
   ✓ MongoDB client connected (development)
   > MongoDB: Connected to Atlas cluster
   > Database: Forex_elearning
   ```

2. Check MongoDB Atlas:
   - Go to your cluster in MongoDB Atlas
   - Click "Browse Collections"
   - You should see the `Forex_elearning` database with all collections

3. Test API endpoints:
   - `GET /api/courses` - Should return courses from MongoDB
   - `POST /api/auth/login` - Should authenticate against MongoDB users

## Troubleshooting

### Connection Issues

1. **Check .env.local exists** and has correct MONGO_URI
2. **Verify MongoDB Atlas IP whitelist** - Add `0.0.0.0/0` for development
3. **Check network connectivity** - Ensure you can reach MongoDB Atlas
4. **Verify credentials** - Username and password in connection string

### Data Not Appearing

1. **Run seeder**: `npm run seed`
2. **Check database name**: Should be `Forex_elearning`
3. **Check collections**: All 7 collections should exist
4. **Verify API routes**: Check browser console for errors

## Files Modified

- `db/mongoClient.ts` - Centralized MongoDB client
- `lib/mongodb.ts` - Wrapper for backward compatibility
- `lib/mongodb.js` - CommonJS version for server.js
- `seed/seed.ts` - TypeScript seeder
- `seed/seed.js` - JavaScript seeder (use this one)
- `server.js` - Added environment validation
- All API routes - Use `getDb()` from lib/mongodb

