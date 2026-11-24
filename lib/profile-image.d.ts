export const MAX_PIXELS: number;
export const SIDE: number;
export function reencodeProfileImage(input: Buffer): Promise<
  | { ok: true; bytes: Buffer; mime: 'image/webp'; ext: 'webp' }
  | { ok: false; status: 400; error: string }
>;
