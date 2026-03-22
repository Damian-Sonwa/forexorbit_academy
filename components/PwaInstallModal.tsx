/**
 * PWA install prompt as a centered modal (Chromium: beforeinstallprompt).
 * iOS Safari: no BIP — optional one-time “Add to Home Screen” hint.
 */

import { usePwaInstall } from '@/contexts/PwaInstallContext';
import { useCallback, useEffect, useState } from 'react';

const IOS_HINT_KEY = 'forexorbit-pwa-ios-hint-dismissed';
const IOS_HINT_DELAY_MS = 4500;

function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function PwaInstallModal() {
  const {
    canShowInstallUi,
    nativeInstallAvailable,
    busy,
    promptNativeInstall,
    dismissDeferredPrompt,
  } = usePwaInstall();

  const [iosHintOpen, setIosHintOpen] = useState(false);

  const showChromiumModal = canShowInstallUi && nativeInstallAvailable;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (showChromiumModal || iosHintOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [showChromiumModal, iosHintOpen]);

  useEffect(() => {
    if (!canShowInstallUi || nativeInstallAvailable) return;
    if (!isIOSDevice()) return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(IOS_HINT_KEY)) return;

    const t = window.setTimeout(() => {
      setIosHintOpen(true);
    }, IOS_HINT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [canShowInstallUi, nativeInstallAvailable]);

  const dismissIosHint = useCallback(() => {
    try {
      localStorage.setItem(IOS_HINT_KEY, '1');
    } catch {
      /* ignore quota */
    }
    setIosHintOpen(false);
  }, []);

  const handleInstall = useCallback(() => {
    void promptNativeInstall();
  }, [promptNativeInstall]);

  const handleNotNow = useCallback(() => {
    dismissDeferredPrompt();
  }, [dismissDeferredPrompt]);

  if (!canShowInstallUi) return null;

  return (
    <>
      {showChromiumModal && (
        <div
          className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center p-0 sm:p-4"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
            aria-label="Close install dialog"
            onClick={handleNotNow}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-title"
            className="relative z-10 w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-gray-900 dark:ring-1 dark:ring-white/10 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h2 id="pwa-install-title" className="text-center text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
              Install ForexOrbit Academy
            </h2>
            <p className="mt-2 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-300 sm:text-base">
              Install ForexOrbit Academy on your device for quick access, offline-friendly browsing, and a focused
              learning experience.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:justify-stretch">
              <button
                type="button"
                disabled={busy}
                onClick={handleInstall}
                className="min-h-[48px] flex-1 rounded-xl bg-primary-600 px-4 py-3 text-base font-semibold text-white shadow-md transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 touch-manipulation"
              >
                {busy ? 'Opening…' : 'Install App'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleNotNow}
                className="min-h-[48px] flex-1 rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-base font-semibold text-gray-800 transition hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 touch-manipulation"
              >
                Not Now
              </button>
            </div>
          </div>
        </div>
      )}

      {iosHintOpen && !showChromiumModal && (
        <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center p-0 sm:p-4" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
            aria-label="Dismiss"
            onClick={dismissIosHint}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-ios-title"
            className="relative z-10 w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-gray-900 dark:ring-1 dark:ring-white/10 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pwa-ios-title" className="text-center text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
              Add to Home Screen
            </h2>
            <p className="mt-2 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              On iPhone or iPad, tap the <strong className="font-semibold text-gray-800 dark:text-gray-100">Share</strong>{' '}
              button <span className="inline-block align-middle">(□↑)</span>, then{' '}
              <strong className="font-semibold text-gray-800 dark:text-gray-100">Add to Home Screen</strong> to install
              ForexOrbit Academy like an app.
            </p>
            <button
              type="button"
              onClick={dismissIosHint}
              className="mt-6 w-full min-h-[48px] rounded-xl bg-primary-600 px-4 py-3 text-base font-semibold text-white shadow-md transition hover:bg-primary-700 touch-manipulation"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
