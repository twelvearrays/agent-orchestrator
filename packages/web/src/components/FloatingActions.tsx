"use client";

import { type DashboardSession, TERMINAL_STATUSES, TERMINAL_ACTIVITIES } from "@/lib/types";

interface FloatingActionsProps {
  session: DashboardSession;
  onMerge?: () => void;
  onKill?: () => void;
  onRestore?: () => void;
  onSendMessage?: () => void;
}

export function FloatingActions({
  session,
  onMerge,
  onKill,
  onRestore,
  onSendMessage,
}: FloatingActionsProps) {
  const pr = session.pr;
  const isTerminal =
    TERMINAL_STATUSES.has(session.status) ||
    (session.activity !== null && TERMINAL_ACTIVITIES.has(session.activity));
  const isRestorable = isTerminal && session.status !== "merged";
  const isMergeable = pr?.mergeability.mergeable && pr.state === "open";

  const hasActions = isMergeable || !isTerminal || isRestorable;
  if (!hasActions) return null;

  return (
    <div className="floating-actions fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-[12px] px-4 py-2.5">
      <div className="flex items-center gap-2">
        {isMergeable && (
          <button
            onClick={onMerge}
            className="flex items-center gap-1.5 rounded-[6px] bg-[var(--color-status-ready)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--color-text-inverse)] transition-[filter,transform] duration-[100ms] hover:-translate-y-px hover:brightness-110"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            Merge PR #{pr?.number}
          </button>
        )}

        {!isTerminal && (
          <button
            onClick={onSendMessage}
            className="flex items-center gap-1.5 rounded-[6px] border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Message
          </button>
        )}

        {!isTerminal && (
          <button
            onClick={onKill}
            className="flex items-center gap-1.5 rounded-[6px] border border-[rgba(239,68,68,0.35)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-status-error)] transition-colors hover:bg-[rgba(239,68,68,0.1)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            Kill
          </button>
        )}

        {isRestorable && (
          <button
            onClick={onRestore}
            className="flex items-center gap-1.5 rounded-[6px] border border-[rgba(88,166,255,0.35)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[rgba(88,166,255,0.1)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Restore
          </button>
        )}
      </div>
    </div>
  );
}
