import type { Collection, Document, WithId } from 'mongodb';

/**
 * Find user by phoneE164 or legacy `phone` string (various formats). Backfills phoneE164 when missing.
 */
export async function findUserByPhoneInput(
  users: Collection<Document>,
  phoneE164: string,
  rawInput: string
): Promise<WithId<Document> | null> {
  let user = await users.findOne({ phoneE164 });
  if (user) return user;

  const trimmed = rawInput.trim();
  const noPlus = phoneE164.replace(/^\+/, '');
  const candidates = [...new Set([trimmed, trimmed.replace(/\s/g, ''), phoneE164, noPlus])];

  for (const p of candidates) {
    if (!p) continue;
    user = await users.findOne({ phone: p });
    if (user) break;
  }

  if (user && !user.phoneE164) {
    await users.updateOne(
      { _id: user._id },
      { $set: { phoneE164, updatedAt: new Date() } }
    );
    return { ...user, phoneE164 } as WithId<Document>;
  }

  return user;
}
