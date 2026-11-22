export const MAX_COURSE_ASSETS: number;
export const MAX_UPLOAD_BYTES: number;
export const TYPES: Readonly<Record<string, { kind: string; mime: string; sig: string; max: number }>>;
export function extensionOf(name: unknown): string;
export function matchesSignature(sig: string, head: Uint8Array | Buffer | null | undefined): boolean;
export function cleanFileName(name: unknown): string;
export function checkCourseFile(input: { name: unknown; size: number; head: Uint8Array | Buffer | null }):
  | { ok: true; ext: string; kind: string; mime: string; name: string }
  | { ok: false; status: number; code: string; error: string };
export function acceptAttribute(kind?: 'file' | 'video'): string;
export function detectImage(head: Uint8Array | Buffer | null | undefined): { ext: string; mime: string } | null;
