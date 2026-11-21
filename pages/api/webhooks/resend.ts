/**
 * POST: Resend delivery events (Phase 14). No session: the request must carry a valid Svix
 * signature over the raw body made with RESEND_WEBHOOK_SECRET, and a timestamp within five
 * minutes. Each event id is applied once (duplicates answer 200 without changing anything).
 * Delivered, bounced, complained and failed update the notification's email state; hard bounces
 * and complaints suppress the address. Answers carry no internal details.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { verify } from '@/lib/communication/resend-webhook';
import { applyProviderEvent } from '@/lib/communication/delivery';

export const config = { api: { bodyParser: false } };
const MAX_BYTES = 256 * 1024;

async function rawBody(req: NextApiRequest): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BYTES) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = await rawBody(req);
    if (body === null) return res.status(413).json({ error: 'Too large' });
    const checked = verify(body, req.headers as Record<string, string | string[] | undefined>, process.env.RESEND_WEBHOOK_SECRET || '');
    if (!checked.ok) {
      console.warn(JSON.stringify({ event: 'resendWebhook', result: 'refused', status: checked.status }));
      return res.status(checked.status).json({ error: 'Refused' });
    }
    const result = await applyProviderEvent(await getDb(), checked.event);
    console.log(JSON.stringify({ event: 'resendWebhook', type: checked.event.type, matched: result.matched, duplicate: result.duplicate }));
    return res.status(200).json({ received: true });
  } catch {
    console.error(JSON.stringify({ event: 'resendWebhook', result: 'failed' }));
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
