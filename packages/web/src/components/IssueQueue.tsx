"use client";

import { useState } from "react";

import type { DashboardIssue } from "@/app/api/issues/route";

interface IssueQueueProps {
  issues: DashboardIssue[];
  onAssign: (issueId: string) => Promise<void>;
}

export function IssueQueue({ issues, onAssign }: IssueQueueProps) {
  // Filter to only show unassigned issues (no active session)
  const readyIssues = issues.filter((i) => !i.sessionId);

  if (readyIssues.length === 0) return null;

  return (
    <div className="mb-4 rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          Ready Issues ({readyIssues.length})
        </h2>
        <a
          href="/issues"
          className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
        >
          View All
        </a>
      </div>
      <div className="divide-y divide-[var(--color-border-subtle)]">
        {readyIssues.slice(0, 8).map((issue) => (
          <IssueQueueRow key={issue.id} issue={issue} onAssign={onAssign} />
        ))}
      </div>
    </div>
  );
}

function IssueQueueRow({
  issue,
  onAssign,
}: {
  issue: DashboardIssue;
  onAssign: (id: string) => Promise<void>;
}) {
  const [assigning, setAssigning] = useState(false);

  const handleAssign = async () => {
    setAssigning(true);
    try {
      await onAssign(issue.id);
    } finally {
      setAssigning(false);
    }
  };

  const priorityLabel = issue.priority != null ? `P${issue.priority}` : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {priorityLabel && (
        <span className="flex-shrink-0 rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
          {priorityLabel}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-secondary)]">
        {issue.title}
      </span>
      <button
        onClick={handleAssign}
        disabled={assigning}
        className="flex-shrink-0 rounded-[5px] bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-inverse)] transition-all hover:brightness-110 disabled:opacity-50"
      >
        {assigning ? "Assigning..." : "Assign"}
      </button>
    </div>
  );
}
