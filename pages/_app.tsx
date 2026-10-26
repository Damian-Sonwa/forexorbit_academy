// pages/_app.tsx
import type { AppProps } from 'next/app';
import { RegisterPwa } from '@/components/RegisterPwa';
import { PwaInstallModal } from '@/components/PwaInstallModal';
import { RouteProgress } from '@/components/loading/RouteProgress';
import { PwaInstallProvider } from '@/contexts/PwaInstallContext';
import { AuthProvider } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <PwaInstallProvider>
        <AuthProvider>
          <RouteProgress />
          <RegisterPwa />
          <PwaInstallModal />
          <Component {...pageProps} />
        </AuthProvider>
      </PwaInstallProvider>
    </ThemeProvider>
  );
}
