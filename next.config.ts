import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  /* better-sqlite3 is a native module and must not be bundled. */
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    /* Evidence uploads arrive as multipart bodies and are not small. */
    serverActions: { bodySizeLimit: '64mb' },
  },
}

export default config
