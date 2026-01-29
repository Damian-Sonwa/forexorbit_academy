/**
 * Admin Send Certificate API Route
 * Allows admins to send certificates to students by ID or email
 * POST: Send certificate to student
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Send certificate to a student
 * Body: { studentIdentifier: string (ID or email), courseId: string, sendEmail?: boolean }
 */
async function sendCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    // Verify user is admin or superadmin
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { studentIdentifier, courseId, sendEmail = false } = req.body;

    if (!studentIdentifier || !courseId) {
      return res.status(400).json({ 
        error: 'Student identifier (ID or email) and course ID are required' 
      });
    }

    const db = await getDb();
    const users = db.collection('users');
    const courses = db.collection('courses');
    const certificates = db.collection('certificates');
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');

    // Find student by ID or email
    let student;
    try {
      // Try to find by ObjectId first (if it's a valid ID)
      if (ObjectId.isValid(studentIdentifier) && studentIdentifier.length === 24) {
        student = await users.findOne({ 
          _id: new ObjectId(studentIdentifier),
          role: 'student'
        });
      }
      
      // If not found by ID, try email
      if (!student) {
        student = await users.findOne({ 
          email: studentIdentifier,
          role: 'student'
        });
      }
    } catch {
      // If ObjectId conversion fails, try email
      student = await users.findOne({ 
        email: studentIdentifier,
        role: 'student'
      });
    }

    if (!student) {
      return res.status(404).json({ 
        error: 'Student not found. Please check the student ID or email address.' 
      });
    }

    // Verify course exists
    let course;
    try {
      course = await courses.findOne({ _id: new ObjectId(courseId) });
    } catch {
      return res.status(400).json({ error: 'Invalid course ID format' });
    }

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const userId = student._id.toString();
    const courseIdStr = course._id.toString();

    // Check if certificate already exists
    const existingCert = await certificates.findOne({ 
      userId,
      courseId: courseIdStr
    });

    if (existingCert) {
      return res.status(400).json({ 
        error: 'Certificate already issued to this student for this course',
        certificate: {
          id: existingCert._id.toString(),
          certificateId: existingCert.certificateId,
          issuedAt: existingCert.issuedAt,
        }
      });
    }

    // Get total lessons count for the course
    const totalLessons = await lessons.countDocuments({ courseId: courseIdStr });

    // Get student progress (if exists)
    const userProgress = await progress.findOne({ userId, courseId: courseIdStr });
    const completedLessons = userProgress?.completedLessons?.length || 0;
    const progressPercent = userProgress?.progress || 0;

    // Generate certificate
    const certificate = {
      userId,
      courseId: courseIdStr,
      certificateId: `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      issuedAt: new Date(),
      progress: progressPercent,
      completedLessons,
      totalLessons,
      issuedBy: req.user!.email, // Track who issued the certificate
      issuedByRole: req.user!.role,
      createdAt: new Date(),
    };

    const result = await certificates.insertOne(certificate);

    // Note: Socket.io event emission for real-time updates would be handled by the socket server
    // The certificates page already listens for 'certificateIssued' events
    // Students will see the certificate when they refresh or when the page refetches

    // Optional: Send email notification
    // Note: Email functionality would require nodemailer or similar service
    // This is a placeholder for future email integration
    if (sendEmail) {
      // TODO: Implement email sending using nodemailer
      // Example:
      // await sendCertificateEmail(student.email, {
      //   studentName: student.name,
      //   courseTitle: course.title,
      //   certificateId: certificate.certificateId,
      // });
      console.log(`[Email] Certificate notification would be sent to ${student.email}`);
    }

    res.status(201).json({
      success: true,
      message: `Certificate successfully issued to ${student.name} (${student.email})`,
      certificate: {
        id: result.insertedId.toString(),
        ...certificate,
        student: {
          id: student._id.toString(),
          name: student.name,
          email: student.email,
        },
        course: {
          id: course._id.toString(),
          title: course.title,
          difficulty: course.difficulty,
        },
      },
    });
  } catch (error: unknown) {
    console.error('Send certificate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return sendCertificate(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

