import { useEffect, useRef, useState } from 'react';
import { getClientAdsConfig } from '@/lib/ads-config';
import { PropellerAdSlot } from '@/components/ads/PropellerAdSlot';
import type { PropellerPlacement } from '@/lib/propeller-ads-placements';

function loadAdsenseScript(client: string, onLoad: () => void) {
  if (typeof document === 'undefined') return;
  const already = Array.from(document.scripts).some((s) => s.getAttribute('data-forexorbit-adsense') === client);
  if (already) {
    onLoad();
    return;
  }
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  s.crossOrigin = 'anonymous';
  s.setAttribute('data-forexorbit-adsense', client);
  s.onload = () => onLoad();
  document.head.appendChild(s);
}

type Props = {
  className?: string;
  slot?: string;
  format?: 'horizontal' | 'rectangle' | 'vertical';
  propellerPlacement?: PropellerPlacement;
};

/**
 * Banner for free first lessons & demo tasks. Providers: propellerads, adsense, admob.
 */
export function ContentAdBanner({
  className = '',
  slot,
  format = 'horizontal',
  propellerPlacement = 'freeLessonTop',
}: Props) {
  const cfg = getClientAdsConfig();
  const insRef = useRef<HTMLModElement>(null);
  const pushedRef = useRef(false);
  const [ready, setReady] = useState(false);

  const client = cfg.adsenseClient;
  const adSlot = slot || cfg.adsenseBannerSlot || cfg.admobBannerSlot;

  useEffect(() => {
    if (cfg.provider === 'propellerads' || !cfg.enabled) return;
    if (cfg.provider !== 'adsense' || !client || !adSlot) return;
    loadAdsenseScript(client, () => setReady(true));
  }, [cfg.enabled, cfg.provider, client, adSlot]);

  useEffect(() => {
    if (cfg.provider === 'propellerads' || cfg.provider !== 'adsense') return;
    if (!ready || !insRef.current || !adSlot || pushedRef.current || !client) return;
    try {
      pushedRef.current = true;
      const w = window as unknown as { adsbygoogle?: unknown[] };
      w.adsbygoogle = w.adsbygoogle || [];
      w.adsbygoogle.push({});
    } catch {
      pushedRef.current = false;
    }
  }, [ready, adSlot, client, cfg.provider]);

  if (cfg.provider === 'propellerads') {
    if (!cfg.enabled) return null;
    const minH = format === 'rectangle' ? 'min-h-[250px]' : 'min-h-[120px]';
    return <PropellerAdSlot placement={propellerPlacement} className={className} minHeightClass={minH} />;
  }

  if (!cfg.enabled || !adSlot) {
    return null;
  }

  if (cfg.provider === 'adsense' && client) {
    const minH = format === 'horizontal' ? 'min-h-[90px]' : 'min-h-[250px]';
    return (
      <div
        className={`w-full overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50/80 dark:border-gray-600 dark:bg-gray-800/50 ${minH} ${className}`}
        aria-label="Advertisement"
      >
        <ins
          ref={insRef}
          className="adsbygoogle block w-full"
          style={{ display: 'block' }}
          data-ad-client={client}
          data-ad-slot={adSlot}
          data-ad-format={format}
          data-full-width-responsive="true"
        />
      </div>
    );
  }

  if (cfg.provider === 'admob') {
    return (
      <div
        className={`w-full rounded-xl border border-dashed border-gray-300 bg-gray-50/80 p-4 text-center text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-300 ${className}`}
        aria-label="Advertisement"
      >
        <p className="font-medium text-gray-800 dark:text-gray-100">Sponsored</p>
        <p className="mt-1 text-xs">Use PropellerAds or AdSense on web (see .env.example).</p>
      </div>
    );
  }

  return null;
}
