"use client";

import { useMemo } from "react";
import { type DashboardSession, TERMINAL_STATUSES, TERMINAL_ACTIVITIES } from "@/lib/types";
import { cn } from "@/lib/cn";

interface AgentTopologyProps {
  sessions: DashboardSession[];
  compact?: boolean;
}

interface ProjectGroup {
  projectId: string;
  sessions: DashboardSession[];
  active: number;
  total: number;
}

function getActivityColor(session: DashboardSession): string {
  const isTerminal =
    TERMINAL_STATUSES.has(session.status) ||
    (session.activity !== null && TERMINAL_ACTIVITIES.has(session.activity));

  if (isTerminal) return "var(--color-status-done)";
  if (session.activity === "active") return "var(--color-status-working)";
  if (session.activity === "ready") return "var(--color-status-ready)";
  if (session.activity === "waiting_input" || session.activity === "blocked") return "var(--color-status-error)";
  return "var(--color-status-idle)";
}

export function AgentTopology({ sessions, compact = true }: AgentTopologyProps) {
  const groups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, DashboardSession[]>();
    for (const s of sessions) {
      const key = s.projectId || "unknown";
      const list = map.get(key);
      if (list) {
        list.push(s);
      } else {
        map.set(key, [s]);
      }
    }
    return Array.from(map.entries())
      .map(([projectId, sessions]) => ({
        projectId,
        sessions,
        active: sessions.filter((s) => {
          const isTerminal =
            TERMINAL_STATUSES.has(s.status) ||
            (s.activity !== null && TERMINAL_ACTIVITIES.has(s.activity));
          return !isTerminal;
        }).length,
        total: sessions.length,
      }))
      .sort((a, b) => b.active - a.active || b.total - a.total);
  }, [sessions]);

  if (groups.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {groups.map((group) => (
          <div
            key={group.projectId}
            className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-2.5 py-1"
          >
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              {group.projectId}
            </span>
            <div className="flex items-center gap-0.5">
              {group.sessions.slice(0, 6).map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    s.activity === "active" && "animate-[activity-pulse_2s_ease-in-out_infinite]",
                  )}
                  style={{ background: getActivityColor(s) }}
                  title={`${s.id}: ${s.activity ?? s.status}`}
                />
              ))}
              {group.sessions.length > 6 && (
                <span className="ml-0.5 text-[8px] text-[var(--color-text-muted)]">
                  +{group.sessions.length - 6}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Full mode — expanded view with details
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.projectId}
          className="rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
              {group.projectId}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {group.active} active / {group.total} total
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.sessions.map((s) => (
              <a
                key={s.id}
                href={`/sessions/${encodeURIComponent(s.id)}`}
                className="flex items-center gap-1 rounded-[4px] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.02)] px-2 py-1 text-[10px] transition-colors hover:border-[var(--color-border-strong)] hover:no-underline"
              >
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    s.activity === "active" && "animate-[activity-pulse_2s_ease-in-out_infinite]",
                  )}
                  style={{ background: getActivityColor(s) }}
                />
                <span className="font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                  {s.id}
                </span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
