/**
 * ForexOrbit Academy account emails: password reset link and password changed notice.
 * Every value placed in HTML is escaped. Both emails have a plain-text version.
 */

const BRAND = 'ForexOrbit Academy';
const ACCENT = '#B85C0E';

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function greetingName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 80) : '';
  return trimmed || 'there';
}

/** Shared layout: a centered card, readable without images, styles inline for mail clients. */
function layout({ preheader, heading, body }: { preheader: string; heading: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;">
<tr><td style="padding:24px 32px;border-bottom:3px solid ${ACCENT};font-size:18px;font-weight:bold;color:#1c1917;">${BRAND}</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c1917;">${escapeHtml(heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.5;color:#78716c;">
This is an automated message from ${BRAND} about your account. Please do not reply to this email.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const paragraph = (html: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#44403c;">${html}</p>`;

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${ACCENT};">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

export function passwordResetEmail({
  name,
  resetUrl,
  expiresInMinutes,
}: {
  name: unknown;
  resetUrl: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const who = greetingName(name);
  const subject = `Reset your ${BRAND} password`;
  const html = layout({
    preheader: `Use this link within ${expiresInMinutes} minutes to choose a new password.`,
    heading: 'Reset your password',
    body: [
      paragraph(`Hello ${escapeHtml(who)},`),
      paragraph(`We received a request to reset the password for your ${BRAND} account. Use the button below to choose a new password.`),
      button(resetUrl, 'Reset password'),
      paragraph(`<strong>This link expires in ${expiresInMinutes} minutes</strong> and can be used once. Requesting another link replaces this one.`),
      paragraph(`If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#57534e;">${escapeHtml(resetUrl)}</span>`),
      paragraph('If you did not ask to reset your password, you can ignore this email. Your password will not change.'),
    ].join('\n'),
  });
  const text = [
    `Reset your ${BRAND} password`,
    '',
    `Hello ${who},`,
    '',
    `We received a request to reset the password for your ${BRAND} account.`,
    'Open this link to choose a new password:',
    '',
    resetUrl,
    '',
    `This link expires in ${expiresInMinutes} minutes and can be used once. Requesting another link replaces this one.`,
    '',
    'If you did not ask to reset your password, you can ignore this email. Your password will not change.',
  ].join('\n');
  return { subject, html, text };
}

export function passwordChangedEmail({ name, forgotPasswordUrl }: { name: unknown; forgotPasswordUrl: string }): RenderedEmail {
  const who = greetingName(name);
  const subject = `Your ${BRAND} password was changed`;
  const html = layout({
    preheader: 'Your password was just changed. You have been signed out on every device.',
    heading: 'Your password was changed',
    body: [
      paragraph(`Hello ${escapeHtml(who)},`),
      paragraph(`The password for your ${BRAND} account was just changed using a reset link. For your security, you have been signed out on every device. Sign in again with your new password.`),
      paragraph('<strong>If you did not make this change</strong>, reset your password now and contact our support team.'),
      button(forgotPasswordUrl, 'Reset my password'),
    ].join('\n'),
  });
  const text = [
    `Your ${BRAND} password was changed`,
    '',
    `Hello ${who},`,
    '',
    `The password for your ${BRAND} account was just changed using a reset link.`,
    'For your security, you have been signed out on every device. Sign in again with your new password.',
    '',
    'If you did not make this change, reset your password now and contact our support team:',
    forgotPasswordUrl,
  ].join('\n');
  return { subject, html, text };
}
