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
  // NEXT_PUBLIC_SOCKET_URL and NEXT_PUBLIC_API_BASE_URL select this build's
  // backend. Neither falls back to a hard-coded production host.
  // AI_API_KEY stays server-only.
  // Agora readiness is determined by the token API response.
  async headers() {
    return [
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
