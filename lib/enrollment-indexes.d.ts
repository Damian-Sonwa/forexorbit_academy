import type { Db } from 'mongodb';
import type { IndexDefinition, IndexState } from './refund-indexes';

export type EnrollmentDuplicates = { exactGroups: number; crossTypeGroups: number };
export type EnrollmentIndexState = IndexState & { reason?: string };
export const ENROLLMENT_COLLECTION: 'progress';
export const ENROLLMENT_INDEXES: readonly IndexDefinition[];
export function compareEnrollmentIndex(definition: IndexDefinition, existing: Record<string, unknown>[]): 'present' | 'missing' | 'conflicting';
export function enrollmentIndexReport(db: Db): Promise<EnrollmentIndexState[]>;
export function enrollmentDuplicateReport(db: Db): Promise<EnrollmentDuplicates>;
export function ensureEnrollmentIndexes(db: Db, options?: { apply?: boolean; log?: (line: string) => void }): Promise<{ ok: boolean; built: string[]; states: EnrollmentIndexState[]; duplicates: EnrollmentDuplicates | null }>;
