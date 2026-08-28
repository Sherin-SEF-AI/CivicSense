/**
 * The API base.
 *
 * The application serves its own API from the same origin. The variable exists
 * so the console can be pointed at a separate deployment of the backend without
 * touching any code.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1'

/** Dev-only surfaces are hidden outside development. */
export const IS_DEV = process.env.NODE_ENV !== 'production'
