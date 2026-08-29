import type { NextConfig } from 'next'

const config: NextConfig = {
  /**
   * Production builds write somewhere else.
   *
   * A production build shares .next with a running dev server and overwrites
   * the artefacts it is serving from. The dev server does not fail cleanly when
   * that happens: it throws MODULE_NOT_FOUND on _document.js and a React client
   * manifest error, which look like application faults and are not. It then
   * recovers by recompiling, so the damage is intermittent and lands on
   * whichever page happened to be requested first.
   *
   * Set NEXT_DIST_DIR to keep the two apart. The build and lighthouse scripts
   * do; the dev server does not, so it keeps .next to itself.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
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
