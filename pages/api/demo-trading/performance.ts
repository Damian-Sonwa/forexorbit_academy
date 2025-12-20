/**
 * Performance Metrics API Route
 * GET: Get student's trading performance metrics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { BrokerFactory } from '@/lib/brokers/broker-factory';
import { PerformanceMetricsCalculator } from '@/lib/performance-metrics';

async function getPerformance(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access their performance
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can access performance metrics' });
    }

    const db = await getDb();
    const accounts = db.collection('demoAccounts');

    // Get student's demo account
    const account = await accounts.findOne({ studentId: req.user!.userId });
    if (!account) {
      return res.status(404).json({ error: 'Demo account not found' });
    }

    // CRITICAL: Verify this is a demo account
    if (!account.isDemo) {
      return res.status(403).json({ error: 'Only demo accounts are allowed' });
    }

    const broker = BrokerFactory.createBroker(
      account.brokerType || BrokerFactory.getConfiguredBrokerType(),
      account.brokerAccountId
    );

    // Get order history
    const orderHistory = await broker.getOrderHistory(account.brokerAccountId, 1000);

    // Calculate performance metrics
    const metrics = PerformanceMetricsCalculator.calculate(orderHistory);

    res.json(metrics);
  } catch (error: any) {
    console.error('Get performance error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(getPerformance, ['student']);


