/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    domains: ['profile.line-scdn.net'],
  },
}

module.exports = nextConfig
