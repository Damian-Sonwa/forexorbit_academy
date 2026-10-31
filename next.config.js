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
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), browsing-topics=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
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
