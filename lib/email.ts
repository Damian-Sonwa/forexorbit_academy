/**
 * Email utility — password reset via [Resend](https://resend.com).
 * Set RESEND_API_KEY. Optional: RESEND_FROM (default onboarding@resend.dev for testing).
 *
 * Do not import from client code — API keys. (Pages Router: only use from pages/api.)
 */

import { Resend } from 'resend';

const DEFAULT_RESEND_FROM = 'onboarding@resend.dev';

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key?.trim()) {
    return null;
  }
  return new Resend(key);
}

function getFromAddress(): string {
  return (process.env.RESEND_FROM || DEFAULT_RESEND_FROM).trim();
}

/**
 * Send password reset email (HTML + plain text).
 */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  resetUrl: string
): Promise<void> {
  const resend = getResend();

  if (!resend) {
    console.warn('❌ RESEND_API_KEY not set. Email sending disabled; logging reset URL.');
    console.log('Password reset URL for', email, ':', resetUrl);
    return;
  }

  const from = getFromAddress();
  const safeName = name?.trim() || 'there';

  const html = `
      <h2>Password Reset</h2>
      <p>Hello ${escapeHtml(safeName)},</p>
      <p>You requested to reset your password for your ForexOrbit Academy account.</p>
      <p><strong>This link expires in 1 hour.</strong></p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(resetUrl)}" style="
      background:#197278;
      color:white;
      padding:10px 15px;
      text-decoration:none;
      border-radius:5px;
      display:inline-block;
    ">
      Reset Password
    </a>
      </p>
      <p style="word-break:break-all;font-size:14px;color:#444;">Or copy this link:<br/>${escapeHtml(resetUrl)}</p>
      <p style="font-size:13px;color:#666;">If you did not request this, you can ignore this email.</p>
  `;

  const text = [
    'Password Reset — ForexOrbit Academy',
    '',
    `Hello ${safeName},`,
    '',
    'You requested to reset your password.',
    'This link expires in 1 hour.',
    '',
    resetUrl,
    '',
    'If you did not request this, ignore this email.',
  ].join('\n');

  try {
    console.log('Sending password reset email via Resend:', { from, to: email });

    const { data, error } = await resend.emails.send({
      from,
      to: email,
      subject: 'Password Reset Request',
      html,
      text,
    });

    if (error) {
      console.error('❌ Resend API error:', error);
      throw new Error(error.message || 'Resend send failed');
    }

    console.log('✅ Password reset email sent:', { id: data?.id, to: email });
  } catch (err: unknown) {
    console.error('❌ Error sending password reset email:', err);
    console.log('Password reset URL for', email, ':', resetUrl);
    throw err;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * True when Resend can send mail (API key present).
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}
