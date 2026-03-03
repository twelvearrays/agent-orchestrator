"use client";

import type { DashboardSession } from "@/lib/types";
import { useMetrics } from "@/hooks/useMetrics";
import { Sparkline } from "./Sparkline";

interface MetricsBarProps {
  sessions: DashboardSession[];
}

interface MetricItemProps {
  value: number | string;
  label: string;
  color?: string;
  sparklineData?: number[];
  sparklineColor?: string;
}

function MetricItem({ value, label, color, sparklineData, sparklineColor }: MetricItemProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-baseline gap-1">
        <span
          className="text-[18px] font-bold tabular-nums leading-none tracking-tight"
          style={{ color: color ?? "var(--color-text-primary)" }}
        >
          {value}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
      </div>
      {sparklineData && sparklineData.length > 1 && (
        <Sparkline
          data={sparklineData}
          width={48}
          height={16}
          color={sparklineColor ?? color ?? "var(--color-accent)"}
        />
      )}
    </div>
  );
}

export function MetricsBar({ sessions }: MetricsBarProps) {
  const { current, activeHistory, prHistory, formattedMedianTTM } = useMetrics(sessions);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <MetricItem
        value={current.totalAgents}
        label="agents"
      />
      <div className="h-4 w-px bg-[var(--color-border-subtle)]" />
      <MetricItem
        value={current.activeAgents}
        label="active"
        color="var(--color-status-working)"
        sparklineData={activeHistory}
        sparklineColor="var(--color-status-working)"
      />
      <MetricItem
        value={current.openPRs}
        label="PRs"
        color="var(--color-accent-violet)"
        sparklineData={prHistory}
        sparklineColor="var(--color-accent-violet)"
      />
      {current.mergedToday > 0 && (
        <MetricItem
          value={current.mergedToday}
          label="merged today"
          color="var(--color-status-ready)"
        />
      )}
      {formattedMedianTTM && (
        <>
          <div className="h-4 w-px bg-[var(--color-border-subtle)]" />
          <MetricItem
            value={formattedMedianTTM}
            label="median TTM"
            color="var(--color-text-secondary)"
          />
        </>
      )}
    </div>
  );
}
