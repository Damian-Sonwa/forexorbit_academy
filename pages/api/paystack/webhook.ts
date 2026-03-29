/**
 * POST /api/paystack/webhook
 * Paystack webhook — verify HMAC signature, handle charge.success, unlock course.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getDb } from '@/lib/mongodb';
import { isPaystackConfigured } from '@/lib/lesson-monetization';
import { unlockCourseFromWebhookPayload } from '@/lib/paystack-course-unlock';
import type { PaystackVerifyData } from '@/lib/paystack-server';

export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || !isPaystackConfigured()) {
    console.error('[paystack-webhook] secret not configured');
    return res.status(503).json({ message: 'Webhook not configured' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    console.error('[paystack-webhook] read body failed', e);
    return res.status(400).json({ message: 'Invalid body' });
  }

  const signature = (req.headers['x-paystack-signature'] as string) || '';
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

  if (!signature || hash !== signature) {
    console.error('[paystack-webhook] INVALID signature', { hasSig: Boolean(signature) });
    return res.status(400).json({ message: 'Invalid signature' });
  }

  let payload: { event?: string; data?: PaystackVerifyData };
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as { event?: string; data?: PaystackVerifyData };
  } catch {
    console.error('[paystack-webhook] invalid JSON');
    return res.status(400).json({ message: 'Invalid JSON' });
  }

  console.log('[paystack-webhook] event', payload.event);

  if (payload.event !== 'charge.success') {
    return res.status(200).json({ received: true });
  }

  const data = payload.data;
  if (!data || typeof data !== 'object') {
    return res.status(200).json({ received: true });
  }

  try {
    const db = await getDb();
    const result = await unlockCourseFromWebhookPayload(db, data);
    if (!result.ok) {
      console.warn('[paystack-webhook] unlock skipped or failed', result.message);
    } else {
      console.log('[paystack-webhook] unlock ok', { reference: data.reference });
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[paystack-webhook] handler error', e);
    return res.status(500).json({ message: 'Processing error' });
  }
}
