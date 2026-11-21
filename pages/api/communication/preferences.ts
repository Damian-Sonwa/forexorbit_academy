/**
 * Communication preferences (Phase 14), for the signed-in member only.
 * GET  effective preferences per channel and category, with labels and which are essential.
 * PUT  { inApp?, email?, push? } maps of category -> boolean. Essential categories cannot be
 *      turned off. Takes effect for the next delivery (checked again at send time).
 */
import { ObjectId } from 'mongodb';
import { communicationRoute, bodyOf } from '@/lib/communication-route';
import { CATEGORIES, effectivePreferences, readPreferencesUpdate } from '@/lib/communication/preferences';

export default communicationRoute('communicationPreferences', {
  GET: {
    handler: async (_req, db, member) => {
      const user = await db.collection('users').findOne({ _id: new ObjectId(member.userId) }, { projection: { communicationPreferences: 1, emailSuppression: 1 } });
      return {
        ok: true,
        preferences: effectivePreferences(user && user.communicationPreferences),
        categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c })),
        emailSuppressed: Boolean(user && user.emailSuppression && user.emailSuppression.at),
      };
    },
  },
  PUT: {
    handler: async (req, db, member) => {
      const checked = readPreferencesUpdate(bodyOf(req));
      if (!checked.ok) return checked;
      const set: Record<string, boolean> = {};
      for (const [channel, values] of Object.entries(checked.update as Record<string, Record<string, boolean>>)) {
        for (const [category, value] of Object.entries(values)) set[`communicationPreferences.${channel}.${category}`] = value;
      }
      if (Object.keys(set).length) await db.collection('users').updateOne({ _id: new ObjectId(member.userId) }, { $set: { ...set, 'communicationPreferences.updatedAt': new Date() } });
      const user = await db.collection('users').findOne({ _id: new ObjectId(member.userId) }, { projection: { communicationPreferences: 1 } });
      return { ok: true, preferences: effectivePreferences(user && user.communicationPreferences) };
    },
  },
});
