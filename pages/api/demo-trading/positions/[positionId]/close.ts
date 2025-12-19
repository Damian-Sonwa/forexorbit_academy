/**
 * Close Position API Route
 * POST: Close an open position
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { BrokerFactory } from '@/lib/brokers/broker-factory';

async function closePosition(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can close positions
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can close positions' });
    }

    const { positionId } = req.query;

    if (!positionId || typeof positionId !== 'string') {
      return res.status(400).json({ error: 'Position ID is required' });
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

    // Close position
    const closeOrder = await broker.closePosition(account.brokerAccountId, positionId);

    // Update account balance
    const updatedAccount = await broker.getAccount(account.brokerAccountId);
    await accounts.updateOne(
      { _id: account._id },
      {
        $set: {
          balance: updatedAccount.balance,
          marginAvailable: updatedAccount.marginAvailable,
          marginUsed: updatedAccount.marginUsed,
          openTrades: updatedAccount.openTrades,
          updatedAt: new Date(),
        },
      }
    );

    res.json(closeOrder);
  } catch (error: any) {
    console.error('Close position error:', error);
    res.status(500).json({ error: error.message || 'Failed to close position' });
  }
}

export default withAuth(closePosition, ['student']);

