import { usePwaInstall } from '@/contexts/PwaInstallContext';

/**
 * “Install app” — only shown when the browser has fired beforeinstallprompt (installable PWA).
 * Click calls deferredPrompt.prompt() directly (native install sheet).
 */
export function PwaInstallHeaderButton() {
  const { canShowInstallUi, nativeInstallAvailable, busy, promptNativeInstall } = usePwaInstall();

  if (!canShowInstallUi || !nativeInstallAvailable) return null;

  return (
    <button
      id="installBtn"
      type="button"
      aria-label="Install ForexOrbit Academy"
      onClick={() => void promptNativeInstall()}
      disabled={busy}
      title="Install app"
      className="relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-nav-text bg-primary-600/90 hover:bg-primary-500 border border-primary-400/40 transition-colors disabled:opacity-60 whitespace-nowrap min-h-[44px] min-w-[44px] sm:min-w-0 touch-manipulation"
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
      <span className="hidden sm:inline">Install app</span>
      <span className="sm:hidden">Install</span>
    </button>
  );
}
