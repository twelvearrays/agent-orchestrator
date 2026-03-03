/**
 * Client-side metrics computation from DashboardSession data.
 *
 * All metrics are derived from existing session data — no API calls.
 * Sparkline data is maintained via a ring buffer that captures
 * snapshots every 60 seconds (lost on page refresh).
 */

import {
  type DashboardSession,
  type MetricsSnapshot,
  TERMINAL_STATUSES,
  TERMINAL_ACTIVITIES,
} from "./types";

export type { MetricsSnapshot } from "./types";

export function computeMetricsSnapshot(sessions: DashboardSession[]): MetricsSnapshot {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let activeAgents = 0;
  let openPRs = 0;
  let mergedToday = 0;
  const mergeTimes: number[] = [];

  for (const s of sessions) {
    const isTerminal =
      TERMINAL_STATUSES.has(s.status) ||
      (s.activity !== null && TERMINAL_ACTIVITIES.has(s.activity));

    if (!isTerminal) {
      activeAgents++;
    }

    if (s.pr) {
      if (s.pr.state === "open") openPRs++;
      if (s.pr.state === "merged") {
        // Approximate: use lastActivityAt as merge time
        const mergeTime = new Date(s.lastActivityAt).getTime();
        if (mergeTime >= todayStart.getTime()) {
          mergedToday++;
        }
        // Compute time-to-merge: created → lastActivity (merge time)
        const created = new Date(s.createdAt).getTime();
        if (created > 0 && mergeTime > created) {
          mergeTimes.push(mergeTime - created);
        }
      }
    }
  }

  return {
    activeAgents,
    totalAgents: sessions.length,
    openPRs,
    mergedToday,
    medianTimeToMerge: computeMedian(mergeTimes),
    timestamp: now,
  };
}

export function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeTimeToMerge(session: DashboardSession): number | null {
  if (session.pr?.state !== "merged") return null;
  const created = new Date(session.createdAt).getTime();
  const merged = new Date(session.lastActivityAt).getTime();
  if (isNaN(created) || isNaN(merged) || merged <= created) return null;
  return merged - created;
}

export function computeThroughput(sessions: DashboardSession[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return sessions.filter((s) => {
    if (s.pr?.state !== "merged") return false;
    const merged = new Date(s.lastActivityAt).getTime();
    return merged >= cutoff;
  }).length;
}

/**
 * Format milliseconds as a human-readable duration.
 * e.g., 3600000 → "1h", 5400000 → "1.5h", 300000 → "5m"
 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`;
}
