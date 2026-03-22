/**
 * Central feature flags — flip to `true` to re-enable without removing code.
 */
export const FEATURES = {
  CERTIFICATES: false,
  COMMUNITY: false,
  EXPERT_CONSULTATION: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isCertificatesPath(pathname: string): boolean {
  return pathname === '/certificates' || pathname.startsWith('/certificates/');
}

export function isCommunityPath(pathname: string): boolean {
  return pathname === '/community' || pathname.startsWith('/community/');
}

/** Student/instructor expert flows; `/consultations/admin` stays reachable for superadmin tooling. */
export function isExpertConsultationPath(pathname: string): boolean {
  if (!pathname.startsWith('/consultations')) return false;
  if (pathname === '/consultations/admin' || pathname.startsWith('/consultations/admin/')) {
    return false;
  }
  return true;
}

/** Block document navigation to disabled product areas (used by middleware). */
export function isFeaturePathBlocked(pathname: string): boolean {
  if (!FEATURES.CERTIFICATES && isCertificatesPath(pathname)) return true;
  if (!FEATURES.COMMUNITY && isCommunityPath(pathname)) return true;
  if (!FEATURES.EXPERT_CONSULTATION && isExpertConsultationPath(pathname)) return true;
  return false;
}

/** Disable sidebar/header links that point at a blocked area (href may include `?query`). */
export function isNavHrefDisabled(href: string): boolean {
  const path = href.split('?')[0];
  return isFeaturePathBlocked(path);
}
