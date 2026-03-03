"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import type { DashboardSession } from "@/lib/types";
import { type MetricsSnapshot, computeMetricsSnapshot, formatDuration } from "@/lib/metrics";

const RING_BUFFER_SIZE = 30; // 30 data points
const SNAPSHOT_INTERVAL = 60_000; // 60 seconds

interface MetricsResult {
  current: MetricsSnapshot;
  history: MetricsSnapshot[];
  activeHistory: number[];
  prHistory: number[];
  formattedMedianTTM: string | null;
}

export function useMetrics(sessions: DashboardSession[]): MetricsResult {
  const ringBuffer = useRef<MetricsSnapshot[]>([]);
  const [history, setHistory] = useState<MetricsSnapshot[]>([]);

  const current = useMemo(() => computeMetricsSnapshot(sessions), [sessions]);

  const captureSnapshot = useCallback(() => {
    const snapshot = computeMetricsSnapshot(sessions);
    const buf = ringBuffer.current;
    buf.push(snapshot);
    if (buf.length > RING_BUFFER_SIZE) {
      buf.shift();
    }
    setHistory([...buf]);
  }, [sessions]);

  // Capture initial snapshot + periodic snapshots
  useEffect(() => {
    captureSnapshot();
    const id = setInterval(captureSnapshot, SNAPSHOT_INTERVAL);
    return () => clearInterval(id);
  }, [captureSnapshot]);

  const activeHistory = useMemo(
    () => history.map((s) => s.activeAgents),
    [history],
  );

  const prHistory = useMemo(
    () => history.map((s) => s.openPRs),
    [history],
  );

  const formattedMedianTTM = useMemo(
    () => current.medianTimeToMerge !== null ? formatDuration(current.medianTimeToMerge) : null,
    [current.medianTimeToMerge],
  );

  return {
    current,
    history,
    activeHistory,
    prHistory,
    formattedMedianTTM,
  };
}
