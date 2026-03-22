/**
 * PropellerAds placement map — tune zones/scripts per surface without code changes.
 * Each placement can use either a standalone widget script URL (from Propeller dashboard)
 * or a shared engine + zone id (ins data-zoneid), depending on what Propeller issued.
 */

export type PropellerPlacement =
  | 'freeLessonTop'
  | 'freeLessonInline'
  | 'demoTasksBanner'
  | 'interstitial';

export type PropellerPlacementConfig =
  | {
      mode: 'script';
      /** Full script URL from Propeller “Get code” (loads the creative into this container). */
      scriptSrc: string;
    }
  | {
      mode: 'ins';
      /** Shared async library, e.g. tag engine (loaded once per page). */
      librarySrc: string;
      zoneId: string;
      /** Optional class Propeller assigns to the ins element (paste from dashboard). */
      insClass?: string;
    };

function trim(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t || undefined;
}

/**
 * Resolve env for a logical placement. Specific env wins; then shared defaults.
 */
export function getPropellerPlacementConfig(placement: PropellerPlacement): PropellerPlacementConfig | null {
  const sharedScript = trim(process.env.NEXT_PUBLIC_PROPELLERADS_WIDGET_SCRIPT_URL);
  const sharedLib = trim(process.env.NEXT_PUBLIC_PROPELLERADS_LIBRARY_SCRIPT_URL);
  const sharedZone = trim(process.env.NEXT_PUBLIC_PROPELLERADS_ZONE_ID);

  const per: Record<
    PropellerPlacement,
    { script?: string; lib?: string; zone?: string; insClass?: string }
  > = {
    freeLessonTop: {
      script: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_TOP_SCRIPT),
      lib: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_TOP_LIB),
      zone: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_TOP_ZONE),
      insClass: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_TOP_INS_CLASS),
    },
    freeLessonInline: {
      script: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_INLINE_SCRIPT),
      lib: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_INLINE_LIB),
      zone: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_INLINE_ZONE),
      insClass: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_LESSON_INLINE_INS_CLASS),
    },
    demoTasksBanner: {
      script: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_DEMO_TASKS_SCRIPT),
      lib: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_DEMO_TASKS_LIB),
      zone: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_DEMO_TASKS_ZONE),
      insClass: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_DEMO_TASKS_INS_CLASS),
    },
    interstitial: {
      script: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_INTERSTITIAL_SCRIPT),
      lib: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_INTERSTITIAL_LIB),
      zone: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_INTERSTITIAL_ZONE),
      insClass: trim(process.env.NEXT_PUBLIC_PROP_PLACEMENT_INTERSTITIAL_INS_CLASS),
    },
  };

  const p = per[placement];
  /** One dashboard widget URL can back all surfaces until you set per-placement scripts. */
  const scriptSrc = p.script || sharedScript;
  if (scriptSrc) {
    return { mode: 'script', scriptSrc };
  }

  const librarySrc = p.lib || sharedLib;
  const zoneId = p.zone || sharedZone;
  if (librarySrc && zoneId) {
    return { mode: 'ins', librarySrc, zoneId, insClass: p.insClass };
  }

  return null;
}

export function isPropellerAdsConfigured(): boolean {
  const keys: PropellerPlacement[] = [
    'freeLessonTop',
    'freeLessonInline',
    'demoTasksBanner',
    'interstitial',
  ];
  return keys.some((k) => getPropellerPlacementConfig(k) != null);
}
