'use strict';

/**
 * AI provider for long-form generation (lesson development), independent of the vendor.
 *
 * Every supported provider speaks the OpenAI-compatible Chat Completions API, so one adapter
 * covers them; only the address, key and default model differ:
 *
 *   AI_LESSON_PROVIDER   groq | cloudflare | openai | ollama | compatible
 *                        (unset: groq when GROQ_API_KEY is set, otherwise openai when AI_API_KEY is set)
 *   groq        GROQ_API_KEY                         https://api.groq.com/openai/v1
 *   cloudflare  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID   Workers AI OpenAI-compatible endpoint
 *   openai      AI_API_KEY (the key the assistant already uses)   https://api.openai.com/v1
 *   ollama      none (a self-hosted model)            OLLAMA_BASE_URL or http://127.0.0.1:11434/v1
 *   compatible  AI_LESSON_BASE_URL + AI_LESSON_API_KEY (any other compatible server)
 *   AI_LESSON_MODEL      overrides the provider's default model
 *
 * Requests run only on the server; keys never reach the browser and are never logged. Errors are
 * classified (not configured, rejected key, quota, rate limit, model, timeout, unavailable, bad
 * response) so people see a useful reason. A failure is retried at most once, and only for
 * temporary errors; there is no fallback to another (possibly paid) provider.
 */

const PROVIDERS = Object.freeze({
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: (env) => env.GROQ_API_KEY, json: true },
  cloudflare: {
    label: 'Cloudflare Workers AI',
    baseUrl: (env) => (env.CLOUDFLARE_ACCOUNT_ID ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/v1` : ''),
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    key: (env) => env.CLOUDFLARE_API_TOKEN,
    json: false,
  },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: (env) => env.AI_API_KEY, json: true },
  ollama: { label: 'Ollama (self-hosted)', baseUrl: (env) => env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1', model: 'llama3.1', key: () => 'ollama', json: true },
  compatible: { label: 'OpenAI-compatible server', baseUrl: (env) => env.AI_LESSON_BASE_URL || '', model: '', key: (env) => env.AI_LESSON_API_KEY || 'none', json: true },
});

const TIMEOUT_MS = 120000;

class ProviderError extends Error {
  constructor(code, message, { status = null, retryable = false } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const PUBLIC_MESSAGES = Object.freeze({
  not_configured: 'AI lesson development is not set up on this server. Manual editing works as normal.',
  auth: 'The AI provider rejected the server\'s key. An administrator needs to check the AI settings.',
  quota: 'The AI provider\'s usage quota is used up for now. Try again later; manual editing works as normal.',
  rate_limited: 'The AI provider is busy (rate limit). Wait a minute and try again.',
  model: 'The configured AI model is not available from the provider. An administrator needs to check AI_LESSON_MODEL.',
  endpoint: 'The AI provider\'s address was not found. An administrator needs to check the provider settings.',
  timeout: 'The AI provider took too long to answer. Try again, or generate one section at a time.',
  unavailable: 'The AI provider is not reachable right now. Try again later.',
  bad_response: 'The AI provider returned an answer that could not be used. Try again.',
  truncated: 'The AI answer was cut off before it was complete, so it was not saved. Try again or generate one section at a time.',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** The provider this server is set up for, without secrets: { ok, id, label, model, baseUrl, key }. */
function resolveProvider(env = process.env) {
  let id = text(env.AI_LESSON_PROVIDER).toLowerCase();
  if (!id) id = text(env.GROQ_API_KEY) ? 'groq' : text(env.AI_API_KEY) ? 'openai' : '';
  const spec = PROVIDERS[id];
  if (!spec) return { ok: false, id: id || null, reason: id ? `Unknown AI_LESSON_PROVIDER "${id}".` : 'No AI provider is configured.' };
  const baseUrl = text(typeof spec.baseUrl === 'function' ? spec.baseUrl(env) : spec.baseUrl).replace(/\/+$/, '');
  const key = text(spec.key(env));
  const model = text(env.AI_LESSON_MODEL) || spec.model;
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) return { ok: false, id, reason: `${spec.label} needs its address configured.` };
  if (!key) return { ok: false, id, reason: `${spec.label} needs its API key configured.` };
  if (!model) return { ok: false, id, reason: 'AI_LESSON_MODEL is not set.' };
  return { ok: true, id, label: spec.label, model, baseUrl, key, json: spec.json };
}

/** What the builder may show about the provider (no address or key). */
function publicProviderStatus(env = process.env) {
  const p = resolveProvider(env);
  return p.ok ? { configured: true, provider: p.label, model: p.model } : { configured: false, provider: null, model: null, reason: PUBLIC_MESSAGES.not_configured };
}

/** The provider's own error text for the server log: bounded, with anything key-like removed. */
function providerReason(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const err = raw.error && typeof raw.error === 'object' ? raw.error : raw;
  const text = typeof err.message === 'string' ? err.message : typeof raw.error === 'string' ? raw.error : '';
  return text.replace(/(sk|gsk|pk|rk)[-_][A-Za-z0-9_-]{6,}/g, '<key>').replace(/Bearer\s+\S+/gi, 'Bearer <key>').slice(0, 300) || null;
}

function classify(status, body) {
  const raw = body && typeof body === 'object' ? body : {};
  const err = raw.error && typeof raw.error === 'object' ? raw.error : raw;
  const code = String(err.code || err.type || '').toLowerCase();
  const message = String(err.message || '').toLowerCase();
  if (status === 401 || status === 403) return new ProviderError('auth', PUBLIC_MESSAGES.auth, { status });
  if (status === 429) {
    if (/insufficient_quota|quota|billing|credit|daily/.test(`${code} ${message}`)) return new ProviderError('quota', PUBLIC_MESSAGES.quota, { status });
    return new ProviderError('rate_limited', PUBLIC_MESSAGES.rate_limited, { status, retryable: true });
  }
  if (/model_not_found|model.*(not found|does not exist|decommissioned|not available|no access|do not have access)|does not have access to model|unknown model|invalid model/.test(`${code} ${message}`)) return new ProviderError('model', PUBLIC_MESSAGES.model, { status });
  if (status === 404) return new ProviderError('endpoint', PUBLIC_MESSAGES.endpoint, { status });
  if (status === 402) return new ProviderError('quota', PUBLIC_MESSAGES.quota, { status });
  if (status >= 500) return new ProviderError('unavailable', PUBLIC_MESSAGES.unavailable, { status, retryable: true });
  return new ProviderError('bad_response', PUBLIC_MESSAGES.bad_response, { status });
}

/**
 * One chat completion that should answer with a JSON object.
 * Returns { content, finishReason, usage: { promptTokens, completionTokens }, model, provider }.
 * `fetchImpl` is for tests.
 */
async function chatJson({ system, user, maxTokens = 6000, temperature = 0.4, env = process.env, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, retries = 1 }) {
  const p = resolveProvider(env);
  if (!p.ok) throw new ProviderError('not_configured', PUBLIC_MESSAGES.not_configured);
  const body = {
    model: p.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
    ...(p.json ? { response_format: { type: 'json_object' } } : {}),
  };
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        const failure = classify(res.status, data);
        if (failure.code === 'model') failure.message = `${p.label} says the model "${p.model}" is not available to this account. Choose a model the account can use with AI_LESSON_MODEL${p.id === 'openai' ? ', add billing to the OpenAI account, or set GROQ_API_KEY to use Groq\'s free tier' : ''}.`;
        if (failure.code === 'auth') failure.message = `${p.label} rejected the server's key. An administrator needs to check it.`;
        failure.providerMessage = providerReason(data);
        throw failure;
      }
      const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
      const content = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
      if (!content) throw new ProviderError('bad_response', PUBLIC_MESSAGES.bad_response);
      const usage = data.usage || {};
      return {
        content,
        finishReason: choice.finish_reason || null,
        usage: { promptTokens: Number(usage.prompt_tokens) || 0, completionTokens: Number(usage.completion_tokens) || 0 },
        model: typeof data.model === 'string' ? data.model : p.model,
        provider: p.label,
      };
    } catch (error) {
      const failure = error instanceof ProviderError
        ? error
        : error && error.name === 'AbortError'
          ? new ProviderError('timeout', PUBLIC_MESSAGES.timeout, { retryable: true })
          : new ProviderError('unavailable', PUBLIC_MESSAGES.unavailable, { retryable: true });
      if (failure.retryable && attempt < retries) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, failure.code === 'rate_limited' ? 2500 : 1000));
        continue;
      }
      // The reason helps operators; no key, address or prompt is logged.
      console.error(JSON.stringify({ event: 'aiProvider', result: 'failed', provider: p.label, model: p.model, code: failure.code, status: failure.status, reason: failure.providerMessage || null }));
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { providerReason, PROVIDERS, PUBLIC_MESSAGES, ProviderError, chatJson, classify, publicProviderStatus, resolveProvider };
