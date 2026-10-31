import type { Db } from 'mongodb';
import type { IndexDefinition, IndexState } from './refund-indexes';

export type EnrollmentDuplicates = { exactGroups: number; crossTypeGroups: number };
export const ENROLLMENT_COLLECTION: 'progress';
export const ENROLLMENT_INDEXES: readonly IndexDefinition[];
export function compareEnrollmentIndex(definition: IndexDefinition, existing: Record<string, unknown>[]): 'present' | 'missing' | 'conflicting';
export function enrollmentIndexReport(db: Db): Promise<IndexState[]>;
export function enrollmentDuplicateReport(db: Db): Promise<EnrollmentDuplicates>;
export function ensureEnrollmentIndexes(db: Db, options?: { apply?: boolean; log?: (line: string) => void }): Promise<{ ok: boolean; built: string[]; states: IndexState[]; duplicates: EnrollmentDuplicates | null }>;
