/**
 * Server configuration.
 *
 * Ascend binds to loopback only. It is a personal, local-first application
 * (spec §2, §63) and it holds a Codeforces session cookie, so it must never be
 * reachable from the network.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: intFromEnv('ASCEND_PORT', 5174),
  /** Loopback only, deliberately not configurable to 0.0.0.0. */
  host: '127.0.0.1',
  isProduction: process.env['NODE_ENV'] === 'production',
  /** Vite dev server origin, allowed through CORS during development. */
  devOrigin: process.env['ASCEND_DEV_ORIGIN'] ?? 'http://localhost:5173',
} as const;
