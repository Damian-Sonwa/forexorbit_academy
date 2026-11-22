const fs = require('fs');
const path = require('path');

const swSrc = path.join(__dirname, 'src', 'service-worker.js');
const swDest = path.join(__dirname, 'public', 'service-worker.js');
try {
  if (fs.existsSync(swSrc)) {
    fs.copyFileSync(swSrc, swDest);
  }
} catch (e) {
  console.warn('[ForexOrbit PWA] Could not copy service-worker.js to public:', e.message);
}

/**
 * Security headers on every response. Only directives that cannot block the site's own content:
 * the page cannot be framed by another site (clickjacking), plugins and <base> rewriting are off,
 * MIME sniffing is off, referrers are trimmed across origins, HTTPS is remembered, and only this
 * site may use the camera and microphone (consultation calls). Script and style sources are not
 * restricted yet: the site loads Paystack, fonts, ads, video and call SDKs, and an enforced
 * script policy needs a browser-tested allowlist first (docs/audits/phase-1-3-remediation.md).
 */
/**
 * Phase 15: the full restrictive policy runs in report-only mode first. Browsers report what it
 * would block to /api/csp-report (logged as counts, no personal data) without blocking anything.
 * Once the reports show only expected sources (Paystack checkout, Agora calls, Cloudinary media,
 * fonts, the configured ad network), move this value into Content-Security-Policy to enforce it
 * (docs/audits/phase-15-production-readiness.md, "CSP rollout"). Ad script hosts are configured by
 * NEXT_PUBLIC_PROPELLERADS_* variables, so they must be added here before enforcing.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.paystack.co https://*.paystack.co https://pagead2.googlesyndication.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.paystack.co",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' wss: https://api.paystack.co https://*.paystack.co https://*.agora.io wss://*.agora.io https://*.sd-rtn.com wss://*.sd-rtn.com https://api.cloudinary.com https://res.cloudinary.com",
  "frame-src 'self' https://*.paystack.co https://checkout.paystack.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  'report-uri /api/csp-report',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), browsing-topics=()' },
];

const { noindexHeaderRules } = require('./lib/seo');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phase 15: do not advertise the framework and version in every response.
  poweredByHeader: false,
  transpilePackages: ['react-quill', 'quill'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**',
      },
    ],
  },
  // MONGO_URI and JWT_SECRET are read from the process environment at runtime
  // (server.js, db/mongoClient.ts, lib/jwt.ts). They must not be listed under
  // `env`: that option inlines values into build output. MONGODB_URI is accepted
  // as an alias by those server readers.
  // The browser calls the API and Socket.IO on its own origin (relative URLs);
  // no NEXT_PUBLIC_ variable selects a backend host.
  // AI_API_KEY stays server-only.
  // Agora readiness is determined by the token API response.
  // Phase 15: /robots.txt and /sitemap.xml are generated from APP_ORIGIN (pages/api/seo/[file].ts).
  async rewrites() {
    return [
      { source: '/robots.txt', destination: '/api/seo/robots' },
      { source: '/sitemap.xml', destination: '/api/seo/sitemap' },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      // Phase 15: private areas are never indexed, even when a link to them leaks (lib/seo.js).
      ...noindexHeaderRules(),
      {
        source: '/service-worker.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
