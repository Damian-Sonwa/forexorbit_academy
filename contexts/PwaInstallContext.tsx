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
  /** Client mounted and HTTPS (or localhost), not already installed */
  canShowInstallUi: boolean;
  /** Browser supplied beforeinstallprompt (Chrome/Edge/Android) */
  nativeInstallAvailable: boolean;
  busy: boolean;
  /** Run the OS install dialog when available */
  promptNativeInstall: () => Promise<boolean>;
  openManualInstallModal: () => void;
  closeManualInstallModal: () => void;
  manualModalOpen: boolean;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

function ManualInstallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-manual-title"
    >
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#1e2d2b] text-[#edddd4] shadow-2xl p-5 max-h-[90vh] overflow-y-auto">
        <h2 id="pwa-manual-title" className="text-lg font-semibold text-white">
          Install ForexOrbit Academy
        </h2>
        <p className="text-sm text-nav-muted mt-2 leading-relaxed">
          Use your browser&apos;s install option to add the app to your device. The site must be served over{' '}
          <strong className="text-nav-text">HTTPS</strong> (or localhost for development).
        </p>
        <ul className="mt-4 space-y-3 text-sm text-nav-muted list-disc pl-5">
          <li>
            <strong className="text-nav-text">Chrome / Edge (Windows, Mac, Android):</strong> click the install icon
            in the address bar, or open the menu (⋮) and choose <em>Install app</em> / <em>Install ForexOrbit</em>.
          </li>
          <li>
            <strong className="text-nav-text">Safari (iPhone / iPad):</strong> tap <em>Share</em>, then{' '}
            <em>Add to Home Screen</em>.
          </li>
          <li>
            <strong className="text-nav-text">Firefox:</strong> use the browser menu and look for install or add to
            home screen options (varies by platform).
          </li>
        </ul>
        <p className="text-xs text-nav-muted/80 mt-4">
          If no install option appears, ensure you are not already in the installed app and that the manifest and
          service worker load correctly (check DevTools → Application).
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full py-2.5 rounded-lg text-sm font-semibold bg-primary-500 hover:bg-primary-600 text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !isSecureEnough() || isStandalone()) return;
    const onBip = (e: Event) => {
      e.preventDefault();
      if (typeof console !== 'undefined' && console.info) {
        console.info('[ForexOrbit PWA] beforeinstallprompt captured (deferred for #installBtn)');
      }
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      if (typeof console !== 'undefined' && console.info) {
        console.info('[ForexOrbit PWA] appinstalled — PWA added to device');
      }
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
      if (typeof console !== 'undefined' && console.info) {
        console.info('[ForexOrbit PWA] install prompt user choice:', outcome);
      }
      setDeferred(null);
      return outcome === 'accepted';
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ForexOrbit PWA] install prompt failed:', err);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [deferred]);

  const canShowInstallUi = mounted && isSecureEnough() && !isStandalone();
  const nativeInstallAvailable = !!deferred;

  const value = useMemo<PwaInstallContextValue>(
    () => ({
      canShowInstallUi,
      nativeInstallAvailable,
      busy,
      promptNativeInstall,
      openManualInstallModal: () => setManualOpen(true),
      closeManualInstallModal: () => setManualOpen(false),
      manualModalOpen: manualOpen,
    }),
    [canShowInstallUi, nativeInstallAvailable, busy, promptNativeInstall, manualOpen]
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
      <ManualInstallModal open={manualOpen} onClose={() => setManualOpen(false)} />
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall(): PwaInstallContextValue {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    throw new Error('usePwaInstall must be used within PwaInstallProvider');
  }
  return ctx;
}
