import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

export function getDefaultPhoneRegion(): CountryCode {
  const fromPublic = process.env.NEXT_PUBLIC_PHONE_DEFAULT_REGION?.trim();
  const fromSms = process.env.SMS_DEFAULT_REGION?.trim();
  const r = (fromPublic || fromSms || 'NG').toUpperCase();
  return (r.length === 2 ? r : 'NG') as CountryCode;
}

/** Parse user input to E.164 (e.g. +2348012345678). Returns null if invalid. */
export function parseToE164(input: string): { e164: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw, getDefaultPhoneRegion());
  if (!parsed?.isValid()) return null;
  return { e164: parsed.number };
}

export function maskPhoneTail(e164: string): string {
  const d = e164.replace(/\D/g, '');
  if (d.length < 4) return '****';
  return `••••${d.slice(-4)}`;
}
