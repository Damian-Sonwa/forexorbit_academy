import { useEffect, useState, useCallback } from 'react';

const DISMISS_CHROME_KEY = 'forexorbit-pwa-install-dismissed-at';
const DISMISS_IOS_KEY = 'forexorbit-pwa-ios-hint-dismissed-at';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isDismissed(key: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const t = parseInt(raw, 10);
    if (Number.isNaN(t)) return false;
    return Date.now() - t < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return true;
  const mq = window.matchMedia?.('(display-mode: standalone)');
  if (mq?.matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/**
 * Dismissible install banner: uses beforeinstallprompt on Chromium; iOS Safari hint otherwise.
 */
export function InstallPwaPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showChrome, setShowChrome] = useState(false);
  const [showIos, setShowIos] = useState(false);
  const [busy, setBusy] = useState(false);

  const dismissChrome = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_CHROME_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShowChrome(false);
    setDeferred(null);
  }, []);

  const dismissIos = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_IOS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShowIos(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }
    if (isStandalone()) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      if (isDismissed(DISMISS_CHROME_KEY)) return;
      setDeferred(e as BeforeInstallPromptEvent);
      setShowChrome(true);
    };

    window.addEventListener('beforeinstallprompt', onBip);

    const t = window.setTimeout(() => {
      if (isIosSafari() && !isDismissed(DISMISS_IOS_KEY) && !isStandalone()) {
        setShowIos(true);
      }
    }, 4000);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.clearTimeout(t);
    };
  }, []);

  const onInstallClick = async () => {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* user cancelled or prompt failed */
    } finally {
      setBusy(false);
      dismissChrome();
    }
  };

  if (showChrome && deferred) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] p-3 sm:p-4 flex justify-center pointer-events-none"
        role="dialog"
        aria-label="Install app"
      >
        <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-white/15 bg-[#283d3b] text-[#edddd4] shadow-2xl px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm sm:text-base">Install ForexOrbit</p>
            <p className="text-xs sm:text-sm text-nav-muted mt-0.5">
              Add this app to your home screen for quicker access and offline support.
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-2 sm:gap-2">
            <button
              type="button"
              onClick={dismissChrome}
              className="px-3 py-2 rounded-lg text-sm font-medium text-nav-muted hover:bg-white/10 transition-colors"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={onInstallClick}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-60 transition-colors"
            >
              {busy ? '…' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showIos) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] p-3 sm:p-4 flex justify-center pointer-events-none"
        role="dialog"
        aria-label="Add to home screen"
      >
        <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-white/15 bg-[#283d3b] text-[#edddd4] shadow-2xl px-4 py-3 sm:px-5 sm:py-4 flex flex-col gap-2">
          <p className="font-semibold text-white text-sm sm:text-base">Install on iPhone / iPad</p>
          <p className="text-xs sm:text-sm text-nav-muted">
            Tap <span className="text-white font-medium">Share</span>
            {' '}<span aria-hidden>□↑</span> then <span className="text-white font-medium">Add to Home Screen</span>.
          </p>
          <button
            type="button"
            onClick={dismissIos}
            className="self-end px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-500 hover:bg-primary-600 text-white transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  return null;
}
