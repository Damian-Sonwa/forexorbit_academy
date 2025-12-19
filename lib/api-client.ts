/**
 * Reusable API Client
 * Centralized axios instance with authentication
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
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

    // Handle auth errors and network errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        // Handle network errors (ERR_NETWORK)
        if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
          console.error('Network error:', {
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            message: error.message,
          });
          // Don't redirect on network errors - might be temporary
          // Let the component handle the error gracefully
          return Promise.reject(error);
        }

        // Handle 401 Unauthorized
        if (error.response?.status === 401) {
          if (typeof window !== 'undefined') {
            // Don't redirect if we're already on the login page (login failed)
            const isLoginPage = window.location.pathname === '/login';
            const isLoginRequest = error.config?.url?.includes('/auth/login');
            
            if (!isLoginPage && !isLoginRequest) {
              // Only redirect if we're not on login page and it's not a login request
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

  async get<T>(url: string, config?: AxiosRequestConfig) {
    const response = await this.client.get<T>(url, config);
    return response.data;
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

  async delete<T>(url: string, config?: AxiosRequestConfig) {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}

export const apiClient = new ApiClient();

