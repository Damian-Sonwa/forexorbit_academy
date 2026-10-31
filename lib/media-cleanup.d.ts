import type { Db } from 'mongodb';

type Env = { [key: string]: string | undefined };

export const CLEANUP_FOLDERS: readonly string[];
export const LESSON_TEXT_FIELDS: readonly string[];
export const REFERENCE_FIELDS: { readonly [collection: string]: readonly string[] };
export function cleanupMode(env?: Env): 'delete' | 'report';
export function courseAssetIds(text: unknown, env?: Env): string[];
export function assetsInDocuments(documents: Array<{ [key: string]: any }> | null | undefined, fields?: readonly string[], env?: Env): string[];
export function removedAssets(before: { [key: string]: any } | null | undefined, after: { [key: string]: any } | null | undefined, fields?: readonly string[], env?: Env): string[];
export function isAssetReferenced(db: Pick<Db, 'collection'>, publicId: string): Promise<boolean>;
export function cleanupUnreferencedAssets(
  db: Pick<Db, 'collection'>,
  publicIds: string[],
  options?: { destroy?: (publicId: string) => Promise<unknown>; env?: Env; context?: { [key: string]: unknown } }
): Promise<{ mode: 'delete' | 'report'; deleted: string[]; kept: string[]; failed: string[]; candidates: string[] }>;
