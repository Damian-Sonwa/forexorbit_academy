/**
 * Learning Level Utilities
 * Handles level-based access control and auto-advancement
 */

import { getDb } from './mongodb';
import { ObjectId } from 'mongodb';

export type LearningLevel = 'beginner' | 'intermediate' | 'advanced';

/**
 * Check if user has access to a room based on their learning level
 * CRITICAL: Students can ONLY access their exact level room (level-specific access)
 * Instructors/Admins have access to all rooms
 */
export function canAccessRoom(userLevel: LearningLevel, roomName: string, userRole?: string): boolean {
  // Non-students (instructors, admins, superadmins) have access to all rooms
  if (userRole && userRole !== 'student') {
    return true; // Instructors, admins, and superadmins can access all rooms
  }

  const roomLevel = roomName.toLowerCase();
  
  // For students: STRICT level matching - only access their exact level room
  switch (userLevel) {
    case 'beginner':
      return roomLevel === 'beginner';
    case 'intermediate':
      return roomLevel === 'intermediate'; // ONLY intermediate, not beginner
    case 'advanced':
      return roomLevel === 'advanced'; // ONLY advanced, not beginner or intermediate
    default:
      return false;
  }
}

/**
 * Get the next learning level after completing current level
 */
export function getNextLevel(currentLevel: LearningLevel): LearningLevel | null {
  switch (currentLevel) {
    case 'beginner':
      return 'intermediate';
    case 'intermediate':
      return 'advanced';
    case 'advanced':
      return null; // Already at max level
    default:
      return 'intermediate';
  }
}

/**
 * Check if all courses in a level are completed
 */
export async function checkLevelCompletion(
  userId: string,
  level: 'beginner' | 'intermediate' | 'advanced'
): Promise<boolean> {
  try {
    const db = await getDb();
    const courses = db.collection('courses');
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');

    // Get all courses for this level
    const levelCourses = await courses
      .find({ difficulty: level })
      .toArray();

    if (levelCourses.length === 0) {
      return false;
    }

    // Check if all courses are completed
    for (const course of levelCourses) {
      const courseId = course._id.toString();
      
      // Get all lessons for this course
      const courseLessons = await lessons.find({ courseId }).toArray();
      
      if (courseLessons.length === 0) {
        continue; // Skip courses with no lessons
      }

      // Get user progress for this course
      const userProgress = await progress.findOne({
        userId,
        courseId,
      });

      if (!userProgress) {
        return false; // Course not started
      }

      // Check if all lessons are completed
      const completedLessons = userProgress.completedLessons || [];
      const allLessonsCompleted = courseLessons.every((lesson) =>
        completedLessons.includes(lesson._id.toString())
      );

      if (!allLessonsCompleted) {
        return false; // Not all lessons completed
      }
    }

    return true; // All courses in level are completed
  } catch (error) {
    console.error('Error checking level completion:', error);
    return false;
  }
}

/**
 * Update user's learning level if they've completed the current level
 */
export async function updateLearningLevelIfEligible(userId: string): Promise<LearningLevel> {
  try {
    const db = await getDb();
    const users = db.collection('users');

    // Get current user level
    const user = await users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { learningLevel: 1, role: 1 } }
    );

    if (!user) {
      return 'beginner';
    }

    // Non-students don't need level updates
    if (user.role !== 'student') {
      return 'advanced';
    }

    let currentLevel: LearningLevel = (user.learningLevel as LearningLevel) || 'beginner';

    // Check if beginner level is completed
    if (currentLevel === 'beginner') {
      const beginnerCompleted = await checkLevelCompletion(userId, 'beginner');
      if (beginnerCompleted) {
        currentLevel = 'intermediate';
        await users.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { learningLevel: 'intermediate', levelUpdatedAt: new Date() } }
        );
        console.log(`User ${userId} advanced to intermediate level`);
      }
    }

    // Check if intermediate level is completed
    if (currentLevel === 'intermediate') {
      const intermediateCompleted = await checkLevelCompletion(userId, 'intermediate');
      if (intermediateCompleted) {
        currentLevel = 'advanced';
        await users.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { learningLevel: 'advanced', levelUpdatedAt: new Date() } }
        );
        console.log(`User ${userId} advanced to advanced level`);
      }
    }

    return currentLevel;
  } catch (error) {
    console.error('Error updating learning level:', error);
    return 'beginner';
  }
}








