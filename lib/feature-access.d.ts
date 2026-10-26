export const FEATURES: {
  CERTIFICATES: boolean;
  COMMUNITY: boolean;
  EXPERT_CONSULTATION: boolean;
};

export type FeatureKey = 'CERTIFICATES' | 'COMMUNITY' | 'EXPERT_CONSULTATION';

export function isCertificatesPath(pathname: string): boolean;
export function isCommunityPath(pathname: string): boolean;
export function isExpertConsultationPath(pathname: string): boolean;
export function isFeaturePathBlocked(pathname: string, features?: { [key: string]: boolean }): boolean;
export function isFeatureApiBlocked(pathname: string, features?: { [key: string]: boolean }): boolean;
export function isNavHrefDisabled(href: string, features?: { [key: string]: boolean }): boolean;
