/**
 * Theme Hook
 * Manages dark/light mode toggle
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
}

// Black and orange is the default. A saved "light" choice still wins.
const defaultThemeContext: ThemeContextType = {
  isDark: true,
  toggleTheme: () => {},
};

const ThemeContext = createContext<ThemeContextType>(defaultThemeContext);

function applyTheme(isDark: boolean) {
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', isDark ? '#07080c' : '#faf8f4');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Mark as mounted to avoid hydration mismatch
    setMounted(true);
    
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      const shouldBeDark = savedTheme !== 'light';

      setIsDark(shouldBeDark);
      applyTheme(shouldBeDark);
    }
  }, []);

  const toggleTheme = () => {
    if (typeof window === 'undefined') return;
    
    setIsDark((prev) => {
      const newTheme = !prev;
      
      // Update DOM immediately
      applyTheme(newTheme);
      localStorage.setItem('theme', newTheme ? 'dark' : 'light');
      
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

