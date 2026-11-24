export const CHAT_EXTS: string[];
export const IMAGE_EXTS: string[];
export function randomFileName(ext: string): string;
export function inspectUpload(filePath: string, options: { name?: string | null; allow: string[] }): Promise<
  | { ok: true; ext: string; mime: string; kind: string; bytes: number; fileName: string }
  | { ok: false; status: number; code: string; error: string }
>;
