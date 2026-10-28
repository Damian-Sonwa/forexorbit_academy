/**
 * POST /api/paystack/webhook
 * Every request must carry a valid x-paystack-signature (HMAC-SHA512 of the raw body with
 * PAYSTACK_SECRET_KEY). There is no bypass in any environment.
 *
 * Responds 200 only after the event is processed or durably recorded for review; otherwise
 * 500 so Paystack retries.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { decidePaymentEnvironment, processWebhookEvent, verifyWebhookSignature } from '@/lib/course-payment';
import { logPayment, newSupportId } from '@/lib/payment-route';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES = 256 * 1024;

function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const supportId = newSupportId();
  const environment = decidePaymentEnvironment(process.env);
  if (!environment.enabled) {
    logPayment('webhook', { supportId, code: environment.reason });
    return res.status(503).json({ message: 'Webhook not configured' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req);
  } catch {
    logPayment('webhook', { supportId, code: 'invalid_body' });
    return res.status(400).json({ message: 'Invalid body' });
  }

  const signature = req.headers['x-paystack-signature'];
  if (!verifyWebhookSignature(rawBody, process.env.PAYSTACK_SECRET_KEY?.trim(), typeof signature === 'string' ? signature : undefined)) {
    logPayment('webhook', { supportId, code: 'invalid_signature' });
    return res.status(401).json({ message: 'Unauthorized' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logPayment('webhook', { supportId, code: 'invalid_json' });
    return res.status(400).json({ message: 'Invalid JSON' });
  }

  const event = (payload as { event?: unknown })?.event;
  const reference = (payload as { data?: { reference?: unknown } })?.data?.reference;
  try {
    const db = await getDb();
    const outcome = await processWebhookEvent(db, payload);
    logPayment('webhook', {
      supportId,
      event: typeof event === 'string' ? event : null,
      reference: typeof reference === 'string' ? reference.slice(0, 100) : null,
      code: outcome.code,
    });
    if (!outcome.ack) {
      return res.status(500).json({ message: 'Processing incomplete', supportId });
    }
    return res.status(200).json({ received: true });
  } catch {
    logPayment('webhook', {
      supportId,
      event: typeof event === 'string' ? event : null,
      reference: typeof reference === 'string' ? reference.slice(0, 100) : null,
      code: 'processing_failed',
    });
    return res.status(500).json({ message: 'Processing failed', supportId });
  }
}
