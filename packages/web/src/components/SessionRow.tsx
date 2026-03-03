"use client";

import { useState } from "react";
import {
  type DashboardSession,
  getAttentionLevel,
  isPRRateLimited,
  TERMINAL_STATUSES,
  TERMINAL_ACTIVITIES,
} from "@/lib/types";
import { cn } from "@/lib/cn";
import { getSessionTitle } from "@/lib/format";
import { getPipelineStage, getStageConfig } from "@/lib/pipeline";
import { ActivityDot } from "./ActivityDot";

interface SessionRowProps {
  session: DashboardSession;
  isSelected?: boolean;
  onSend?: (sessionId: string, message: string) => void;
  onKill?: (sessionId: string) => void;
  onMerge?: (prNumber: number) => void;
  onRestore?: (sessionId: string) => void;
}

function relativeTime(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!iso || isNaN(ms)) return "-";
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function SessionRow({
  session,
  isSelected = false,
  onSend: _onSend,
  onKill,
  onMerge,
  onRestore,
}: SessionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const pr = session.pr;
  const level = getAttentionLevel(session);
  const stage = getPipelineStage(session);
  const stageConfig = getStageConfig(stage);
  const rateLimited = pr ? isPRRateLimited(pr) : false;
  const isReadyToMerge = !rateLimited && pr?.mergeability.mergeable && pr.state === "open";
  const isTerminal =
    TERMINAL_STATUSES.has(session.status) ||
    (session.activity !== null && TERMINAL_ACTIVITIES.has(session.activity));
  const isRestorable = isTerminal && session.status !== "merged";
  const title = getSessionTitle(session);

  const borderColors: Record<string, string> = {
    merge: "var(--color-status-ready)",
    respond: "var(--color-status-error)",
    review: "var(--color-accent-orange)",
    pending: "var(--color-status-attention)",
    working: "var(--color-status-working)",
    done: "var(--color-border-default)",
  };

  return (
    <div
      className={cn(
        "group border-b border-[var(--color-border-subtle)] transition-colors",
        isSelected && "bg-[rgba(88,166,255,0.06)]",
        expanded && "bg-[rgba(255,255,255,0.02)]",
        !isSelected && !expanded && "hover:bg-[rgba(255,255,255,0.02)]",
        pr?.state === "merged" && "opacity-55",
      )}
    >
      {/* Main row */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5"
        style={{ borderLeft: `3px solid ${borderColors[level] ?? "transparent"}` }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button")) return;
          setExpanded(!expanded);
        }}
      >
        {/* Activity dot */}
        <ActivityDot activity={session.activity} dotOnly size={6} />

        {/* Session ID */}
        <span className="w-[80px] shrink-0 truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
          {session.id}
        </span>

        {/* Title */}
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-secondary)]">
          {title}
        </span>

        {/* Pipeline stage chip */}
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{
            color: stageConfig.color,
            background: `color-mix(in srgb, ${stageConfig.color} 12%, transparent)`,
          }}
        >
          {stageConfig.label}
        </span>

        {/* PR # */}
        {pr && (
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-[11px] text-[var(--color-accent)] hover:underline"
          >
            #{pr.number}
          </a>
        )}

        {/* CI */}
        <span className="w-[20px] shrink-0 text-center text-[11px]">
          {pr && !rateLimited ? (
            pr.ciStatus === "passing" ? (
              <span className="text-[var(--color-status-ready)]">&#10003;</span>
            ) : pr.ciStatus === "failing" ? (
              <span className="text-[var(--color-status-error)]">&#10007;</span>
            ) : pr.ciStatus === "pending" ? (
              <span className="text-[var(--color-status-attention)]">&#9679;</span>
            ) : (
              <span className="text-[var(--color-text-muted)]">-</span>
            )
          ) : (
            <span className="text-[var(--color-text-muted)]">-</span>
          )}
        </span>

        {/* Review */}
        <span className="w-[20px] shrink-0 text-center text-[11px]">
          {pr && !rateLimited ? (
            pr.reviewDecision === "approved" ? (
              <span className="text-[var(--color-status-ready)]">&#10003;</span>
            ) : pr.reviewDecision === "changes_requested" ? (
              <span className="text-[var(--color-status-error)]">&#10007;</span>
            ) : (
              <span className="text-[var(--color-text-muted)]">-</span>
            )
          ) : (
            <span className="text-[var(--color-text-muted)]">-</span>
          )}
        </span>

        {/* Time */}
        <span className="w-[32px] shrink-0 text-right font-[var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
          {relativeTime(session.lastActivityAt)}
        </span>

        {/* Actions */}
        <div className="flex w-[60px] shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {isReadyToMerge && pr && (
            <button
              onClick={(e) => { e.stopPropagation(); onMerge?.(pr.number); }}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-status-ready)] transition-colors hover:bg-[rgba(63,185,80,0.1)]"
              title="Merge PR"
            >
              merge
            </button>
          )}
          {!isTerminal && (
            <a
              href={`/sessions/${encodeURIComponent(session.id)}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)] hover:no-underline"
              title="Open terminal"
            >
              &#9654;
            </a>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3 ml-[3px]">
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            {session.branch && (
              <span className="font-[var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
                {session.branch}
              </span>
            )}
            {session.issueUrl && (
              <a
                href={session.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent)] hover:underline"
              >
                {session.issueLabel || "issue"}
              </a>
            )}
            {pr && (
              <span className="text-[var(--color-text-secondary)]">
                <span className="text-[var(--color-status-ready)]">+{pr.additions}</span>{" "}
                <span className="text-[var(--color-status-error)]">-{pr.deletions}</span>
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            {isRestorable && (
              <button
                onClick={() => onRestore?.(session.id)}
                className="rounded border border-[rgba(88,166,255,0.35)] px-2 py-0.5 text-[10px] text-[var(--color-accent)] transition-colors hover:bg-[rgba(88,166,255,0.1)]"
              >
                restore
              </button>
            )}
            {!isTerminal && (
              <button
                onClick={() => onKill?.(session.id)}
                className="rounded border border-[rgba(239,68,68,0.35)] px-2 py-0.5 text-[10px] text-[var(--color-status-error)] transition-colors hover:bg-[rgba(239,68,68,0.1)]"
              >
                kill
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
