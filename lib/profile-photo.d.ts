import type { Db } from 'mongodb';

type Refusal = { ok: false; status: number; error: string; code: string };
type DeleteImage = (publicId: string) => Promise<void>;

export function currentPhotoId(db: Db, userId: string): Promise<string | null>;
export function replaceProfilePhoto(
  db: Db,
  input: { userId: string; previousPublicId: string | null; upload: { secureUrl: string; publicId: string }; deleteImage: DeleteImage; now?: Date }
): Promise<{ ok: true } | Refusal>;
export function removeProfilePhoto(
  db: Db,
  input: { userId: string; deleteImage: DeleteImage; now?: Date }
): Promise<{ ok: true; removed: boolean } | Refusal>;
