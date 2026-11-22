// pages/_app.tsx
import { useEffect } from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { RegisterPwa } from '@/components/RegisterPwa';
import { PwaInstallModal } from '@/components/PwaInstallModal';
import { RouteProgress } from '@/components/loading/RouteProgress';
import { PwaInstallProvider } from '@/contexts/PwaInstallContext';
import { AuthProvider } from '@/hooks/useAuth';
import { SocketProvider } from '@/hooks/useSocket';
import { ThemeProvider } from '@/hooks/useTheme';
import { surfaceFor } from '@/lib/design-surface';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  const { pathname } = useRouter();

  // The area's background composition (styles/globals.css, body[data-surface]). Visual only.
  useEffect(() => {
    document.body.dataset.surface = surfaceFor(pathname);
  }, [pathname]);

  return (
    <ThemeProvider>
      {/* Phase 15: defaults; a page with its own <Head> title or description replaces them (same key). */}
      <Head>
        <title key="title">ForexOrbit Academy: learn forex trading with a simulated market</title>
        <meta key="description" name="description" content="Structured forex courses, assessments and a simulated trading desk with instructor feedback. Practise with virtual funds before risking real money." />
      </Head>
      <PwaInstallProvider>
        <AuthProvider>
          <SocketProvider>
            <RouteProgress />
            <RegisterPwa />
            <PwaInstallModal />
            <Component {...pageProps} />
          </SocketProvider>
        </AuthProvider>
      </PwaInstallProvider>
    </ThemeProvider>
  );
}
