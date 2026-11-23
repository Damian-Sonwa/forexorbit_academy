import type { Db } from 'mongodb';

export const COLLECTION: string;
export const MAX_STORED_BYTES: number;
export class ImageStoreError extends Error {
  code: 'BAD_TYPE' | 'EMPTY' | 'TOO_LARGE' | 'STORE_NOT_PERMITTED';
  constructor(code: string, message: string);
}
export function imagePath(id: string, mime: string): string;
export function isPermissionError(error: unknown): boolean;
export function storeImage(
  db: Pick<Db, 'collection'>,
  input: { bytes: Buffer; mime: string; ownerId?: string; folder?: string }
): Promise<{ id: string; url: string; size: number }>;
export function readImage(db: Pick<Db, 'collection'>, file: string): Promise<{ id: string; mime: string; bytes: Buffer } | null>;
