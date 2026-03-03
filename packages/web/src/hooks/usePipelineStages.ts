"use client";

import { useMemo } from "react";
import type { DashboardSession } from "@/lib/types";
import { type PipelineStage, getPipelineStage, getStageOrder } from "@/lib/pipeline";

export interface PipelineGroup {
  stage: PipelineStage;
  sessions: DashboardSession[];
}

/**
 * Memoized pipeline stage groupings from sessions.
 * Returns groups in pipeline order, only including non-empty stages.
 */
export function usePipelineStages(sessions: DashboardSession[]): PipelineGroup[] {
  return useMemo(() => {
    const stageMap = new Map<PipelineStage, DashboardSession[]>();
    for (const stage of getStageOrder()) {
      stageMap.set(stage, []);
    }
    for (const session of sessions) {
      const stage = getPipelineStage(session);
      const list = stageMap.get(stage);
      if (list) list.push(session);
    }
    return getStageOrder()
      .map((stage) => ({ stage, sessions: stageMap.get(stage) ?? [] }))
      .filter((g) => g.sessions.length > 0);
  }, [sessions]);
}
