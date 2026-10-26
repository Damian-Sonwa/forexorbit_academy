// pages/_app.tsx
import type { AppProps } from 'next/app';
import { InstallPwaPrompt } from '@/components/InstallPwaPrompt';
import { RegisterPwa } from '@/components/RegisterPwa';
import { AuthProvider } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RegisterPwa />
        <InstallPwaPrompt />
        <Component {...pageProps} />
      </AuthProvider>
    </ThemeProvider>
  );
}
