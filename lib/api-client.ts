/**
 * Reusable API Client
 * Centralized axios instance. The session is an HttpOnly cookie that the browser sends by itself
 * (lib/session-core.js); this client never reads or stores a credential. Every request carries the
 * CSRF header that state-changing API routes require (lib/request-guard.js).
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { messageFromUnknown } from '@/lib/public-error';
import { loginHref } from '@/lib/login-redirect';
import { CSRF_HEADER, CSRF_VALUE } from '@/lib/request-guard';

/**
 * The API is always on the page's own origin (one canonical origin: pages, API and sockets).
 * A relative base keeps the host-only session cookie on every request and works unchanged on
 * production, staging and local servers. No environment variable can point it elsewhere.
 */
const API_URL = '/api';

/** Requests whose 401 is an answer for the caller (no session yet), not a reason to redirect. */
const SESSION_PROBE_URLS = ['/auth/login', '/auth/me', '/auth/signup', '/auth/logout', '/auth/session/upgrade'];

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER]: CSRF_VALUE,
      },
    });

    // Handle auth errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const safe = messageFromUnknown(error);
        if (safe && error && typeof error === 'object') {
          error.message = safe;
          const data = error.response?.data;
          if (typeof data === 'string') {
            error.response.data = { error: safe };
          } else if (data && typeof data === 'object') {
            data.error = safe;
            delete data.details;
            delete data.stack;
            if (error.response?.status >= 500) delete data.message;
          }
        }
        if (error.response?.status === 401) {
          if (typeof window !== 'undefined') {
            // The session ended (signed out, expired or revoked). Session probes and sign-in
            // requests report it to their caller instead of redirecting.
            const isLoginPage = window.location.pathname === '/login';
            const url = String(error.config?.url || '');
            const isSessionProbe = SESSION_PROBE_URLS.some((path) => url.includes(path));

            if (!isLoginPage && !isSessionProbe) {
              window.location.href = loginHref(`${window.location.pathname}${window.location.search}`);
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T>(url: string, config?: AxiosRequestConfig) {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  /** Returns response body and status without throwing on 4xx (for lesson paywall 403). Network errors still throw. */
  async getAllowingError<T>(url: string, config?: AxiosRequestConfig) {
    try {
      const response = await this.client.get<T>(url, config);
      return { ok: true as const, status: response.status, data: response.data };
    } catch (e: unknown) {
      const ax = e as { response?: { status?: number; data?: unknown } };
      if (ax.response && typeof ax.response.status === 'number') {
        return { ok: false as const, status: ax.response.status, data: ax.response.data };
      }
      throw e;
    }
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    // FIX: Don't set Content-Type for FormData - let browser set it with boundary
    const isFormData = data instanceof FormData;
    const requestConfig = isFormData
      ? {
          ...config,
          headers: {
            ...config?.headers,
            'Content-Type': undefined, // Remove Content-Type to let browser set it
          },
        }
      : config;
    
    const response = await this.client.post<T>(url, data, requestConfig);
    return response.data;
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig) {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}

export const apiClient = new ApiClient();

export function isUnauthorizedError(err: unknown): boolean {
  return (err as { response?: { status?: number } } | null)?.response?.status === 401;
}

