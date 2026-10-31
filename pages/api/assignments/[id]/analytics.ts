import { unexpectedBody } from '@/lib/public-error';
/**
 * Assignment Analytics API Route
 * GET: Get analytics for a specific assignment (instructor/admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideAssignmentMutation, isStoredId } from '@/lib/account-access';
import { activeEnrollmentFilter } from '@/lib/enrollment-state';

async function getAssignmentAnalytics(req: AuthRequest, res: NextApiResponse) {
  try {
    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!isStoredId(id)) {
      return res.status(400).json({ error: 'Assignment ID is required' });
    }

    const db = await getDb();
    const assignments = db.collection('assignments');
    const submissions = db.collection('assignmentSubmissions');
    const users = db.collection('users');
    const courses = db.collection('courses');

    // Get assignment details
    const assignment = await assignments.findOne({ _id: new ObjectId(id) });
    if (!assignment || !isStoredId(String(assignment.courseId))) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const record = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const course = await courses.findOne(
      { _id: new ObjectId(String(assignment.courseId)) },
      { projection: { instructorId: 1, title: 1 } }
    );
    const decision = decideAssignmentMutation({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId, status: course.status } : null,
      assignment: { _id: assignment._id, courseId: assignment.courseId },
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    // Get all submissions for this assignment
    const allSubmissions = await submissions.find({ assignmentId: id }).toArray();

    // Get enrolled students count (approximate by checking progress collection)
    const progress = db.collection('progress');
    const enrolledStudents = await progress.distinct('userId', {
      courseId: assignment.courseId,
      ...activeEnrollmentFilter(),
    });

    // Calculate statistics
    const totalSubmissions = allSubmissions.length;
    const gradedSubmissions = allSubmissions.filter((s) => s.grade !== null && s.grade !== undefined).length;
    const pendingGrading = totalSubmissions - gradedSubmissions;
    const submissionRate = enrolledStudents.length > 0 ? (totalSubmissions / enrolledStudents.length) * 100 : 0;

    // Calculate average score
    const gradedScores = allSubmissions
      .filter((s) => s.grade !== null && s.grade !== undefined)
      .map((s) => parseFloat(s.grade));
    const averageScore = gradedScores.length > 0
      ? gradedScores.reduce((sum, score) => sum + score, 0) / gradedScores.length
      : 0;

    // Calculate score distribution
    const scoreRanges = {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      '0-59': 0,
    };

    gradedScores.forEach((score) => {
      if (score >= 90) scoreRanges['90-100']++;
      else if (score >= 80) scoreRanges['80-89']++;
      else if (score >= 70) scoreRanges['70-79']++;
      else if (score >= 60) scoreRanges['60-69']++;
      else scoreRanges['0-59']++;
    });

    // Get submission timeline (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const timelineData: { [key: string]: number } = {};
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      timelineData[dateKey] = 0;
    }

    allSubmissions.forEach((submission) => {
      if (submission.submittedAt) {
        const submissionDate = new Date(submission.submittedAt);
        if (submissionDate >= thirtyDaysAgo) {
          const dateKey = submissionDate.toISOString().split('T')[0];
          if (timelineData[dateKey] !== undefined) {
            timelineData[dateKey]++;
          }
        }
      }
    });

    const submissionTimeline = Object.entries(timelineData).map(([date, count]) => ({
      date,
      count,
    }));

    // Get student submissions with user details
    const studentSubmissions = await Promise.all(
      allSubmissions.map(async (submission) => {
        const user = await users.findOne(
          { _id: new ObjectId(submission.userId) },
          { projection: { name: 1, email: 1 } }
        );
        return {
          _id: submission._id.toString(),
          userId: submission.userId,
          studentName: user?.name || 'Unknown',
          studentEmail: user?.email || 'Unknown',
          grade: submission.grade || null,
          submittedAt: submission.submittedAt || null,
          status: submission.status || 'submitted',
          feedback: submission.feedback || null,
        };
      })
    );

    // Sort by grade (highest first), then by submission date
    studentSubmissions.sort((a, b) => {
      if (a.grade !== null && b.grade !== null) {
        return b.grade - a.grade;
      }
      if (a.grade !== null) return -1;
      if (b.grade !== null) return 1;
      return new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime();
    });

    res.json({
      assignment: {
        _id: assignment._id.toString(),
        title: assignment.title,
        description: assignment.description,
        courseId: assignment.courseId,
        courseName: course?.title || 'Unknown Course',
        dueDate: assignment.dueDate,
        points: assignment.points,
        createdAt: assignment.createdAt,
      },
      summary: {
        totalStudents: enrolledStudents.length,
        totalSubmissions,
        gradedSubmissions,
        pendingGrading,
        submissionRate: Math.round(submissionRate * 100) / 100,
        averageScore: Math.round(averageScore * 100) / 100,
        highestScore: gradedScores.length > 0 ? Math.max(...gradedScores) : null,
        lowestScore: gradedScores.length > 0 ? Math.min(...gradedScores) : null,
      },
      scoreDistribution: scoreRanges,
      submissionTimeline,
      studentSubmissions,
    });
  } catch {
    console.error(JSON.stringify({ event: 'assignmentAnalytics', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(getAssignmentAnalytics);








