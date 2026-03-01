"use client";

import { useEffect, useState, useCallback } from "react";

interface EventFlowItem {
  event: string;
  reactionKey: string;
  description: string;
}

interface LinearState {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface LinearTeam {
  id: string;
  name: string;
  states: LinearState[];
}

interface ReactionConfig {
  auto: boolean;
  action: "send-to-agent" | "notify" | "update-tracker" | "auto-merge" | "disabled";
  message?: string;
  priority?: "urgent" | "action" | "warning" | "info";
  trackerState?: string;
  retries?: number;
  escalateAfter?: number | string;
  threshold?: string;
}

type RowState = ReactionConfig & { _key: string };

export function ReactionsEditor() {
  const [eventFlow, setEventFlow] = useState<EventFlowItem[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/config/reactions").then((r) => r.json()),
      fetch("/api/linear/states").then((r) => r.json()),
    ]).then(([reactionsData, statesData]: [
      { reactions: Record<string, ReactionConfig>; eventFlow: EventFlowItem[] },
      { teams: LinearTeam[] }
    ]) => {
      setEventFlow(reactionsData.eventFlow);
      setTeams(statesData.teams ?? []);

      const initialRows: RowState[] = reactionsData.eventFlow.map((item) => {
        const existing = reactionsData.reactions?.[item.reactionKey];
        if (existing) {
          return { _key: item.reactionKey, ...existing };
        }
        return {
          _key: item.reactionKey,
          auto: false,
          action: "disabled" as const,
        };
      });
      setRows(initialRows);
    }).catch(() => {
      setRows([]);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const updateRow = useCallback((key: string, update: Partial<ReactionConfig>) => {
    setRows((prev) =>
      prev.map((row) => (row._key === key ? { ...row, ...update } : row)),
    );
    setSaveResult(null);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    const reactions: Record<string, Omit<ReactionConfig, "action"> & { action: string }> = {};
    for (const row of rows) {
      if (row.action === "disabled") continue;
      const { _key, ...config } = row;
      reactions[_key] = config;
    }
    try {
      const res = await fetch("/api/config/reactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reactions }),
      });
      setSaveResult(res.ok ? "success" : "error");
    } catch {
      setSaveResult("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
        <div className="h-3.5 w-3.5 animate-spin rounded-full border border-[var(--color-border-default)] border-t-[var(--color-text-muted)]" />
        Loading reactions config…
      </div>
    );
  }

  return (
    <div className="max-w-[900px]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.10em] text-[var(--color-text-tertiary)]">
          Lifecycle Reactions
        </h2>
        <div className="flex items-center gap-3">
          {saveResult === "success" && (
            <span className="text-[11px] text-[var(--color-status-done)]">Saved</span>
          )}
          {saveResult === "error" && (
            <span className="text-[11px] text-red-400">Save failed</span>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-[6px] bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[6px] border border-[var(--color-border-default)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border-muted)]">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] w-[220px]">
                Event
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] w-[160px]">
                Action
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Config
              </th>
              <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] w-[60px]">
                Auto
              </th>
            </tr>
          </thead>
          <tbody>
            {eventFlow.map((item, i) => {
              const row = rows.find((r) => r._key === item.reactionKey);
              if (!row) return null;
              return (
                <tr
                  key={item.reactionKey}
                  className={`border-b border-[var(--color-border-muted)] last:border-0 ${i % 2 === 0 ? "" : "bg-[var(--color-surface-subtle)]"}`}
                >
                  {/* Event */}
                  <td className="px-3 py-3">
                    <div className="font-mono text-[11px] text-[var(--color-text-primary)]">
                      {item.event}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {item.description}
                    </div>
                  </td>

                  {/* Action dropdown */}
                  <td className="px-3 py-3">
                    <select
                      value={row.action}
                      onChange={(e) =>
                        updateRow(item.reactionKey, {
                          action: e.target.value as ReactionConfig["action"],
                        })
                      }
                      className="w-full rounded-[5px] border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                    >
                      <option value="disabled">— disabled —</option>
                      <option value="send-to-agent">Send to agent</option>
                      <option value="notify">Notify</option>
                      <option value="update-tracker">Update tracker</option>
                      <option value="auto-merge">Auto-merge</option>
                    </select>
                  </td>

                  {/* Config */}
                  <td className="px-3 py-3">
                    {row.action === "send-to-agent" && (
                      <textarea
                        value={row.message ?? ""}
                        onChange={(e) => updateRow(item.reactionKey, { message: e.target.value })}
                        placeholder="Message to send to agent…"
                        rows={2}
                        className="w-full resize-none rounded-[5px] border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      />
                    )}
                    {row.action === "update-tracker" && (
                      <select
                        value={row.trackerState ?? ""}
                        onChange={(e) =>
                          updateRow(item.reactionKey, { trackerState: e.target.value })
                        }
                        className="w-full rounded-[5px] border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      >
                        <option value="">— select state —</option>
                        {teams.map((team) => (
                          <optgroup key={team.id} label={team.name}>
                            {team.states.map((state) => (
                              <option key={state.id} value={state.name}>
                                {state.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        {teams.length === 0 && (
                          <option value="" disabled>
                            No LINEAR_API_KEY configured
                          </option>
                        )}
                      </select>
                    )}
                    {row.action === "notify" && (
                      <select
                        value={row.priority ?? "info"}
                        onChange={(e) =>
                          updateRow(item.reactionKey, {
                            priority: e.target.value as ReactionConfig["priority"],
                          })
                        }
                        className="rounded-[5px] border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      >
                        <option value="urgent">Urgent</option>
                        <option value="action">Action</option>
                        <option value="warning">Warning</option>
                        <option value="info">Info</option>
                      </select>
                    )}
                    {row.action === "auto-merge" && (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        Merges when approved + green
                      </span>
                    )}
                    {row.action === "disabled" && (
                      <span className="text-[11px] text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>

                  {/* Auto checkbox */}
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={row.auto}
                      onChange={(e) => updateRow(item.reactionKey, { auto: e.target.checked })}
                      disabled={row.action === "disabled"}
                      className="h-3.5 w-3.5 rounded accent-[var(--color-accent)] disabled:opacity-30"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] text-[var(--color-text-muted)]">
        Changes are saved to <code className="font-mono">agent-orchestrator.yaml</code>
      </p>
    </div>
  );
}
