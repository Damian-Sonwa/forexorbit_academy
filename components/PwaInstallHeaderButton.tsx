import { usePwaInstall } from '@/contexts/PwaInstallContext';

/**
 * Visible “Install app” control for header (mobile + desktop). Uses deferred beforeinstallprompt when available.
 */
export function PwaInstallHeaderButton() {
  const {
    canShowInstallUi,
    nativeInstallAvailable,
    busy,
    promptNativeInstall,
    openManualInstallModal,
  } = usePwaInstall();

  if (!canShowInstallUi) return null;

  const onClick = async () => {
    if (nativeInstallAvailable) {
      await promptNativeInstall();
    } else {
      openManualInstallModal();
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={
        nativeInstallAvailable
          ? 'Add ForexOrbit to your device'
          : 'How to install ForexOrbit (browser menu or Share → Add to Home Screen)'
      }
      className="relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-nav-text bg-primary-600/90 hover:bg-primary-500 border border-primary-400/40 transition-colors disabled:opacity-60 whitespace-nowrap"
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
      {nativeInstallAvailable && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#283d3b]" />
      )}
    </button>
  );
}
