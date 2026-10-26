/**
 * Demo Trading Trades API Route
 * GET: Get open positions and order history
 * POST: Place a new order
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { BrokerFactory } from '@/lib/brokers/broker-factory';

async function getTrades(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access their trades
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can access trades' });
    }

    const db = await getDb();
    const accounts = db.collection('demoAccounts');

    // Get student's demo account
    const account = await accounts.findOne({ studentId: req.user!.userId });
    if (!account) {
      return res.status(404).json({ error: 'Demo account not found. Please create one first.' });
    }

    // CRITICAL: Verify this is a demo account
    if (!account.isDemo) {
      return res.status(403).json({ error: 'Only demo accounts are allowed' });
    }

    const broker = BrokerFactory.createBroker(
      account.brokerType || BrokerFactory.getConfiguredBrokerType(),
      account.brokerAccountId
    );

    // Get open positions and order history
    const [openPositions, orderHistory] = await Promise.all([
      broker.getOpenPositions(account.brokerAccountId).catch(() => []),
      broker.getOrderHistory(account.brokerAccountId, 100).catch(() => []),
    ]);

    res.json({
      openPositions,
      orderHistory,
    });
  } catch (error: any) {
    console.error('Get trades error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function placeOrder(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can place orders
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can place orders' });
    }

    const { orderType, instrument, units, side, price, stopLoss, takeProfit } = req.body;

    // Validation
    if (!orderType || !instrument || !units || !side) {
      return res.status(400).json({ error: 'Missing required fields: orderType, instrument, units, side' });
    }

    if (!['market', 'limit', 'stop'].includes(orderType)) {
      return res.status(400).json({ error: 'Invalid order type. Must be market, limit, or stop' });
    }

    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side. Must be buy or sell' });
    }

    if (orderType !== 'market' && !price) {
      return res.status(400).json({ error: 'Price is required for limit and stop orders' });
    }

    const db = await getDb();
    const accounts = db.collection('demoAccounts');
    const trades = db.collection('demoTrades');

    // Get student's demo account
    const account = await accounts.findOne({ studentId: req.user!.userId });
    if (!account) {
      return res.status(404).json({ error: 'Demo account not found. Please create one first.' });
    }

    // CRITICAL: Verify this is a demo account
    if (!account.isDemo) {
      return res.status(403).json({ error: 'Only demo accounts are allowed' });
    }

    const broker = BrokerFactory.createBroker(
      account.brokerType || BrokerFactory.getConfiguredBrokerType(),
      account.brokerAccountId
    );

    // Place order with broker
    let brokerOrder;
    if (orderType === 'market') {
      brokerOrder = await broker.placeMarketOrder(
        account.brokerAccountId,
        instrument,
        parseFloat(units),
        side,
        stopLoss ? parseFloat(stopLoss) : undefined,
        takeProfit ? parseFloat(takeProfit) : undefined
      );
    } else if (orderType === 'limit') {
      brokerOrder = await broker.placeLimitOrder(
        account.brokerAccountId,
        instrument,
        parseFloat(units),
        side,
        parseFloat(price),
        stopLoss ? parseFloat(stopLoss) : undefined,
        takeProfit ? parseFloat(takeProfit) : undefined
      );
    } else {
      brokerOrder = await broker.placeStopOrder(
        account.brokerAccountId,
        instrument,
        parseFloat(units),
        side,
        parseFloat(price),
        stopLoss ? parseFloat(stopLoss) : undefined,
        takeProfit ? parseFloat(takeProfit) : undefined
      );
    }

    // Save trade to database
    const trade = {
      studentId: req.user!.userId,
      accountId: account._id.toString(),
      brokerOrderId: brokerOrder.orderId,
      instrument: brokerOrder.instrument,
      units: brokerOrder.units,
      side: brokerOrder.side,
      orderType: brokerOrder.type,
      price: brokerOrder.price,
      stopLoss: brokerOrder.stopLoss,
      takeProfit: brokerOrder.takeProfit,
      status: brokerOrder.status,
      fillPrice: brokerOrder.fillPrice,
      createdAt: brokerOrder.createdAt,
      filledAt: brokerOrder.filledAt,
      isDemo: true, // CRITICAL: Always true
    };

    await trades.insertOne(trade);

    // Update account balance if order was filled
    if (brokerOrder.status === 'filled') {
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
    }

    res.status(201).json(brokerOrder);
  } catch (error: any) {
    console.error('Place order error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to place order. Please check your order parameters.' 
    });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getTrades(req, res);
  } else if (req.method === 'POST') {
    return placeOrder(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}, ['student']);


