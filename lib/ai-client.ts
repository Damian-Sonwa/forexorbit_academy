/**
 * AI API Client
 * Calls the AI routes on the page's own origin; AI keys stay on the server.
 */

import axios, { AxiosInstance } from 'axios';
import { CSRF_HEADER, CSRF_VALUE } from '@/lib/request-guard';


class AIClient {
  private client: AxiosInstance;

  constructor() {
    // The session cookie is sent by the browser; no credential is read or stored here.
    this.client = axios.create({
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

