/**
 * Feature flags shared by pages and APIs.
 * Page navigation redirects. Blocked APIs return 404.
 * Community and expert consultation are available.
 * Certificates stay hidden.
 * /consultations/admin and /api/consultations/admin stay outside the consultation flag.
 */

const FEATURES = {
  CERTIFICATES: false,
  COMMUNITY: true,
  EXPERT_CONSULTATION: true,
};

function pathOnly(value) {
  return typeof value === 'string' ? value.split('?')[0] : '';
}

function isCertificatesPath(pathname) {
  const path = pathOnly(pathname);
  return path === '/certificates' || path.startsWith('/certificates/');
}

function isCommunityPath(pathname) {
  const path = pathOnly(pathname);
  return path === '/community' || path.startsWith('/community/');
}

function isExpertConsultationPath(pathname) {
  const path = pathOnly(pathname);
  if (!path.startsWith('/consultations')) return false;
  if (path === '/consultations/admin' || path.startsWith('/consultations/admin/')) return false;
  return true;
}

function isFeaturePathBlocked(pathname, features) {
  const flags = features || FEATURES;
  if (!flags.CERTIFICATES && isCertificatesPath(pathname)) return true;
  if (!flags.COMMUNITY && isCommunityPath(pathname)) return true;
  if (!flags.EXPERT_CONSULTATION && isExpertConsultationPath(pathname)) return true;
  return false;
}

function isFeatureApiBlocked(pathname, features) {
  const flags = features || FEATURES;
  const path = pathOnly(pathname);
  if (!flags.COMMUNITY && (path === '/api/community' || path.startsWith('/api/community/'))) return true;
  if (!flags.CERTIFICATES && (path === '/api/certificates' || path.startsWith('/api/certificates/'))) return true;
  if (!flags.EXPERT_CONSULTATION && (path === '/api/consultations' || path.startsWith('/api/consultations/'))) {
    if (path === '/api/consultations/admin' || path.startsWith('/api/consultations/admin/')) return false;
    return true;
  }
  return false;
}

function isNavHrefDisabled(href, features) {
  return isFeaturePathBlocked(pathOnly(href), features);
}

module.exports = {
  FEATURES,
  isCertificatesPath,
  isCommunityPath,
  isExpertConsultationPath,
  isFeaturePathBlocked,
  isFeatureApiBlocked,
  isNavHrefDisabled,
};
