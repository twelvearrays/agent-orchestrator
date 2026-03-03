"use client";

import { useMemo } from "react";
import type { DashboardSession } from "@/lib/types";
import {
  type PipelineStage,
  getPipelineStage,
  getStageOrder,
  getStageConfig,
} from "@/lib/pipeline";
import { cn } from "@/lib/cn";

interface PipelineStripProps {
  sessions: DashboardSession[];
  activeFilter?: PipelineStage | null;
  onFilterStage?: (stage: PipelineStage | null) => void;
  compact?: boolean;
}

export function PipelineStrip({
  sessions,
  activeFilter,
  onFilterStage,
  compact = false,
}: PipelineStripProps) {
  const stageCounts = useMemo(() => {
    const counts = new Map<PipelineStage, number>();
    for (const stage of getStageOrder()) {
      counts.set(stage, 0);
    }
    for (const session of sessions) {
      const stage = getPipelineStage(session);
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  const stages = getStageOrder();

  const handleClick = (stage: PipelineStage) => {
    if (!onFilterStage) return;
    onFilterStage(activeFilter === stage ? null : stage);
  };

  return (
    <div className={cn(
      "pipeline-strip rounded-[8px] border border-[var(--color-border-subtle)]",
      compact ? "px-3 py-2" : "px-6 py-4",
    )}>
      <div className="flex items-center gap-0">
        {stages.map((stage, i) => {
          const config = getStageConfig(stage);
          const count = stageCounts.get(stage) ?? 0;
          const isActive = activeFilter === stage;
          const isLast = i === stages.length - 1;

          return (
            <div key={stage} className="flex items-center">
              {/* Stage node */}
              <button
                onClick={() => handleClick(stage)}
                className={cn(
                  "group flex flex-col items-center gap-1 rounded-[6px] px-3 py-1.5 transition-all duration-150",
                  onFilterStage && "cursor-pointer hover:bg-[rgba(255,255,255,0.04)]",
                  isActive && "bg-[rgba(255,255,255,0.06)]",
                  !onFilterStage && "cursor-default",
                )}
              >
                {/* Label + count */}
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors",
                      count > 0
                        ? "text-[var(--color-text-secondary)]"
                        : "text-[var(--color-text-tertiary)]",
                      isActive && "text-[var(--color-text-primary)]",
                    )}
                  >
                    {config.label}
                  </span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "min-w-[18px] rounded-full px-1.5 py-0 text-center text-[10px] font-bold tabular-nums transition-colors",
                        isActive
                          ? "text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)]",
                      )}
                      style={{
                        background: isActive
                          ? `color-mix(in srgb, ${config.color} 20%, transparent)`
                          : "var(--color-bg-subtle)",
                      }}
                    >
                      {count}
                    </span>
                  )}
                </div>

                {/* Agent dots */}
                {!compact && count > 0 && (
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: Math.min(count, 8) }, (_, j) => (
                      <div
                        key={j}
                        className="h-1.5 w-1.5 rounded-full transition-colors"
                        style={{ background: config.dotColor, opacity: isActive ? 1 : 0.6 }}
                      />
                    ))}
                    {count > 8 && (
                      <span className="ml-0.5 text-[8px] text-[var(--color-text-muted)]">
                        +{count - 8}
                      </span>
                    )}
                  </div>
                )}
              </button>

              {/* Connector line */}
              {!isLast && (
                <div className="flex items-center px-0.5">
                  <svg width="24" height="2" className="shrink-0">
                    <line
                      x1="0" y1="1" x2="24" y2="1"
                      stroke="var(--color-pipeline-line)"
                      strokeWidth="1.5"
                      strokeDasharray={count > 0 || (stageCounts.get(stages[i + 1]) ?? 0) > 0 ? "none" : "3,3"}
                    />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mini pipeline strip for session detail page — shows current stage highlighted */
export function MiniPipelineStrip({ session }: { session: DashboardSession }) {
  const currentStage = getPipelineStage(session);
  const stages = getStageOrder();

  return (
    <div className="flex items-center gap-0">
      {stages.map((stage, i) => {
        const config = getStageConfig(stage);
        const isCurrent = stage === currentStage;
        const isPast = stages.indexOf(currentStage) > i;
        const isLast = i === stages.length - 1;

        return (
          <div key={stage} className="flex items-center">
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={cn(
                  "h-2 w-2 rounded-full transition-all",
                  isCurrent && "ring-2 ring-offset-1 ring-offset-[var(--color-bg-base)]",
                )}
                style={{
                  background: isCurrent
                    ? config.dotColor
                    : isPast
                      ? "var(--color-text-tertiary)"
                      : "var(--color-border-subtle)",
                  ...(isCurrent ? { "--tw-ring-color": config.dotColor } as React.CSSProperties : {}),
                }}
              />
              <span
                className={cn(
                  "text-[8px] font-medium uppercase tracking-wider",
                  isCurrent
                    ? "text-[var(--color-text-primary)]"
                    : isPast
                      ? "text-[var(--color-text-tertiary)]"
                      : "text-[var(--color-text-muted)]",
                )}
              >
                {config.label}
              </span>
            </div>
            {!isLast && (
              <div className="mx-0.5 h-px w-3" style={{
                background: isPast || isCurrent
                  ? "var(--color-text-tertiary)"
                  : "var(--color-border-subtle)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
