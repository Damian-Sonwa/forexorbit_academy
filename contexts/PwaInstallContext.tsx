import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)');
  if (mq?.matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isSecureEnough(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

export type PwaInstallContextValue = {
  /** HTTPS (or localhost), mounted, not already in standalone */
  canShowInstallUi: boolean;
  /** Chromium: beforeinstallprompt captured — native install dialog available */
  nativeInstallAvailable: boolean;
  busy: boolean;
  /** Opens the browser/OS install dialog (must call only when nativeInstallAvailable) */
  promptNativeInstall: () => Promise<boolean>;
  /** Clears the deferred prompt (e.g. “Not now”) — next install UI requires a new beforeinstallprompt (usually after reload) */
  dismissDeferredPrompt: () => void;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !isSecureEnough() || isStandalone()) return;
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [mounted]);

  const promptNativeInstall = useCallback(async () => {
    if (!deferred) return false;
    setBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      const outcome = choice?.outcome ?? 'dismissed';
      setDeferred(null);
      return outcome === 'accepted';
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [deferred]);

  const dismissDeferredPrompt = useCallback(() => {
    setDeferred(null);
  }, []);

  const canShowInstallUi = mounted && isSecureEnough() && !isStandalone();
  const nativeInstallAvailable = !!deferred;

  const value = useMemo<PwaInstallContextValue>(
    () => ({
      canShowInstallUi,
      nativeInstallAvailable,
      busy,
      promptNativeInstall,
      dismissDeferredPrompt,
    }),
    [canShowInstallUi, nativeInstallAvailable, busy, promptNativeInstall, dismissDeferredPrompt]
  );

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}

export function usePwaInstall(): PwaInstallContextValue {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    throw new Error('usePwaInstall must be used within PwaInstallProvider');
  }
  return ctx;
}
