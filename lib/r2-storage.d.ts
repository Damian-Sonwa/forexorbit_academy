export type R2Config = { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl?: string };
export class R2Error extends Error { status: number; constructor(message: string, status: number); }
export function r2ImagesMissing(env?: Record<string, string | undefined>): string[];
export function r2ImagesConfig(env?: Record<string, string | undefined>): (R2Config & { publicBaseUrl: string }) | null;
export function r2FilesConfig(env?: Record<string, string | undefined>): R2Config | null;
export function encode(value: string, path?: boolean): string;
export function presign(input: { method: string; protocol?: string; host: string; path: string; query?: Record<string, string>; accessKeyId: string; secretAccessKey: string; region?: string; service?: string; expires?: number; now?: Date }): string;
export function objectUrl(config: R2Config, method: string, key: string, options?: { expires?: number; query?: Record<string, string>; now?: Date }): string;
export function putObject(config: R2Config, key: string, filePath: string, options?: { contentType?: string; cacheControl?: string; fetchImpl?: typeof fetch }): Promise<{ key: string; bytes: number }>;
export function deleteObject(config: R2Config, key: string, options?: { fetchImpl?: typeof fetch }): Promise<void>;
export function signedGetUrl(config: R2Config, key: string, options?: { expires?: number; filename?: string | null; inline?: boolean }): string;
export function publicUrl(config: R2Config & { publicBaseUrl: string }, key: string): string;
