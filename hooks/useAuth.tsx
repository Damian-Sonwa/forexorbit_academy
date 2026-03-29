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
    // Check for existing session
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (token && savedUser) {
      try {
        const parsedUser: User = JSON.parse(savedUser);
        setUser(parsedUser);
        // Verify token is still valid and fetch latest user data
        apiClient.get<User>('/auth/me').then((userData) => {
          // Update user with latest data including onboarding status
          const updatedUser: User = { ...parsedUser, ...userData };
          setUser(updatedUser);
          localStorage.setItem('user', JSON.stringify(updatedUser));
        }).catch(() => {
          logout();
        });
      } catch (error) {
        logout();
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    // Normalize email (trim + lowercase)
    const normalizedEmail = email.trim().toLowerCase();
    
    // Development-only logging
    if (process.env.NODE_ENV === 'development') {
      console.log('Login API call for:', normalizedEmail);
    }
    
    try {
      const response = await apiClient.post<{ token?: string; user: User }>('/auth/login', {
        email: normalizedEmail,
        password,
      });

      const token =
        response?.token != null && typeof response.token === 'string' ? response.token.trim() : '';
      if (!token) {
        throw new Error('Login did not return a token. Check the server logs and JWT_SECRET.');
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
        errorMessage = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || errorMessage;
      } else if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      throw new Error(errorMessage);
    }
  };

  const signup = async (email: string, password: string, name: string, role = 'student', phone = '') => {
    const normalizedEmail = email.trim().toLowerCase();

    if (process.env.NODE_ENV === 'development') {
      console.log('Signup API call for:', normalizedEmail, 'role:', role);
    }

    try {
      const response = await apiClient.post<{ token: string | null; user: User; message?: string }>(
        '/auth/signup',
        {
          email: normalizedEmail,
          password,
          name: name.trim(),
          role,
          phone: phone.trim(),
        }
      );

      if (response.token) {
        localStorage.setItem('token', response.token);
        try {
          const userData = await apiClient.get<User>('/auth/me');
          const fullUser: User = { ...response.user, ...userData };
          localStorage.setItem('user', JSON.stringify(fullUser));
          setUser(fullUser);
        } catch {
          localStorage.setItem('user', JSON.stringify(response.user));
          setUser(response.user);
        }
      } else {
        localStorage.setItem('user', JSON.stringify(response.user));
        setUser(response.user);
      }

      if (response.message) {
        alert(response.message);
      }
    } catch (error: unknown) {
      let errorMessage = 'Signup failed. Please try again.';
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
        errorMessage = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || errorMessage;
      } else if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      throw new Error(errorMessage);
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

