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
  env: {
    // Same DB string as .env.local; supports either name (Render/Vercel/Atlas often use MONGODB_URI).
    MONGO_URI: process.env.MONGO_URI || process.env.MONGODB_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    // NOTE: Socket.IO URL is hardcoded in useSocket.ts to always use Render backend
    // NOTE: NEXT_PUBLIC_AGORA_APP_ID is NOT exposed to client
    // Frontend determines readiness solely by token API response
    // CRITICAL: AI_API_KEY is NEVER exposed to frontend - only used on Render backend
  },
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
