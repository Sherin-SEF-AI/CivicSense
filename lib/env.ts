/**
 * NEXT_PUBLIC_* values are inlined at build time, so these constants fold to
 * literals and let the minifier drop fixture-only code paths entirely.
 */
export const DATA_MODE = process.env.NEXT_PUBLIC_DATA_MODE ?? 'live'

export const IS_FIXTURES = DATA_MODE === 'fixtures'

/** Base URL for the typed API client. Fixtures are served from the app itself. */
export const API_BASE = IS_FIXTURES ? '/api/v1' : (process.env.NEXT_PUBLIC_API_BASE ?? '/v1')
