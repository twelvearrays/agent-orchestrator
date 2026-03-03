/**
 * Shared auth utilities for cookie-based password protection.
 *
 * All hashing uses the Web Crypto API (Edge Runtime compatible).
 * If AUTH_PASSWORD is unset, auth is disabled (local dev convenience).
 */

export const COOKIE_NAME = "ao_session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

export function isAuthEnabled(): boolean {
  return !!process.env.AUTH_PASSWORD;
}

export async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function deriveToken(password: string): Promise<string> {
  return sha256("ao-auth:" + password);
}

export async function verifyToken(token: string, password: string): Promise<boolean> {
  const expected = await deriveToken(password);
  if (token.length !== expected.length) return false;
  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
