/**
 * Feature flags. Implementation lives in lib/feature-access.js so tests and middleware share it.
 */
export {
  FEATURES,
  isCertificatesPath,
  isCommunityPath,
  isExpertConsultationPath,
  isFeaturePathBlocked,
  isFeatureApiBlocked,
  isNavHrefDisabled,
} from '../feature-access';
export type { FeatureKey } from '../feature-access';
