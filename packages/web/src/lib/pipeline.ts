/**
 * Pipeline stage derivation for the dashboard visualization.
 *
 * Maps a DashboardSession to a linear pipeline stage based on its
 * status, activity, and PR state. Used by PipelineStrip and session
 * cards to show progression through the agent lifecycle.
 */

import {
  type DashboardSession,
  type PipelineStage,
  TERMINAL_STATUSES,
  TERMINAL_ACTIVITIES,
  isPRRateLimited,
} from "./types";
import { CI_STATUS } from "@composio/ao-core/types";

export type { PipelineStage } from "./types";

const STAGE_ORDER: PipelineStage[] = [
  "spawning",
  "working",
  "pr_open",
  "ci",
  "review",
  "mergeable",
  "done",
];

const STAGE_CONFIG: Record<
  PipelineStage,
  { label: string; color: string; dotColor: string }
> = {
  spawning:  { label: "Spawn",   color: "var(--color-text-tertiary)",    dotColor: "var(--color-status-idle)" },
  working:   { label: "Work",    color: "var(--color-status-working)",   dotColor: "var(--color-status-working)" },
  pr_open:   { label: "PR",      color: "var(--color-accent-violet)",    dotColor: "var(--color-accent-violet)" },
  ci:        { label: "CI",      color: "var(--color-status-attention)", dotColor: "var(--color-status-attention)" },
  review:    { label: "Review",  color: "var(--color-accent-orange)",    dotColor: "var(--color-accent-orange)" },
  mergeable: { label: "Merge",   color: "var(--color-status-ready)",     dotColor: "var(--color-status-ready)" },
  done:      { label: "Done",    color: "var(--color-text-tertiary)",    dotColor: "var(--color-status-done)" },
};

/**
 * Derive the pipeline stage for a session.
 *
 * Logic mirrors `getAttentionLevel()` but maps to a linear pipeline
 * rather than urgency-based attention zones.
 */
export function getPipelineStage(session: DashboardSession): PipelineStage {
  // Terminal states → done
  if (
    TERMINAL_STATUSES.has(session.status) ||
    (session.activity !== null && TERMINAL_ACTIVITIES.has(session.activity))
  ) {
    return "done";
  }
  if (session.pr?.state === "merged" || session.pr?.state === "closed") {
    return "done";
  }

  // No PR yet
  if (!session.pr) {
    if (session.status === "spawning") return "spawning";
    return "working";
  }

  const pr = session.pr;
  const rateLimited = isPRRateLimited(pr);

  // PR is mergeable → mergeable stage
  if (!rateLimited && pr.mergeability.mergeable && pr.state === "open") {
    return "mergeable";
  }

  // Review decision exists → review stage
  if (!rateLimited && pr.state === "open") {
    if (pr.reviewDecision === "approved") return "mergeable";
    if (pr.reviewDecision === "changes_requested") return "review";
    if (pr.reviewDecision === "pending" || pr.reviewDecision === "none") {
      // CI still running → ci stage
      if (pr.ciStatus === CI_STATUS.PENDING) return "ci";
      if (pr.ciStatus === CI_STATUS.FAILING) return "ci";
      return "review";
    }
  }

  // PR open but no meaningful review signal → pr_open
  return "pr_open";
}

export function getStageColor(stage: PipelineStage): string {
  return STAGE_CONFIG[stage].color;
}

export function getStageDotColor(stage: PipelineStage): string {
  return STAGE_CONFIG[stage].dotColor;
}

export function getStageLabel(stage: PipelineStage): string {
  return STAGE_CONFIG[stage].label;
}

export function getStageOrder(): PipelineStage[] {
  return STAGE_ORDER;
}

export function getStageConfig(stage: PipelineStage): { label: string; color: string; dotColor: string } {
  return STAGE_CONFIG[stage];
}
