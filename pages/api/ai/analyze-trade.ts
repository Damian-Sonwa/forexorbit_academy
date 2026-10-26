/**
 * AI API: Analyze Trade
 * Provides AI-powered feedback for demo trades
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { analyzeTrade, isAIConfigured } from '@/lib/ai';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI service is not configured' });
  }

  try {
    const { pair, direction, entryPrice, stopLoss, takeProfit, lotSize, notes } = req.body;

    if (!pair || !direction || !entryPrice || !stopLoss || !takeProfit || !lotSize) {
      return res.status(400).json({
        error: 'pair, direction, entryPrice, stopLoss, takeProfit, and lotSize are required',
      });
    }

    const analysis = await analyzeTrade(
      {
        pair,
        direction,
        entryPrice: parseFloat(entryPrice),
        stopLoss: parseFloat(stopLoss),
        takeProfit: parseFloat(takeProfit),
        lotSize: parseFloat(lotSize),
        notes,
      },
      req.user!.userId
    );

    res.json({ analysis });
  } catch (error: unknown) {
    console.error('AI analyze trade error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to analyze trade';
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(handler, ['student', 'instructor', 'admin', 'superadmin']);

