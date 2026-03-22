import { useEffect, useRef } from 'react';
import {
  getPropellerPlacementConfig,
  type PropellerPlacement,
} from '@/lib/propeller-ads-placements';

function appendScriptOnceToHead(src: string, dedupeKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[data-forexorbit-prop="${dedupeKey}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    s.dataset.forexorbitProp = dedupeKey;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load script'));
    document.head.appendChild(s);
  });
}

type Props = {
  placement: PropellerPlacement;
  className?: string;
  minHeightClass?: string;
};

/**
 * Injects PropellerAds for a placement: either a widget script inside the container,
 * or an ins[data-zoneid] plus a shared library script in document head.
 */
export function PropellerAdSlot({ placement, className = '', minHeightClass = 'min-h-[120px]' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cfg = getPropellerPlacementConfig(placement);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const c = getPropellerPlacementConfig(placement);
    if (!c) return;

    if (c.mode === 'script') {
      const dedupe = `slot-${placement}`;
      const existing = root.querySelector(`script[data-forexorbit-prop-slot="${dedupe}"]`);
      if (!existing) {
        const s = document.createElement('script');
        s.async = true;
        s.src = c.scriptSrc;
        s.dataset.forexorbitPropSlot = dedupe;
        root.appendChild(s);
      }
      return () => {
        root.innerHTML = '';
      };
    }

    const { librarySrc, zoneId, insClass } = c;
    const ins = document.createElement('ins');
    if (insClass) ins.className = insClass;
    ins.setAttribute('data-zoneid', zoneId);
    ins.style.display = 'block';
    ins.style.minHeight = '90px';
    root.appendChild(ins);

    const libKey = `propeller-lib-${librarySrc.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`;
    void appendScriptOnceToHead(librarySrc, libKey).catch(() => {});

    return () => {
      root.innerHTML = '';
    };
  }, [placement]);

  if (!cfg) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className={`w-full overflow-hidden rounded-xl border border-dashed border-gray-300/80 bg-gray-50/90 dark:border-gray-600 dark:bg-gray-800/60 ${minHeightClass} ${className}`}
      aria-label="Advertisement"
    />
  );
}
