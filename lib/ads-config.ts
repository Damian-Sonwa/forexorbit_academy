/**
 * Client-side ad configuration (NEXT_PUBLIC_* only).
 */

import { isPropellerAdsConfigured } from '@/lib/propeller-ads-placements';

export type AdsProvider = 'adsense' | 'admob' | 'propellerads' | 'none';

export function getClientAdsConfig(): {
  enabled: boolean;
  provider: AdsProvider;
  adsenseClient?: string;
  adsenseBannerSlot?: string;
  admobBannerSlot?: string;
} {
  if (typeof window === 'undefined') {
    return { enabled: false, provider: 'none' };
  }
  if (process.env.NEXT_PUBLIC_ADS_ENABLED === 'false') {
    return { enabled: false, provider: 'none' };
  }

  const raw = (process.env.NEXT_PUBLIC_ADS_PROVIDER || 'none').toLowerCase();
  const provider = raw as AdsProvider;
  const safeProvider: AdsProvider =
    provider === 'adsense' || provider === 'admob' || provider === 'propellerads' ? provider : 'none';

  if (safeProvider === 'none') {
    return { enabled: false, provider: 'none' };
  }

  if (safeProvider === 'propellerads') {
    return {
      enabled: isPropellerAdsConfigured(),
      provider: 'propellerads',
    };
  }

  return {
    enabled: true,
    provider: safeProvider,
    adsenseClient: process.env.NEXT_PUBLIC_ADSENSE_CLIENT || undefined,
    adsenseBannerSlot: process.env.NEXT_PUBLIC_ADSENSE_BANNER_SLOT || undefined,
    admobBannerSlot: process.env.NEXT_PUBLIC_ADMOB_WEB_BANNER_SLOT || undefined,
  };
}
