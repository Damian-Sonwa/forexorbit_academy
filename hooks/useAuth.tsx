/**
 * useAuth Hook
 * Manages authentication state and user session.
 *
 * The session is an HttpOnly cookie (lib/session-core.js): no script, including this one, can read
 * it, and nothing about it is stored in localStorage, sessionStorage or IndexedDB. The profile
 * shown in the UI lives in React state only and is re-read from GET /api/auth/me after a reload.
 * Open tabs share the cookie; sign-in and sign-out are announced to the other tabs on a
 * BroadcastChannel that carries the event name only.
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

/** Cross-tab announcements. Messages carry an event name only, never a credential or profile. */
const AUTH_CHANNEL = 'forexorbit-auth';
type AuthEvent = 'signed-in' | 'signed-out';

/** A failed session check that is not a 401 (network, server) is retried before giving up. */
const SESSION_CHECK_RETRY_MS = [500, 1500];

/**
 * TEMPORARY (Phase 4.5 rollout only; remove with pages/api/auth/session/upgrade.ts).
 * Browsers signed in before Phase 4.5 hold a token under these localStorage keys. It is removed
 * first, then exchanged once for a cookie session while the server's legacy window is open.
 * Nothing is ever written to these keys again.
 */
const LEGACY_STORAGE_KEYS = ['token', 'user'];
async function migrateLegacyStorage(): Promise<void> {
  let legacyToken: string | null = null;
  try {
    legacyToken = window.localStorage.getItem('token');
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    return;
  }
  if (!legacyToken || !legacyToken.trim()) return;
  try {
    await apiClient.post('/auth/session/upgrade', undefined, {
      headers: { Authorization: `Bearer ${legacyToken.trim()}` },
    });
  } catch {
    // Window closed or token no longer valid: the person signs in again.
  }
}

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
function mergeUser(current: User | null, fresh: User): User {
  if (!current || current.id !== fresh.id) return fresh;
  const merged: User = { ...current, ...fresh };
  return stableJson(merged) === stableJson(current) ? current : merged;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string, role?: string) => Promise<void>;
  /** Ends this browser's session on the server and in every open tab. */
  logout: () => Promise<void>;
  /** Re-reads /auth/me into the shared user (after a profile or photo change). */
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastProfileReadAt = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const announce = useCallback((event: AuthEvent) => {
    try {
      channel.current?.postMessage(event);
    } catch {
      // Other tabs then learn it at their next request.
    }
  }, []);

  /**
   * Reads the current session's profile. 401 means signed out. Any other failure is retried, then
   * treated as signed out for display only (the cookie, if valid, still works on the next try).
   */
  const loadSession = useCallback(async (): Promise<User | null> => {
    lastProfileReadAt.current = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        const fresh = await apiClient.get<User>('/auth/me');
        let next: User | null = null;
        setUser((current) => {
          next = mergeUser(current, fresh);
          return next;
        });
        return next;
      } catch (err: unknown) {
        if (isUnauthorizedError(err) || attempt >= SESSION_CHECK_RETRY_MS.length) {
          setUser(null);
          return null;
        }
        await new Promise((resolve) => setTimeout(resolve, SESSION_CHECK_RETRY_MS[attempt]));
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLegacyStorage();
      if (!cancelled) await loadSession();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  const logout = useCallback(async () => {
    setUser(null);
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // The cookie is cleared by the server; if the request failed, the session still ends at
      // its idle timeout. The UI is signed out either way.
    }
    announce('signed-out');
  }, [announce]);

  const refreshUser = useCallback(async () => {
    lastProfileReadAt.current = Date.now();
    try {
      const userData = await apiClient.get<User>('/auth/me');
      setUser((current) => (current ? mergeUser(current, userData) : current));
    } catch (err: unknown) {
      // An ended session signs this tab out; other failures keep the current profile.
      if (isUnauthorizedError(err)) setUser(null);
    }
  }, []);

  // One shared profile for every component. It is refreshed when the tab becomes visible again
  // (throttled), which also notices a session that ended while the tab was in the background.
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

  // Keeps every open tab in step: signing out (or in) in one tab updates the others.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(AUTH_CHANNEL);
    channel.current = bc;
    bc.onmessage = (event: MessageEvent) => {
      if (event.data === 'signed-out') setUser(null);
      else if (event.data === 'signed-in') void loadSession();
    };
    return () => {
      channel.current = null;
      bc.close();
    };
  }, [loadSession]);

  const login = async (email: string, password: string) => {
    // Normalize email (trim + lowercase)
    const normalizedEmail = email.trim().toLowerCase();

    try {
      // The server sets the session cookie; the body carries the profile only.
      const response = await apiClient.post<{ user: User }>('/auth/login', {
        email: normalizedEmail,
        password,
      });
      // Fetch full user data including onboarding status
      const userData = await apiClient.get<User>('/auth/me');
      setUser({ ...response.user, ...userData });
      lastProfileReadAt.current = Date.now();
      announce('signed-in');
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

    const response = await apiClient.post<{ signedIn: boolean; user: User; message?: string }>('/auth/signup', {
      email: normalizedEmail,
      password,
      name,
      role,
    });

    // Students are approved and signed in at once (the server set the cookie). Instructors wait for
    // the Super Admin's approval and have no session: their profile is shown for this page only.
    if (response.signedIn) {
      try {
        const userData = await apiClient.get<User>('/auth/me');
        setUser({ ...response.user, ...userData });
      } catch {
        setUser(response.user);
      }
      announce('signed-in');
    } else {
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
