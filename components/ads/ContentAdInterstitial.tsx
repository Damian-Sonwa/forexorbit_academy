import { useEffect, useState } from 'react';
import { ContentAdBanner } from '@/components/ads/ContentAdBanner';
import { getClientAdsConfig } from '@/lib/ads-config';

type Props = {
  /** sessionStorage key — one show per tab session */
  storageKey: string;
  enabled: boolean;
};

/**
 * Lightweight interstitial: large banner in a dismissible overlay (web-friendly vs native full-screen AdMob).
 */
export function ContentAdInterstitial({ storageKey, enabled }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (!getClientAdsConfig().enabled) return;
    try {
      if (sessionStorage.getItem(storageKey) === '1') return;
      sessionStorage.setItem(storageKey, '1');
      setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [enabled, storageKey]);

  if (!enabled || !open) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-end justify-center sm:items-center bg-black/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Advertisement"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-900">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Advertisement</p>
        <ContentAdBanner className="mb-4" format="rectangle" propellerPlacement="interstitial" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-700"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
