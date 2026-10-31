import type { Db } from 'mongodb';

export type IndexDefinition = { id: string; collection: string; key: Record<string, number>; options: Record<string, unknown> & { name: string } };
export type IndexState = { id: string; name: string; state: 'present' | 'missing' | 'conflicting' | 'unknown' };
export const REFUND_INDEXES: readonly IndexDefinition[];
export function compareRefundIndex(definition: IndexDefinition, existing: Record<string, unknown>[]): 'present' | 'missing' | 'conflicting';
export function refundIndexReport(db: Db): Promise<IndexState[]>;
export function ensureRefundIndexes(db: Db, options?: { apply?: boolean; log?: (line: string) => void }): Promise<{ ok: boolean; built: string[]; states: IndexState[] }>;
