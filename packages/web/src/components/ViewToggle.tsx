"use client";

import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/cn";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-[6px] border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] p-0.5">
      <button
        onClick={() => onChange("board")}
        className={cn(
          "flex items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
          view === "board"
            ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-sm"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
        )}
        aria-label="Board view"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        Board
      </button>
      <button
        onClick={() => onChange("list")}
        className={cn(
          "flex items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
          view === "list"
            ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-sm"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
        )}
        aria-label="List view"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        List
      </button>
    </div>
  );
}
