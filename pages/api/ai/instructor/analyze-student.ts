/**
 * AI API: Analyze Student Performance
 * Provides AI-powered insights for instructors about student performance
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { analyzeStudentPerformance, isAIConfigured } from '@/lib/ai';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only instructors and admins can analyze student performance' });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI service is not configured' });
  }

  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: 'studentId is required' });
    }

    const db = await getDb();
    const users = db.collection('users');
    const journal = db.collection('demoTradeJournal');
    const submissions = db.collection('demoTaskSubmissions');
    const tasks = db.collection('demoTasks');

    // Get student data
    const student = await users.findOne(
      { _id: new ObjectId(studentId) },
      { projection: { name: 1, email: 1, learningLevel: 1, 'studentDetails.tradingLevel': 1 } }
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get student trades
    const trades = await journal.find({ studentId }).toArray();
    const totalTrades = trades.length;
    const closedTrades = trades.filter(t => t.result !== 'open');
    const winTrades = closedTrades.filter(t => t.result === 'win');
    const winRate = closedTrades.length > 0 ? winTrades.length / closedTrades.length : 0;
    const averageProfitLoss = closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0) / closedTrades.length
      : 0;

    // Get student submissions
    const studentSubmissions = await submissions.find({ studentId }).toArray();
    const completedTasks = studentSubmissions.filter(s => s.grade !== null && s.grade !== undefined).length;
    const pendingTasks = studentSubmissions.filter(s => s.grade === null || s.grade === undefined).length;
    
    const gradedSubmissions = studentSubmissions.filter(s => s.grade !== null && s.grade !== undefined);
    const averageGrade = gradedSubmissions.length > 0
      ? gradedSubmissions.reduce((sum, s) => sum + (typeof s.grade === 'number' ? s.grade : 0), 0) / gradedSubmissions.length
      : 0;

    // Get recent submissions with task titles
    const recentSubmissions = await Promise.all(
      studentSubmissions
        .slice(0, 5)
        .map(async (sub) => {
          if (sub.taskId) {
            const task = await tasks.findOne(
              { _id: new ObjectId(sub.taskId) },
              { projection: { title: 1 } }
            );
            return {
              taskTitle: task?.title || 'Unknown Task',
              grade: sub.grade,
              submittedAt: sub.submittedAt,
            };
          }
          return null;
        })
    );

    const studentData = {
      name: student.name || 'Unknown',
      email: student.email || '',
      level: student.learningLevel || student.studentDetails?.tradingLevel || 'beginner',
      totalTrades,
      winRate,
      averageProfitLoss,
      completedTasks,
      pendingTasks,
      averageGrade,
      recentSubmissions: recentSubmissions.filter(s => s !== null) as Array<{
        taskTitle: string;
        grade?: number;
        submittedAt: string;
      }>,
    };

    const analysis = await analyzeStudentPerformance(studentData, req.user!.userId);

    res.json({ analysis, studentData });
  } catch (error: unknown) {
    console.error('AI analyze student error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to analyze student performance';
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);

