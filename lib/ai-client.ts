/**
 * AI API Client
 * Ensures all AI requests go to Render backend
 * NEVER exposes AI keys to frontend
 */

import axios, { AxiosInstance } from 'axios';

// CRITICAL: AI endpoints MUST call Render backend directly
const RENDER_BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://forexorbit-academy.onrender.com';

class AIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: RENDER_BACKEND_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth token to requests
    this.client.interceptors.request.use((config) => {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
      return config;
    });

    // Handle errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          if (typeof window !== 'undefined') {
            const isLoginPage = window.location.pathname === '/login';
            if (!isLoginPage) {
              localStorage.removeItem('token');
              localStorage.removeItem('user');
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

