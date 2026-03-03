"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface SpawnDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SpawnDialog({ isOpen, onClose }: SpawnDialogProps) {
  const [issueUrl, setIssueUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setIssueUrl("");
      setError(null);
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueUrl.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueUrl: issueUrl.trim() }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to spawn agent");
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div
      className="command-palette-overlay fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="command-palette-panel w-full max-w-[440px] rounded-[12px] overflow-hidden">
        <div className="border-b border-[var(--color-border-subtle)] px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
            Spawn Agent
          </h2>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            Provide an issue URL to spawn a new agent session.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
            Issue URL
          </label>
          <input
            ref={inputRef}
            type="url"
            value={issueUrl}
            onChange={(e) => setIssueUrl(e.target.value)}
            placeholder="https://github.com/org/repo/issues/123"
            className="w-full rounded-[6px] border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-accent)]"
          />

          {error && (
            <p className="mt-2 text-[12px] text-[var(--color-status-error)]">{error}</p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!issueUrl.trim() || submitting}
              className="rounded-[6px] bg-[var(--color-accent)] px-4 py-1.5 text-[12px] font-semibold text-[var(--color-text-inverse)] transition-all hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? "Spawning..." : "Spawn"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
