import type { NextConfig } from 'next'

const FIXTURES = (process.env.NEXT_PUBLIC_DATA_MODE ?? 'fixtures') === 'fixtures'

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  env: {
    NEXT_PUBLIC_DATA_MODE: process.env.NEXT_PUBLIC_DATA_MODE ?? 'fixtures',
  },

  /**
   * In a live build the fixture world is replaced with a stub.
   *
   * The route handlers already answer 404 before reaching their dynamic imports,
   * but server code reads process.env at runtime, so the bundler cannot prove
   * those imports unreachable and would ship the entire fixture world anyway.
   * Replacing the modules makes the exclusion real rather than nominal, and
   * scripts/check-bundle.mjs asserts the outcome.
   */
  webpack(webpackConfig, { webpack }) {
    if (!FIXTURES) {
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/lib[\\/]fixtures[\\/](?!disabled)/, (resource: { request: string }) => {
          resource.request = '@/lib/fixtures/disabled/stub'
        }),
      )
    }
    return webpackConfig
  },
}

export default config
