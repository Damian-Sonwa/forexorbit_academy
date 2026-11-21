import type { Db } from 'mongodb';

export function runTick(db: Db, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
