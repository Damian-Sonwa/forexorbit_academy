/** Types for lib/communication/deliver.js. */
import type { Db } from 'mongodb';

export function deliverToRecipients(db: Db, params: Record<string, unknown>, recipientIds: string[], options?: { io?: unknown; now?: Date }): Promise<Array<{ id: string; userId: string; created: boolean }>>;
