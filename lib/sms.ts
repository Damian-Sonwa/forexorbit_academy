export type SmsProvider = 'twilio' | 'termii';

export function getSmsProvider(): SmsProvider {
  const p = (process.env.SMS_PROVIDER || 'twilio').toLowerCase();
  return p === 'termii' ? 'termii' : 'twilio';
}

export function isSmsConfigured(): boolean {
  if (getSmsProvider() === 'twilio') {
    return !!(
      process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_PHONE_NUMBER?.trim()
    );
  }
  return !!process.env.TERMII_API_KEY?.trim();
}

async function sendViaTwilio(toE164: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const from = process.env.TWILIO_PHONE_NUMBER!.trim();
  // Dynamic import avoids some Next.js/webpack edge cases with twilio’s CJS bundle.
  const twilioMod = await import('twilio');
  const twilioFn = twilioMod.default ?? twilioMod;
  const client = (twilioFn as (sid: string, token: string) => ReturnType<typeof import('twilio')>)(
    sid,
    token
  );
  await client.messages.create({ from, to: toE164, body });
}

async function sendViaTermii(toE164: string, body: string): Promise<void> {
  const apiKey = process.env.TERMII_API_KEY!.trim();
  const senderId = (process.env.TERMII_SENDER_ID || 'ForexOrbit').trim();
  const to = toE164.replace(/^\+/, '');
  const res = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      to,
      from: senderId,
      sms: body,
      type: 'plain',
      channel: 'generic',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  };
  if (!res.ok) {
    throw new Error(data.message || `Termii HTTP ${res.status}`);
  }
  if (data.code && data.code !== 'ok') {
    throw new Error(data.message || `Termii: ${data.code}`);
  }
}

export async function sendPasswordResetOtpSms(toE164: string, otp: string): Promise<void> {
  const body = `ForexOrbit Academy: your password reset code is ${otp}. It expires in 5 minutes. Do not share this code.`;
  if (getSmsProvider() === 'termii') {
    await sendViaTermii(toE164, body);
    return;
  }
  await sendViaTwilio(toE164, body);
}
