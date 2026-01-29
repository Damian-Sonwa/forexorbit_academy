/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    // NOTE: Socket.IO URL is hardcoded in useSocket.ts to always use Render backend
    // NOTE: NEXT_PUBLIC_AGORA_APP_ID is NOT exposed to client
    // Frontend determines readiness solely by token API response
    // CRITICAL: AI_API_KEY is NEVER exposed to frontend - only used on Render backend
  },
}

module.exports = nextConfig
