// API-key resolution — picks an API key from request header or env var per the user-keys config flag.

import { NextRequest } from 'next/server';

/**
 * Resolves an API key from either the request header or env var.
 * When NEXT_PUBLIC_USER_API_KEYS=true, only the header is used — env vars are ignored.
 * When disabled/unset, only the env var is used.
 */
export function resolveKey(
  req: NextRequest,
  headerName: string,
  envName: string,
): string | null {
  const userKeysMode = process.env.NEXT_PUBLIC_USER_API_KEYS === 'true';

  if (userKeysMode) {
    return req.headers.get(headerName) || null;
  }

  return process.env[envName] || null;
}
