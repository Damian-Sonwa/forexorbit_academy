import type { Db } from 'mongodb';

type Refusal = { ok: false; status: number; error: string; code: string };
type DeleteImage = (publicId: string) => Promise<void>;
type PhotoUpload = { secureUrl: string; publicId: string; data?: { mime: string; bytes: Buffer } };

export const MAX_EMBEDDED_BYTES: number;
export function embeddedPhoto(userId: string, photo: { mime: string; ext: string; bytes: Buffer }): PhotoUpload;
export function readEmbeddedPhoto(db: Db, file: string): Promise<{ mime: string; bytes: Buffer } | null>;
export function photoDeleter(stores: { cloudinary: DeleteImage; r2: DeleteImage }): DeleteImage;

export function currentPhotoId(db: Db, userId: string): Promise<string | null>;
export function replaceProfilePhoto(
  db: Db,
  input: { userId: string; previousPublicId: string | null; upload: PhotoUpload; deleteImage: DeleteImage; now?: Date }
): Promise<{ ok: true } | Refusal>;
export function removeProfilePhoto(
  db: Db,
  input: { userId: string; deleteImage: DeleteImage; now?: Date }
): Promise<{ ok: true; removed: boolean } | Refusal>;
