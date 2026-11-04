/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    // Disable ESLint during build for faster Docker builds
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Disable type checking during build for faster Docker builds
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
  },
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // Optimize for production
  compress: true,
  // Handle trailing slashes consistently
  trailingSlash: false,
  // Experimental features for better Kubernetes compatibility
  experimental: {
    // Disabled optimizeCss due to build issues with critters module
    // optimizeCss: true,
  },
}

module.exports = nextConfig