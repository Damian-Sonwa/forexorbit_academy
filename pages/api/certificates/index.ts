import { unexpectedBody } from '@/lib/public-error';
/**
 * Certificates API Route
 * GET: List certificates (role-based)
 * POST: Generate certificate for completed course
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isActiveEnrollment } from '@/lib/enrollment-state';
import { courseCompletion, currentCompletedIds, currentLessonIdsFor } from '@/lib/course-progress';
import { isDuplicateKey } from '@/lib/certificate-issue';

// GET certificates - role-based
async function getCertificates(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const certificates = db.collection('certificates');
    const courses = db.collection('courses');
    const users = db.collection('users');
    // const progress = db.collection('progress'); // Reserved for future use

    const query: Record<string, unknown> = {};

    // Student: only their certificates
    if (req.user!.role === 'student') {
      query.userId = req.user!.userId;
    }

    // Instructor: certificates for students in their courses
    if (req.user!.role === 'instructor') {
      const instructorCourses = await courses.find({ instructorId: req.user!.userId }).toArray();
      const courseIds = instructorCourses.map(c => c._id?.toString() || c.id);
      if (courseIds.length > 0) {
        query.courseId = { $in: courseIds };
      } else {
        // No courses, return empty
        return res.json([]);
      }
    }

    // Admin: all certificates (can filter with query params)
    if (req.user!.role === 'admin') {
      const { courseId, userId, instructorId } = req.query;
      if (courseId) query.courseId = courseId;
      if (userId) query.userId = userId;
      if (instructorId) {
        const instructorCourses = await courses.find({ instructorId }).toArray();
        const courseIds = instructorCourses.map(c => c._id.toString());
        query.courseId = { $in: courseIds };
      }
    }

    const certificatesList = await certificates.find(query).sort({ issuedAt: -1 }).toArray();

    // Enrich with course and user details
    const enrichedCertificates = await Promise.all(
      certificatesList.map(async (cert) => {
        let course = null;
        let user = null;
        let instructor = null;
        
        try {
          course = await courses.findOne({ _id: new ObjectId(cert.courseId) });
        } catch {
          course = await courses.findOne({ _id: cert.courseId });
        }
        
        try {
          user = await users.findOne({ _id: new ObjectId(cert.userId) });
        } catch {
          // If userId is already an ObjectId, use it directly
          const userId = cert.userId instanceof ObjectId ? cert.userId : new ObjectId(cert.userId);
          user = await users.findOne({ _id: userId });
        }
        
        if (course?.instructorId) {
          try {
            instructor = await users.findOne({ _id: new ObjectId(course.instructorId) });
          } catch {
            instructor = await users.findOne({ _id: course.instructorId });
          }
        }

        return {
          ...cert,
          course: course ? {
            id: course._id.toString(),
            title: course.title,
            difficulty: course.difficulty,
            category: course.category,
          } : null,
          user: user ? {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
          } : null,
          instructor: instructor ? {
            id: instructor._id.toString(),
            name: instructor.name,
          } : null,
        };
      })
    );

    res.json(enrichedCertificates);
  } catch (error: any) {
    console.error('Get certificates error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

// POST generate certificate
async function generateCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId } = req.body;
    const userId = req.user!.userId;

    if (typeof courseId !== 'string' || !ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Course ID required' });
    }

    const db = await getDb();
    const progress = db.collection('progress');
    const courses = db.collection('courses');
    const certificates = db.collection('certificates');

    // Check if course exists
    const course = await courses.findOne({ _id: new ObjectId(courseId) });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Completion is measured against the course's current lessons, so deleted lessons cannot
    // stand in for real ones; a completion already recorded is kept when lessons are added
    // (lib/course-progress.js, Decision 4).
    const userProgress = await progress.findOne({ userId, courseId });
    const currentLessonIds = userProgress ? await currentLessonIdsFor(db, courseId) : [];
    const completion = courseCompletion({ enrollment: userProgress, currentLessonIds });
    if (!userProgress || !isActiveEnrollment(userProgress) || !completion.complete) {
      return res.status(400).json({ error: 'Course not completed. Complete all lessons to earn a certificate.' });
    }
    if (!userProgress.completedAt) {
      await progress.updateOne({ _id: userProgress._id, completedAt: { $exists: false } }, { $set: { completedAt: new Date() } });
    }

    // Check if certificate already exists
    const existingCert = await certificates.findOne({ userId, courseId });
    if (existingCert) {
      return res.status(400).json({ error: 'Certificate already issued' });
    }

    const totalLessons = currentLessonIds.length;

    // Generate certificate
    const certificate = {
      userId,
      courseId,
      certificateId: `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      issuedAt: new Date(),
      progress: Math.min(100, typeof userProgress.progress === 'number' ? userProgress.progress : completion.percent),
      completedLessons: currentCompletedIds(userProgress.completedLessons, currentLessonIds).length,
      completionBasis: completion.basis,
      totalLessons,
      createdAt: new Date(),
    };

    let result;
    try {
      result = await certificates.insertOne(certificate);
    } catch (insertError) {
      // A parallel request issued it first (unique { userId, courseId } index).
      if (isDuplicateKey(insertError)) {
        return res.status(400).json({ error: 'Certificate already issued' });
      }
      throw insertError;
    }

    res.status(201).json({
      ...certificate,
      _id: result.insertedId.toString(),
    });
  } catch (error: any) {
    console.error('Generate certificate error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getCertificates(req, res);
  } else if (req.method === 'POST') {
    return generateCertificate(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

