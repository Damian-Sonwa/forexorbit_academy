/**
 * POST /api/paystack/webhook
 * Paystack webhook — raw JSON body.
 * - Development: signature check skipped (local/ngrok testing).
 * - Production: HMAC-SHA512 of raw body vs x-paystack-signature using PAYSTACK_SECRET_KEY.
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

function verifyPaystackSignature(rawBody: Buffer, secret: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  if (hash.length !== signatureHeader.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'utf8'), Buffer.from(signatureHeader, 'utf8'));
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const isProduction = process.env.NODE_ENV === 'production';

  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    console.error('[paystack-webhook] read body failed', e);
    return res.status(400).json({ message: 'Invalid body' });
  }

  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();

  if (isProduction) {
    if (!secret || !isPaystackConfigured()) {
      console.error('[paystack-webhook] PAYSTACK_SECRET_KEY not configured in production');
      return res.status(503).json({ message: 'Webhook not configured' });
    }

    const signature = req.headers['x-paystack-signature'] as string | undefined;
    if (!verifyPaystackSignature(rawBody, secret, signature)) {
      console.error('[paystack-webhook] Invalid signature — unauthorized');
      return res.status(401).json({ message: 'Unauthorized' });
    }
  } else {
    console.warn(
      '[paystack-webhook] DEV: Paystack signature verification skipped (NODE_ENV !== production). Do not use in production.'
    );
    if (!secret) {
      console.warn('[paystack-webhook] DEV: PAYSTACK_SECRET_KEY missing — unlock still runs if payload is valid');
    }
  }

  let payload: { event?: string; data?: PaystackVerifyData & { customer?: { email?: string }; metadata?: Record<string, unknown> } };
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as typeof payload;
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

  const reference = data.reference;
  const customer = data.customer as { email?: string } | undefined;
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  const email = customer?.email;
  const courseId = metadata?.courseId != null ? String(metadata.courseId) : undefined;
  console.log('[paystack-webhook] charge.success', { reference, email, courseId });

  try {
    const db = await getDb();
    const result = await unlockCourseFromWebhookPayload(db, data as PaystackVerifyData);
    if (!result.ok) {
      console.warn('[paystack-webhook] unlock skipped or failed', result.message);
    } else {
      console.log('[paystack-webhook] course unlock processed', { reference: data.reference });
    }
    return res.status(200).json({ received: true });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('[paystack-webhook] handler error', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
