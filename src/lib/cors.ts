/**
 * Shared CORS helper for /api/public/* endpoints — the marketing site
 * (stewardshipcre.com) calls these cross-origin.
 */

const ALLOWED_ORIGINS = [
  "https://stewardshipcre.com",
  "https://www.stewardshipcre.com",
  "http://localhost:3000",
  "http://localhost:3001",
];

export function corsHeaders(origin: string | null, extra: Record<string, string> = {}): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}
