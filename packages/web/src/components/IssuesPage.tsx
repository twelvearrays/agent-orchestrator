"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { DashboardIssue } from "@/app/api/issues/route";
import { cn } from "@/lib/cn";

interface IssuesPageProps {
  issues: DashboardIssue[];
  projectName?: string;
}

type StateFilter = "all" | "open" | "closed";
type PriorityFilter = "all" | "0" | "1" | "2" | "3" | "4";

function getStatusIcon(issue: DashboardIssue): {
  icon: string;
  color: string;
  label: string;
} {
  const isFailed = issue.labels.some(
    (l) => l.toLowerCase() === "agent-failed",
  );
  if (isFailed) {
    return {
      icon: "\u2717",
      color: "var(--color-status-error)",
      label: "Failed",
    };
  }
  if (
    issue.state === "closed" ||
    issue.state === "cancelled" ||
    issue.sessionStatus === "merged" ||
    issue.sessionStatus === "done"
  ) {
    return {
      icon: "\u2713",
      color: "var(--color-status-ready)",
      label: "Done",
    };
  }
  if (issue.sessionId) {
    return {
      icon: "\u25CF",
      color: "var(--color-status-working)",
      label: "Working",
    };
  }
  return {
    icon: "\u25CB",
    color: "var(--color-text-muted)",
    label: "Ready",
  };
}

function priorityLabel(priority: number | undefined): string | null {
  if (priority == null) return null;
  if (priority === 0) return "No priority";
  return `P${priority}`;
}

export function IssuesPage({ issues, projectName }: IssuesPageProps) {
  const router = useRouter();
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assigningIds, setAssigningIds] = useState<Set<string>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);

  // ── Filtering ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return issues.filter((issue) => {
      // State filter
      if (stateFilter === "open") {
        if (issue.state === "closed" || issue.state === "cancelled")
          return false;
      } else if (stateFilter === "closed") {
        if (issue.state !== "closed" && issue.state !== "cancelled")
          return false;
      }

      // Priority filter
      if (priorityFilter !== "all") {
        const p = Number(priorityFilter);
        if ((issue.priority ?? -1) !== p) return false;
      }

      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesTitle = issue.title.toLowerCase().includes(q);
        const matchesId = issue.id.toLowerCase().includes(q);
        if (!matchesTitle && !matchesId) return false;
      }

      return true;
    });
  }, [issues, stateFilter, priorityFilter, search]);

  // ── Selectable issues (ready, no active session, not failed) ──────
  const selectableIds = useMemo(() => {
    return new Set(
      filtered
        .filter(
          (i) =>
            !i.sessionId &&
            i.state !== "closed" &&
            i.state !== "cancelled" &&
            !i.labels.some((l) => l.toLowerCase() === "agent-failed"),
        )
        .map((i) => i.id),
    );
  }, [filtered]);

  // ── Selection helpers ─────────────────────────────────────────────
  const toggleSelect = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [],
  );

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === selectableIds.size && prev.size > 0) {
        return new Set();
      }
      return new Set(selectableIds);
    });
  }, [selectableIds]);

  // ── Actions ───────────────────────────────────────────────────────
  const handleAssign = useCallback(async (issueId: string) => {
    setAssigningIds((prev) => new Set(prev).add(issueId));
    try {
      const res = await fetch(
        `/api/issues/${encodeURIComponent(issueId)}/assign`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        console.error(
          `Failed to assign ${issueId}:`,
          await res.text(),
        );
      }
    } finally {
      setAssigningIds((prev) => {
        const next = new Set(prev);
        next.delete(issueId);
        return next;
      });
    }
  }, []);

  const handleRetry = useCallback(async (issueId: string) => {
    setRetryingIds((prev) => new Set(prev).add(issueId));
    try {
      const res = await fetch(
        `/api/issues/${encodeURIComponent(issueId)}/retry`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        console.error(
          `Failed to retry ${issueId}:`,
          await res.text(),
        );
      }
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(issueId);
        return next;
      });
    }
  }, []);

  const handleBulkAssign = useCallback(async () => {
    setBulkAssigning(true);
    const ids = Array.from(selected).filter((id) => selectableIds.has(id));
    await Promise.allSettled(ids.map((id) => handleAssign(id)));
    setSelected(new Set());
    setBulkAssigning(false);
  }, [selected, selectableIds, handleAssign]);

  const allSelected =
    selectableIds.size > 0 && selected.size === selectableIds.size;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="nav-glass sticky top-0 z-30 border-b border-[var(--color-border-subtle)]">
        <div className="px-6 py-3 sm:px-8">
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:no-underline transition-colors"
            >
              {projectName || "ao"}
            </a>
            <span className="text-[var(--color-text-muted)]">/</span>
            <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
              Issues
            </h1>
            <div className="flex-1" />
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {filtered.length} issue{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </header>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--color-border-subtle)] px-6 py-3 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          {/* State filter */}
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as StateFilter)}
            className="rounded-[6px] border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="all">All States</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value as PriorityFilter)
            }
            className="rounded-[6px] border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="all">All Priorities</option>
            <option value="0">No Priority</option>
            <option value="1">P1 - Urgent</option>
            <option value="2">P2 - High</option>
            <option value="3">P3 - Medium</option>
            <option value="4">P4 - Low</option>
          </select>

          {/* Search */}
          <div className="flex items-center gap-2 rounded-[6px] border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-2.5 py-1.5">
            <svg
              className="h-3 w-3 shrink-0 text-[var(--color-text-tertiary)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues..."
              className="w-[180px] bg-transparent text-[11px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
            />
          </div>

          <div className="flex-1" />

          {/* Bulk assign */}
          {selected.size > 0 && (
            <button
              onClick={handleBulkAssign}
              disabled={bulkAssigning}
              className="rounded-[6px] bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-inverse)] transition-all hover:brightness-110 disabled:opacity-50"
            >
              {bulkAssigning
                ? "Assigning..."
                : `Assign All (${selected.size})`}
            </button>
          )}
        </div>
      </div>

      {/* ── Issue Table ─────────────────────────────────────────────── */}
      <main className="flex-1 px-6 py-5 sm:px-8">
        <div className="overflow-hidden rounded-[8px] border border-[var(--color-border-default)]">
          {/* Table header */}
          <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            <span className="w-[20px] shrink-0">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-3 w-3 cursor-pointer accent-[var(--color-accent)]"
                title="Select all assignable issues"
              />
            </span>
            <span className="w-[16px] shrink-0" />
            <span className="w-[90px] shrink-0">ID</span>
            <span className="flex-1">Title</span>
            <span className="w-[56px] shrink-0 text-center">Priority</span>
            <span className="w-[72px] shrink-0 text-center">State</span>
            <span className="w-[90px] shrink-0 text-center">Session</span>
            <span className="w-[72px] shrink-0" />
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-muted)]">
              No issues match the current filters
            </div>
          ) : (
            filtered.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                isSelected={selected.has(issue.id)}
                isSelectable={selectableIds.has(issue.id)}
                isExpanded={expandedId === issue.id}
                isAssigning={assigningIds.has(issue.id)}
                isRetrying={retryingIds.has(issue.id)}
                onToggleSelect={() => toggleSelect(issue.id)}
                onToggleExpand={() =>
                  setExpandedId(expandedId === issue.id ? null : issue.id)
                }
                onAssign={() => handleAssign(issue.id)}
                onRetry={() => handleRetry(issue.id)}
                onNavigateSession={(sessionId) =>
                  router.push(
                    `/sessions/${encodeURIComponent(sessionId)}`,
                  )
                }
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}

// ── Issue Row ─────────────────────────────────────────────────────────

interface IssueRowProps {
  issue: DashboardIssue;
  isSelected: boolean;
  isSelectable: boolean;
  isExpanded: boolean;
  isAssigning: boolean;
  isRetrying: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onAssign: () => void;
  onRetry: () => void;
  onNavigateSession: (sessionId: string) => void;
}

function IssueRow({
  issue,
  isSelected,
  isSelectable,
  isExpanded,
  isAssigning,
  isRetrying,
  onToggleSelect,
  onToggleExpand,
  onAssign,
  onRetry,
  onNavigateSession,
}: IssueRowProps) {
  const status = getStatusIcon(issue);
  const isFailed = issue.labels.some(
    (l) => l.toLowerCase() === "agent-failed",
  );
  const isReady =
    !issue.sessionId &&
    issue.state !== "closed" &&
    issue.state !== "cancelled" &&
    !isFailed;
  const isDone =
    issue.state === "closed" ||
    issue.state === "cancelled" ||
    issue.sessionStatus === "merged" ||
    issue.sessionStatus === "done";
  const pLabel = priorityLabel(issue.priority);

  const stateDisplay =
    issue.state === "in_progress"
      ? "In Progress"
      : issue.state.charAt(0).toUpperCase() + issue.state.slice(1);

  return (
    <div
      className={cn(
        "group border-b border-[var(--color-border-subtle)] transition-colors",
        isExpanded && "bg-[rgba(255,255,255,0.02)]",
        !isExpanded && "hover:bg-[rgba(255,255,255,0.02)]",
        isDone && "opacity-55",
      )}
    >
      {/* Main row */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5"
        onClick={(e) => {
          if (
            (e.target as HTMLElement).closest(
              "a, button, input[type=checkbox]",
            )
          )
            return;
          onToggleExpand();
        }}
      >
        {/* Checkbox */}
        <span className="w-[20px] shrink-0">
          {isSelectable ? (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="h-3 w-3 cursor-pointer accent-[var(--color-accent)]"
            />
          ) : (
            <span className="inline-block h-3 w-3" />
          )}
        </span>

        {/* Status icon */}
        <span
          className="w-[16px] shrink-0 text-center text-[12px]"
          style={{ color: status.color }}
          title={status.label}
        >
          {status.icon}
        </span>

        {/* Issue ID */}
        <span className="w-[90px] shrink-0 truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
          {issue.id}
        </span>

        {/* Title */}
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-secondary)]">
          {issue.title}
        </span>

        {/* Priority */}
        <span className="w-[56px] shrink-0 text-center">
          {pLabel ? (
            <span
              className={cn(
                "inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                issue.priority === 1 &&
                  "bg-[rgba(239,68,68,0.12)] text-[var(--color-status-error)]",
                issue.priority === 2 &&
                  "bg-[rgba(245,158,11,0.12)] text-[var(--color-status-attention)]",
                (issue.priority === 3 || issue.priority === 4) &&
                  "bg-[var(--color-bg-subtle)] text-[var(--color-text-tertiary)]",
                issue.priority === 0 &&
                  "bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]",
              )}
            >
              {pLabel}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--color-text-muted)]">
              -
            </span>
          )}
        </span>

        {/* State */}
        <span className="w-[72px] shrink-0 text-center text-[10px] text-[var(--color-text-tertiary)]">
          {stateDisplay}
        </span>

        {/* Session linkage */}
        <span className="w-[90px] shrink-0 text-center">
          {issue.sessionId ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNavigateSession(issue.sessionId!);
              }}
              className="truncate text-[10px] font-medium text-[var(--color-accent)] hover:underline"
              title={`Session: ${issue.sessionId}`}
            >
              {issue.sessionStatus ?? "active"}
            </button>
          ) : (
            <span className="text-[10px] text-[var(--color-text-muted)]">
              -
            </span>
          )}
        </span>

        {/* Action */}
        <span className="w-[72px] shrink-0 text-right">
          {isReady && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssign();
              }}
              disabled={isAssigning}
              className="rounded-[5px] bg-[var(--color-accent)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-inverse)] transition-all hover:brightness-110 disabled:opacity-50"
            >
              {isAssigning ? "..." : "Assign"}
            </button>
          )}
          {isFailed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              disabled={isRetrying}
              className="rounded-[5px] border border-[rgba(245,158,11,0.4)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-status-attention)] transition-all hover:bg-[rgba(245,158,11,0.08)] disabled:opacity-50"
            >
              {isRetrying ? "..." : "Retry"}
            </button>
          )}
        </span>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3 ml-[23px]">
          <div className="space-y-2 text-[11px]">
            {/* Labels */}
            {issue.labels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {issue.labels.map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}

            {/* Description preview */}
            {issue.description && (
              <p className="max-w-[600px] text-[var(--color-text-muted)] line-clamp-3">
                {issue.description}
              </p>
            )}

            {/* Session & PR info */}
            {issue.sessionId && (
              <div className="flex items-center gap-3 pt-1">
                <span className="text-[var(--color-text-tertiary)]">
                  Session:
                </span>
                <button
                  onClick={() => onNavigateSession(issue.sessionId!)}
                  className="font-[var(--font-mono)] text-[10px] text-[var(--color-accent)] hover:underline"
                >
                  {issue.sessionId}
                </button>
                {issue.prUrl && (
                  <>
                    <span className="text-[var(--color-text-tertiary)]">
                      PR:
                    </span>
                    <a
                      href={issue.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-accent)] hover:underline"
                    >
                      {issue.prUrl.split("/").pop()}
                    </a>
                  </>
                )}
              </div>
            )}

            {/* Issue URL */}
            {issue.url && (
              <div className="pt-1">
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  View in tracker
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
