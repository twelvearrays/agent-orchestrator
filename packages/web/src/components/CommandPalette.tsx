"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Command } from "@/lib/types";
import { cn } from "@/lib/cn";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

const SECTION_ORDER: Command["section"][] = ["actions", "navigation", "sessions"];
const SECTION_LABELS: Record<Command["section"], string> = {
  actions: "Actions",
  navigation: "Navigation",
  sessions: "Sessions",
};

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands.filter((cmd) => fuzzyMatch(query, cmd.label));
  }, [commands, query]);

  const grouped = useMemo(() => {
    const groups: Array<{ section: Command["section"]; commands: Command[] }> = [];
    for (const section of SECTION_ORDER) {
      const cmds = filtered.filter((c) => c.section === section);
      if (cmds.length > 0) groups.push({ section, commands: cmds });
    }
    return groups;
  }, [filtered]);

  const flatList = useMemo(() => grouped.flatMap((g) => g.commands), [grouped]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Reset query on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  const executeCommand = useCallback((cmd: Command) => {
    onClose();
    // Defer action to let the palette close first
    setTimeout(() => cmd.action(), 50);
  }, [onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % Math.max(flatList.length, 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + Math.max(flatList.length, 1)) % Math.max(flatList.length, 1));
          break;
        case "Enter":
          e.preventDefault();
          if (flatList[selectedIndex]) {
            executeCommand(flatList[selectedIndex]);
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, flatList, selectedIndex, executeCommand]);

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector("[data-selected=true]");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!mounted || !isOpen) return null;

  let flatIndex = 0;

  return createPortal(
    <div
      className="command-palette-overlay fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette-panel w-full max-w-[520px] rounded-[12px] overflow-hidden"
        role="dialog"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <svg className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
          />
          <kbd className="rounded border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-2">
          {grouped.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--color-text-muted)]">
              No commands found
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.section}>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                {SECTION_LABELS[group.section]}
              </div>
              {group.commands.map((cmd) => {
                const idx = flatIndex++;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={cmd.id}
                    data-selected={isSelected}
                    onClick={() => executeCommand(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                      isSelected
                        ? "bg-[rgba(88,166,255,0.08)] text-[var(--color-text-primary)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[rgba(255,255,255,0.04)]",
                    )}
                  >
                    {cmd.icon && (
                      <span className="w-4 text-center text-[13px]">{cmd.icon}</span>
                    )}
                    <span className="flex-1 text-[13px]">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
