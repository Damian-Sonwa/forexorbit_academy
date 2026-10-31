import { unexpectedBody } from '@/lib/public-error';
/**
 * Admin Send Certificate API Route
 * Allows admins to send certificates to students by ID or email
 * POST: Send certificate to student
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isActiveEnrollment, decideStaffCertificate } from '@/lib/enrollment-state';
import { courseCompletion, currentCompletedIds, currentLessonIdsFor, progressPercent as progressPercentOf } from '@/lib/course-progress';
import { checkStaffCertificateInput, decideStaffCertificateIssue, isDuplicateKey } from '@/lib/certificate-issue';
import { AUDIT_COLLECTION } from '@/lib/course-payment';

/**
 * Send certificate to a student
 * Body: { studentIdentifier: string (ID or email), courseId: string, reason?: string, sendEmail?: boolean }
 * Staff may issue without a recorded completion (existing policy), but then a reason is required;
 * the certificate records how completion was established and every issue is audited
 * (lib/certificate-issue.js).
 */
async function sendCertificate(req: AuthRequest, res: NextApiResponse) {
  try {
    const decision = decideStaffCertificate({ role: req.user!.role });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const input = checkStaffCertificateInput(req.body);
    if (!input.ok) {
      return res.status(input.status).json({ error: input.error, code: input.code, field: input.field });
    }
    const { lookup, courseId, reason, sendEmail } = input;

    const db = await getDb();
    const users = db.collection('users');
    const courses = db.collection('courses');
    const certificates = db.collection('certificates');
    const progress = db.collection('progress');

    // Find the student by ID or email (plain strings only; checked above).
    const student = 'byId' in lookup
      ? await users.findOne({ _id: new ObjectId(lookup.byId), role: 'student' })
      : await users.findOne({ email: lookup.byEmail, role: 'student' });

    if (!student) {
      return res.status(404).json({
        error: 'Student not found. Please check the student ID or email address.'
      });
    }

    // Verify course exists
    const course = await courses.findOne({ _id: new ObjectId(courseId) });

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

    // A manual issue by staff. The recorded figures count only the course's current lessons, so
    // lessons deleted since cannot inflate them (lib/course-progress.js).
    const currentLessonIds = await currentLessonIdsFor(db, courseIdStr);
    const totalLessons = currentLessonIds.length;
    const userProgress = await progress.findOne({ userId, courseId: courseIdStr });
    const completedLessons = currentCompletedIds(userProgress?.completedLessons, currentLessonIds).length;
    const progressPercent = progressPercentOf(userProgress?.completedLessons, currentLessonIds);
    const completion = courseCompletion({ enrollment: userProgress, currentLessonIds });
    const issue = decideStaffCertificateIssue({ completion, reason });
    if (!issue.ok) {
      return res.status(issue.status).json({ error: issue.error, code: issue.code });
    }

    // Generate certificate
    const certificate = {
      userId,
      courseId: courseIdStr,
      certificateId: `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      issuedAt: new Date(),
      progress: progressPercent,
      completedLessons,
      totalLessons,
      issuedBy: req.user!.email,
      issuedByRole: req.user!.role,
      enrollmentActive: isActiveEnrollment(userProgress),
      completionBasis: issue.completionBasis,
      completionVerified: issue.completionVerified,
      ...(reason ? { issueReason: reason } : {}),
      createdAt: new Date(),
    };

    let result;
    try {
      result = await certificates.insertOne(certificate);
    } catch (insertError) {
      // A parallel request issued it first (unique { userId, courseId } index).
      if (isDuplicateKey(insertError)) {
        return res.status(400).json({ error: 'Certificate already issued to this student for this course' });
      }
      throw insertError;
    }
    try {
      await db.collection(AUDIT_COLLECTION).insertOne({
        entityType: 'certificate',
        entityId: result.insertedId.toString(),
        reference: certificate.certificateId,
        action: 'certificate_issued_by_staff',
        reason,
        before: null,
        after: { userId, courseId: courseIdStr, completionBasis: issue.completionBasis, completionVerified: issue.completionVerified },
        actor: { userId: String(req.user!.userId), email: typeof req.user!.email === 'string' ? req.user!.email : null },
        createdAt: certificate.createdAt,
      });
    } catch {
      console.error(JSON.stringify({ event: 'staffCertificate', certificateId: certificate.certificateId, result: 'audit_write_failed' }));
    }

    // Note: Socket.io event emission for real-time updates would be handled by the socket server
    // The certificates page already listens for 'certificateIssued' events
    // Students will see the certificate when they refresh or when the page refetches

    // Optional: Send email notification
    // Note: Certificate email could use Resend (see lib/email.ts) when implemented
    // This is a placeholder for future email integration
    if (sendEmail) {
      // TODO: Implement email sending (e.g. Resend)
      // Example:
      // await sendCertificateEmail(student.email, {
      //   studentName: student.name,
      //   courseTitle: course.title,
      //   certificateId: certificate.certificateId,
      // });
      console.log(JSON.stringify({ event: 'staffCertificate', certificateId: certificate.certificateId, email: 'not_sent_not_implemented' }));
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
    console.error('Send certificate error:');
    res.status(500).json(unexpectedBody('api', error));
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

