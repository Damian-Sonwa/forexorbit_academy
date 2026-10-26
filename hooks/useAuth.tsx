/**
 * useAuth Hook
 * Manages authentication state and user session
 */

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { apiClient } from '@/lib/api-client';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'instructor' | 'student';
  status?: 'pending' | 'approved' | 'rejected';
  studentDetails?: any; // Student onboarding data
  onboardingCompleted?: boolean; // Onboarding completion status
  learningLevel?: 'beginner' | 'intermediate' | 'advanced'; // Learning level for community access
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string, role?: string, phone?: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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

    apiClient.get<User>('/auth/me').then((userData) => {
      if (cancelled) return;
      const updatedUser: User = { ...parsedUser, ...userData };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
    }).catch(() => {
      if (!cancelled) logout();
    }).finally(finish);

    return () => {
      cancelled = true;
    };
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

  const signup = async (email: string, password: string, name: string, role = 'student', phone = '') => {
    // Normalize email (trim + lowercase)
    const normalizedEmail = email.trim().toLowerCase();
    
    const response = await apiClient.post<{ token: string | null; user: User; message?: string }>('/auth/signup', {
      email: normalizedEmail,
      password,
      name,
      role,
      phone: phone.trim(),
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

