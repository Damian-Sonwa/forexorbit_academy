/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000',
    // NOTE: NEXT_PUBLIC_AGORA_APP_ID is NOT exposed to client
    // Frontend determines readiness solely by token API response
  },
}

module.exports = nextConfig
