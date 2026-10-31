/**
 * AI API Client
 * Ensures all AI requests go to Render backend
 * NEVER exposes AI keys to frontend
 */

import axios, { AxiosInstance } from 'axios';
import { resolveApiBaseUrl } from '@/lib/client-origin';
import { CSRF_HEADER, CSRF_VALUE } from '@/lib/request-guard';

// Same origin unless NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_API_URL is set.
const RENDER_BACKEND_URL = resolveApiBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL
);

class AIClient {
  private client: AxiosInstance;

  constructor() {
    // The session cookie is sent by the browser; no credential is read or stored here.
    this.client = axios.create({
      baseURL: RENDER_BACKEND_URL,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        [CSRF_HEADER]: CSRF_VALUE,
      },
    });

    // Handle errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          if (typeof window !== 'undefined') {
            const isLoginPage = window.location.pathname === '/login';
            if (!isLoginPage) {
              window.location.href = '/login';
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T>(url: string) {
    const response = await this.client.get<T>(url);
    return response.data;
  }

  async post<T>(url: string, data?: unknown) {
    const response = await this.client.post<T>(url, data);
    return response.data;
  }
}

export const aiClient = new AIClient();

