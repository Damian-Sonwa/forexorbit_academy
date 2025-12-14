/**
 * Theme Hook
 * Manages dark/light mode toggle
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
}

// Provide default values to prevent SSR errors
const defaultThemeContext: ThemeContextType = {
  isDark: false,
  toggleTheme: () => {},
};

const ThemeContext = createContext<ThemeContextType>(defaultThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize with false, will be set correctly in useEffect
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Mark as mounted to avoid hydration mismatch
    setMounted(true);
    
    // Check for saved theme preference or default to light mode
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      // Use saved theme, or system preference, or default to light
      const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
      
      setIsDark(shouldBeDark);
      
      // Apply theme immediately
      const root = document.documentElement;
      if (shouldBeDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  }, []);

  const toggleTheme = () => {
    if (typeof window === 'undefined') return;
    
    setIsDark((prev) => {
      const newTheme = !prev;
      
      // Update DOM immediately
      const root = document.documentElement;
      if (newTheme) {
        root.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        root.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
      
      return newTheme;
    });
  };

  // Always provide context, even during SSR (use default values)
  // This prevents the "useTheme must be used within a ThemeProvider" error
  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  // Context always has a value (defaultThemeContext), so no need to check for undefined
  return context;
}

