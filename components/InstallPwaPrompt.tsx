import { useEffect, useState, useCallback, useRef } from 'react';
import { usePwaInstall } from '@/contexts/PwaInstallContext';

const DISMISS_CHROME_KEY = 'forexorbit-pwa-chrome-v2';
const DISMISS_IOS_KEY = 'forexorbit-pwa-ios-v2';
const DISMISS_FALLBACK_KEY = 'forexorbit-pwa-fallback-v2';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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
  const iOS =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function isSecureEnough(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

/**
 * Auto nudges + fallback copy. Native install uses PwaInstallContext (same deferred prompt as header button).
 */
export function InstallPwaPrompt() {
  const { canShowInstallUi, nativeInstallAvailable, promptNativeInstall, busy } = usePwaInstall();
  const [showChrome, setShowChrome] = useState(false);
  const [showIos, setShowIos] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const chromeOfferedRef = useRef(false);
  const iosShownRef = useRef(false);
  const nativeRef = useRef(false);
  useEffect(() => {
    nativeRef.current = nativeInstallAvailable;
  }, [nativeInstallAvailable]);

  useEffect(() => {
    if (!canShowInstallUi) return;
    if (nativeInstallAvailable && !isDismissed(DISMISS_CHROME_KEY)) {
      setShowChrome(true);
      chromeOfferedRef.current = true;
      setShowFallback(false);
    }
    if (!nativeInstallAvailable) {
      setShowChrome(false);
    }
  }, [canShowInstallUi, nativeInstallAvailable]);

  const dismissChromeBanner = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_CHROME_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShowChrome(false);
  }, []);

  const dismissIos = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_IOS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShowIos(false);
  }, []);

  const dismissFallback = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_FALLBACK_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShowFallback(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isSecureEnough() || isStandalone()) return;

    const iosTimer = window.setTimeout(() => {
      if (isStandalone() || chromeOfferedRef.current || nativeRef.current) return;
      if (!isIosSafari() || isDismissed(DISMISS_IOS_KEY)) return;
      iosShownRef.current = true;
      setShowIos(true);
    }, 4000);

    const fallbackTimer = window.setTimeout(() => {
      if (isStandalone()) return;
      if (isDismissed(DISMISS_FALLBACK_KEY)) return;
      if (chromeOfferedRef.current || iosShownRef.current || nativeRef.current) return;
      setShowFallback(true);
    }, 9000);

    return () => {
      window.clearTimeout(iosTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  const onInstallClick = async () => {
    const ok = await promptNativeInstall();
    if (ok) dismissChromeBanner();
  };

  if (canShowInstallUi && showChrome && nativeInstallAvailable) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] p-3 sm:p-4 flex justify-center pointer-events-none"
        role="dialog"
        aria-label="Install app"
      >
        <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-emerald-500/40 bg-[#283d3b] text-[#edddd4] shadow-2xl px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm sm:text-base">Install ForexOrbit</p>
            <p className="text-xs sm:text-sm text-nav-muted mt-0.5">
              Your browser is ready — add the app for quicker access and offline support. You can also use{' '}
              <strong className="text-nav-text">Install app</strong> in the header.
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-2 sm:gap-2">
            <button
              type="button"
              onClick={dismissChromeBanner}
              className="px-3 py-2 rounded-lg text-sm font-medium text-nav-muted hover:bg-white/10 transition-colors"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={onInstallClick}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-60 transition-colors min-h-[44px]"
            >
              {busy ? '…' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (canShowInstallUi && showIos) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] p-3 sm:p-4 flex justify-center pointer-events-none"
        role="dialog"
        aria-label="Add to home screen"
      >
        <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-white/15 bg-[#283d3b] text-[#edddd4] shadow-2xl px-4 py-3 sm:px-5 sm:py-4 flex flex-col gap-2">
          <p className="font-semibold text-white text-sm sm:text-base">Install on iPhone / iPad</p>
          <p className="text-xs sm:text-sm text-nav-muted">
            Tap <span className="text-white font-medium">Share</span> then{' '}
            <span className="text-white font-medium">Add to Home Screen</span>. Or use{' '}
            <span className="text-white font-medium">Install app</span> in the header for steps.
          </p>
          <button
            type="button"
            onClick={dismissIos}
            className="self-end px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-500 hover:bg-primary-600 text-white transition-colors min-h-[44px]"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  if (canShowInstallUi && showFallback) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] p-3 sm:p-4 flex justify-center pointer-events-none"
        role="dialog"
        aria-label="Install web app"
      >
        <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-white/15 bg-[#1e2d2b] text-[#edddd4] shadow-2xl px-4 py-3 sm:px-5 sm:py-4">
          <p className="font-semibold text-white text-sm sm:text-base">Get the ForexOrbit app</p>
          <p className="text-xs sm:text-sm text-nav-muted mt-1 leading-relaxed">
            Use the <strong className="text-nav-text">Install app</strong> button in the header, or: Chrome / Edge →
            menu (⋮) → Install app. Safari (iPhone) → Share → Add to Home Screen.
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={dismissFallback}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary-500 hover:bg-primary-600 text-white transition-colors min-h-[44px]"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
