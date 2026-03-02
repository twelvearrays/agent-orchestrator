const seen = new Map<string, number>();
const WINDOW_MS = 5_000;

export function isDuplicate(key: string): boolean {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < WINDOW_MS) return true;
  seen.set(key, now);
  return false;
}

export function cleanup(): void {
  const now = Date.now();
  for (const [key, ts] of seen) {
    if (now - ts > WINDOW_MS * 2) seen.delete(key);
  }
}
