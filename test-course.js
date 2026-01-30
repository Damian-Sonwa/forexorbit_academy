const { MongoClient, ObjectId } = require('mongodb');

async function createTestCourse() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('Forex_elearning');

  const course = {
    title: 'Test Course with Description',
    description: '<p>This is a <strong>test course description</strong> with <em>rich text formatting</em>.</p><p>It includes multiple paragraphs and <a href="#">links</a>.</p>',
    category: 'basics',
    difficulty: 'beginner',
    instructorId: '507f1f77bcf86cd799439011',
    thumbnail: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection('courses').insertOne(course);
  console.log('Created course with ID:', result.insertedId);
  await client.close();
}

createTestCourse().catch(console.error);