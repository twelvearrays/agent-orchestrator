"use client";

import { useEffect, useReducer } from "react";
import type {
  DashboardSession,
  SSESnapshotEvent,
  SSESessionUpdateEvent,
  SSESessionAddedEvent,
  SSESessionRemovedEvent,
} from "@/lib/types";

type Action =
  | { type: "reset"; sessions: DashboardSession[] }
  | { type: "snapshot"; patches: SSESnapshotEvent["sessions"] }
  | { type: "session-added"; session: SSESessionAddedEvent["session"] }
  | { type: "session-update"; patch: SSESessionUpdateEvent["session"] }
  | { type: "session-removed"; sessionId: string };

function reducer(state: DashboardSession[], action: Action): DashboardSession[] {
  switch (action.type) {
    case "reset":
      return action.sessions;
    case "snapshot": {
      const patchMap = new Map(action.patches.map((p) => [p.id, p]));
      let changed = false;
      const next = state.map((s) => {
        const patch = patchMap.get(s.id);
        if (!patch) return s;
        if (
          s.status === patch.status &&
          s.activity === patch.activity &&
          s.lastActivityAt === patch.lastActivityAt
        ) {
          return s;
        }
        changed = true;
        return { ...s, status: patch.status, activity: patch.activity, lastActivityAt: patch.lastActivityAt };
      });
      return changed ? next : state;
    }
    case "session-added": {
      // Deduplicate — ignore if already present
      if (state.some((s) => s.id === action.session.id)) return state;
      return [...state, action.session];
    }
    case "session-update": {
      const { patch } = action;
      const idx = state.findIndex((s) => s.id === patch.id);
      if (idx === -1) return state;
      const existing = state[idx];
      if (
        existing.status === patch.status &&
        existing.activity === patch.activity &&
        existing.lastActivityAt === patch.lastActivityAt
      ) {
        return state;
      }
      const updated = [
        ...state.slice(0, idx),
        { ...existing, status: patch.status, activity: patch.activity, lastActivityAt: patch.lastActivityAt },
        ...state.slice(idx + 1),
      ];
      return updated;
    }
    case "session-removed": {
      const filtered = state.filter((s) => s.id !== action.sessionId);
      return filtered.length === state.length ? state : filtered;
    }
  }
}

export function useSessionEvents(initialSessions: DashboardSession[]): DashboardSession[] {
  const [sessions, dispatch] = useReducer(reducer, initialSessions);

  // Reset state when server-rendered props change (e.g. full page refresh)
  useEffect(() => {
    dispatch({ type: "reset", sessions: initialSessions });
  }, [initialSessions]);

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as { type: string };
        switch (data.type) {
          case "snapshot": {
            const snapshot = data as SSESnapshotEvent;
            dispatch({ type: "snapshot", patches: snapshot.sessions });
            break;
          }
          case "session-added": {
            const added = data as SSESessionAddedEvent;
            dispatch({ type: "session-added", session: added.session });
            break;
          }
          case "session-update": {
            const update = data as SSESessionUpdateEvent;
            dispatch({ type: "session-update", patch: update.session });
            break;
          }
          case "session-removed": {
            const removed = data as SSESessionRemovedEvent;
            dispatch({ type: "session-removed", sessionId: removed.sessionId });
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here
    };

    return () => {
      es.close();
    };
  }, []);

  return sessions;
}
