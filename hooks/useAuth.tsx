/**
 * useAuth Hook
 * Manages authentication state and user session
 */

import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'instructor' | 'student';
  status?: 'pending' | 'approved' | 'rejected';
  studentDetails?: any; // Student onboarding data
  onboardingCompleted?: boolean; // Onboarding completion status
  learningLevel?: 'beginner' | 'intermediate' | 'advanced'; // Learning level for community access
  profilePhoto?: string | null;
}

/** Re-read the profile when the tab regains focus, at most this often. */
const PROFILE_REFRESH_MIN_MS = 60_000;

/** Key-order-independent JSON, used to tell whether a fresh profile actually differs. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Merges fresh /auth/me data into the current user. When nothing changed, the existing object is
 * returned unchanged: about 35 page effects depend on `user`, and a new object with identical
 * contents made every page load its data twice.
 */
function mergeUser(current: User, fresh: User): User {
  const merged: User = { ...current, ...fresh };
  return stableJson(merged) === stableJson(current) ? current : merged;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string, role?: string) => Promise<void>;
  logout: () => void;
  /** Re-reads /auth/me into the shared user (after a profile or photo change). */
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastProfileReadAt = useRef(0);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setLoading(false);
    };
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (!token || !savedUser) {
      finish();
      return;
    }

    let parsedUser: User;
    try {
      parsedUser = JSON.parse(savedUser);
    } catch {
      logout();
      finish();
      return;
    }

    setUser(parsedUser);
    finish();
    lastProfileReadAt.current = Date.now();
    apiClient.get<User>('/auth/me').then((userData) => {
      if (cancelled) return;
      const updatedUser = mergeUser(parsedUser, userData);
      if (updatedUser === parsedUser) return;
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
    }).catch((err: unknown) => {
      // Only a rejected session signs out; a network error or server fault keeps the saved user.
      if (!cancelled && isUnauthorizedError(err)) logout();
    }).finally(finish);

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshUser = useCallback(async () => {
    if (typeof window === 'undefined' || !localStorage.getItem('token')) return;
    lastProfileReadAt.current = Date.now();
    try {
      const userData = await apiClient.get<User>('/auth/me');
      setUser((current) => {
        if (!current) return current;
        const updated = mergeUser(current, userData);
        if (updated !== current) localStorage.setItem('user', JSON.stringify(updated));
        return updated;
      });
    } catch {
      // A 401 is handled by the API client (sign-out and redirect); other failures keep the current profile.
    }
  }, []);

  // One shared profile for every component. It is refreshed when the tab becomes visible again
  // (throttled), instead of each Sidebar polling /auth/me every few seconds.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastProfileReadAt.current < PROFILE_REFRESH_MIN_MS) return;
      void refreshUser();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshUser]);

  // Keeps every open tab in step: signing out (or in) in one tab updates the others. The browser
  // fires `storage` only in the other tabs, never in the tab that made the change.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key === 'token' || event.key === null) {
        if (!localStorage.getItem('token')) setUser(null);
        return;
      }
      if (event.key === 'user') {
        if (!event.newValue) {
          setUser(null);
          return;
        }
        try {
          setUser(JSON.parse(event.newValue));
        } catch {
          setUser(null);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = async (email: string, password: string) => {
    // Normalize email (trim + lowercase)
    const normalizedEmail = email.trim().toLowerCase();
    
    try {
      const response = await apiClient.post<{ token: string; user: User }>('/auth/login', {
        email: normalizedEmail,
        password,
      });

      const token =
        response?.token != null && typeof response.token === 'string' ? response.token.trim() : '';
      if (!token) {
        throw new Error('Login did not return a session token. Please try again.');
      }
      localStorage.setItem('token', token);
      // Fetch full user data including onboarding status
      const userData = await apiClient.get<User>('/auth/me');
      const fullUser: User = { ...response.user, ...userData };
      localStorage.setItem('user', JSON.stringify(fullUser));
      setUser(fullUser);
    } catch (error: unknown) {
      // Extract error message from API response
      let errorMessage = 'Login failed. Please check your credentials.';
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
        errorMessage = apiError.response?.data?.error || apiError.response?.data?.message || apiError.message || errorMessage;
      } else if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      throw new Error(errorMessage);
    }
  };

  const signup = async (email: string, password: string, name: string, role = 'student') => {
    // Normalize email (trim + lowercase)
    const normalizedEmail = email.trim().toLowerCase();
    
    const response = await apiClient.post<{ token: string | null; user: User; message?: string }>('/auth/signup', {
      email: normalizedEmail,
      password,
      name,
      role,
    });

    // Only set token if user is approved (students are auto-approved, instructors/admins need approval)
    if (response.token) {
      localStorage.setItem('token', response.token);
      // Fetch full user data including onboarding status for approved users
      try {
        const userData = await apiClient.get<User>('/auth/me');
        const fullUser: User = { ...response.user, ...userData };
        localStorage.setItem('user', JSON.stringify(fullUser));
        setUser(fullUser);
      } catch {
        // If /auth/me fails, use response.user
        localStorage.setItem('user', JSON.stringify(response.user));
        setUser(response.user);
      }
    } else {
      localStorage.setItem('user', JSON.stringify(response.user));
      setUser(response.user);
    }
    
    // Show message if provided (e.g., pending approval message)
    if (response.message) {
      alert(response.message);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        logout,
        refreshUser,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

