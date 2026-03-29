/**
 * Server-side Paystack transaction verification (secret key never exposed to client).
 */

export type PaystackVerifyData = {
  status: string;
  reference?: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown> | null;
  customer?: { email?: string };
};

export type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data?: PaystackVerifyData;
};

export async function paystackVerifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }
  const url = `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
    },
  });
  const json = (await res.json()) as PaystackVerifyResponse;
  return json;
}
