/**
 * Stands in for every fixture module in a live build.
 *
 * The route handlers answer 404 before they reach a dynamic import, so nothing
 * here is ever executed. It exists so the fixture world is genuinely absent from
 * the shipped bundle rather than merely unreachable inside it.
 */
export function fixturesUnavailable(): never {
  throw new Error('fixture modules are not available in a live build')
}

export const getWorld = fixturesUnavailable
export const liveIncidents = fixturesUnavailable
export const withMutations = fixturesUnavailable
export const countsByBand = fixturesUnavailable
export const buildPackage = fixturesUnavailable
export const buildForensics = fixturesUnavailable
export const buildAnalytics = fixturesUnavailable
export const answerQuery = fixturesUnavailable
export const evidenceForIncident = fixturesUnavailable
export const parseQuery = fixturesUnavailable
export const scoreItem = fixturesUnavailable
export const seriesFor = fixturesUnavailable
export const buildRisk = fixturesUnavailable
export const getHub = fixturesUnavailable
export const startTicker = fixturesUnavailable
export const scheduleStop = fixturesUnavailable
export const mulberry32 = fixturesUnavailable
export const subSeed = fixturesUnavailable
export const intRange = fixturesUnavailable
export const range = fixturesUnavailable
export const pick = fixturesUnavailable
export const WORLD_SEED = 0
