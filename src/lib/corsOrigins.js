const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'https://photostorage313ceie3ryb-container-photo-storage-backend.functions.fnc.fr-par.scw.cloud',
];

/**
 * Origins allowed for cross-origin API access (e.g. third-party static hosts).
 * Same-origin requests to /api/* do not need CORS. Comma-separated list in CORS_ORIGINS.
 */
export function corsOriginList() {
  const raw = process.env.CORS_ORIGINS || process.env.PROD_CORS_ORIGINS;
  if (raw && raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_ORIGINS;
}
