"use client";

import { useState } from "react";
import type { DashboardSession, AttentionLevel } from "@/lib/types";
import { SessionCard } from "./SessionCard";

interface AttentionZoneProps {
  level: AttentionLevel;
  sessions: DashboardSession[];
  variant?: "column" | "grid" | "row";
  selectedSessionId?: string | null;
  onSend?: (sessionId: string, message: string) => void;
  onKill?: (sessionId: string) => void;
  onMerge?: (prNumber: number) => void;
  onRestore?: (sessionId: string) => void;
}

const zoneConfig: Record<
  AttentionLevel,
  {
    label: string;
    color: string;
    defaultCollapsed: boolean;
  }
> = {
  merge: {
    label: "Merge",
    color: "var(--color-status-ready)",
    defaultCollapsed: false,
  },
  respond: {
    label: "Respond",
    color: "var(--color-status-error)",
    defaultCollapsed: false,
  },
  review: {
    label: "Review",
    color: "var(--color-accent-orange)",
    defaultCollapsed: false,
  },
  pending: {
    label: "Pending",
    color: "var(--color-status-attention)",
    defaultCollapsed: false,
  },
  working: {
    label: "Working",
    color: "var(--color-status-working)",
    defaultCollapsed: false,
  },
  done: {
    label: "Done",
    color: "var(--color-text-tertiary)",
    defaultCollapsed: false,
  },
};

export { zoneConfig };

export function AttentionZone({
  level,
  sessions,
  variant = "grid",
  selectedSessionId,
  onSend,
  onKill,
  onMerge,
  onRestore,
}: AttentionZoneProps) {
  const config = zoneConfig[level];
  const [collapsed, setCollapsed] = useState(config.defaultCollapsed);

  if (sessions.length === 0) return null;

  // Column variant — vertical stack for Kanban
  if (variant === "column") {
    return (
      <div className="flex flex-col">
        <button
          className="mb-2.5 flex items-center gap-2 py-0.5 text-left"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: config.color }}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            {config.label}
          </span>
          <span
            className="rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums text-[var(--color-text-muted)]"
            style={{ background: "var(--color-bg-subtle)" }}
          >
            {sessions.length}
          </span>
          <div className="flex-1" />
          <svg
            className="h-3 w-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!collapsed && (
          <div className="flex flex-col gap-2">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={session.id === selectedSessionId}
                onSend={onSend}
                onKill={onKill}
                onMerge={onMerge}
                onRestore={onRestore}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Row variant — horizontal scroll for Board view grouped by attention
  if (variant === "row") {
    return (
      <div className="mb-5">
        <button
          className="mb-2.5 flex items-center gap-2 py-0.5 text-left"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: config.color }}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            {config.label}
          </span>
          <span
            className="rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums text-[var(--color-text-muted)]"
            style={{ background: "var(--color-bg-subtle)" }}
          >
            {sessions.length}
          </span>
          <div className="h-px flex-1 bg-[var(--color-border-subtle)]" />
          <svg
            className="h-3 w-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!collapsed && (
          <div className="flex gap-2.5 overflow-x-auto pb-2">
            {sessions.map((session) => (
              <div key={session.id} className="min-w-[280px] max-w-[320px] shrink-0">
                <SessionCard
                  session={session}
                  isSelected={session.id === selectedSessionId}
                  onSend={onSend}
                  onKill={onKill}
                  onMerge={onMerge}
                  onRestore={onRestore}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Grid variant — responsive grid for done section
  return (
    <div className="mb-7">
      <button
        className="mb-3 flex w-full items-center gap-2.5 py-0.5 text-left"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: config.color }}
        />
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
          {config.label}
        </span>
        <div className="h-px flex-1 bg-[var(--color-border-subtle)]" />
        <span className="tabular-nums text-[11px] text-[var(--color-text-muted)]">
          {sessions.length}
        </span>
        <svg
          className="h-3 w-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150"
          style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isSelected={session.id === selectedSessionId}
              onSend={onSend}
              onKill={onKill}
              onMerge={onMerge}
              onRestore={onRestore}
            />
          ))}
        </div>
      )}
    </div>
  );
}
