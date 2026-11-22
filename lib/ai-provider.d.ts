export type ResolvedProvider =
  | { ok: true; id: string; label: string; model: string; baseUrl: string; key: string; json: boolean; pinned: boolean }
  | { ok: false; id: string | null; reason: string };
export class ProviderError extends Error {
  code: 'not_configured' | 'auth' | 'quota' | 'rate_limited' | 'model' | 'endpoint' | 'timeout' | 'unavailable' | 'bad_response' | 'truncated';
  providerMessage?: string | null;
  status: number | null;
  retryable: boolean;
  constructor(code: string, message: string, options?: { status?: number | null; retryable?: boolean });
}
export const PROVIDERS: Readonly<Record<string, unknown>>;
export const PUBLIC_MESSAGES: Readonly<Record<string, string>>;
export function resolveProvider(env?: Record<string, string | undefined>): ResolvedProvider;
export function publicProviderStatus(env?: Record<string, string | undefined>): { configured: boolean; provider: string | null; model: string | null; reason?: string };
export function classify(status: number, body: unknown): ProviderError;
export function chatJson(input: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}): Promise<{ content: string; finishReason: string | null; usage: { promptTokens: number; completionTokens: number }; model: string; provider: string }>;
export function providerReason(body: unknown): string | null;
type ChatInput = { system: string; user: string; maxTokens?: number; temperature?: number; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number };
export function chatText(input: ChatInput): Promise<{ content: string; finishReason: string | null; usage: { promptTokens: number; completionTokens: number }; model: string; provider: string }>;
export function availableModels(p: { baseUrl: string; key: string }, fetchImpl: typeof fetch): Promise<string[]>;
export function resetModelChoices(): void;
export const MODEL_PREFERENCE: readonly RegExp[];
