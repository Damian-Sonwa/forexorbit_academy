/**
 * Demo Trading Account API Route
 * GET: Get student's demo account
 * POST: Create demo account for student
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { BrokerFactory } from '@/lib/brokers/broker-factory';

async function getAccount(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access their demo account
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can access demo accounts' });
    }

    const db = await getDb();
    const accounts = db.collection('demoAccounts');

    // Find student's demo account
    const account = await accounts.findOne({ studentId: req.user!.userId });

    if (!account) {
      return res.status(404).json({ error: 'Demo account not found. Please create one first.' });
    }

    // Get latest account info from broker
    try {
      const broker = BrokerFactory.createBroker(
        BrokerFactory.getConfiguredBrokerType(),
        account.brokerAccountId
      );
      const brokerAccount = await broker.getAccount(account.brokerAccountId);

      // Update account in database
      await accounts.updateOne(
        { _id: account._id },
        {
          $set: {
            balance: brokerAccount.balance,
            marginAvailable: brokerAccount.marginAvailable,
            marginUsed: brokerAccount.marginUsed,
            openTrades: brokerAccount.openTrades,
            updatedAt: new Date(),
          },
        }
      );

      return res.json({
        ...account,
        _id: account._id.toString(),
        balance: brokerAccount.balance,
        marginAvailable: brokerAccount.marginAvailable,
        marginUsed: brokerAccount.marginUsed,
        openTrades: brokerAccount.openTrades,
      });
    } catch (brokerError: any) {
      // If broker API fails, return cached account data
      console.error('Broker API error:', brokerError);
      return res.json({
        ...account,
        _id: account._id.toString(),
      });
    }
  } catch (error: any) {
    console.error('Get account error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function createAccount(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can create demo accounts
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can create demo accounts' });
    }

    const { initialBalance } = req.body;
    const balance = initialBalance || 10000; // Default $10,000 demo balance

    // CRITICAL: Validate this is always demo mode
    if (process.env.BROKER_DEMO_MODE !== 'true' && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Demo account creation is disabled' });
    }

    const db = await getDb();
    const accounts = db.collection('demoAccounts');
    const users = db.collection('users');

    // Check if account already exists
    const existingAccount = await accounts.findOne({ studentId: req.user!.userId });
    if (existingAccount) {
      return res.status(400).json({ error: 'Demo account already exists' });
    }

    // Get user info
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, name: 1 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create broker account
    const broker = BrokerFactory.createBroker(BrokerFactory.getConfiguredBrokerType());
    const brokerAccount = await broker.createDemoAccount(
      req.user!.userId,
      user.email || '',
      balance
    );

    // Save account to database
    const account = {
      studentId: req.user!.userId,
      brokerAccountId: brokerAccount.accountId,
      brokerType: BrokerFactory.getConfiguredBrokerType(),
      accountName: brokerAccount.accountName,
      balance: brokerAccount.balance,
      currency: brokerAccount.currency || 'USD',
      marginAvailable: brokerAccount.marginAvailable || balance,
      marginUsed: brokerAccount.marginUsed || 0,
      openTrades: brokerAccount.openTrades || 0,
      isDemo: true, // CRITICAL: Always true
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await accounts.insertOne(account);

    res.status(201).json({
      _id: result.insertedId.toString(),
      ...account,
    });
  } catch (error: any) {
    console.error('Create account error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create demo account. Please ensure broker API is configured correctly.' 
    });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getAccount(req, res);
  } else if (req.method === 'POST') {
    return createAccount(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}, ['student']);

