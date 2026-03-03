/**
 * Singleton file-system watcher for session metadata directories.
 *
 * Watches all project sessions directories using fs.watch() (inotify on Linux).
 * Per-file debounce (300ms) coalesces rapid writes during spawn.
 * Reference counting: multiple SSE connections share one watcher; closes when all disconnect.
 *
 * Cached in globalThis to survive Next.js HMR reloads.
 */

import { watch, existsSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { getSessionsDir, type OrchestratorConfig } from "@composio/ao-core";

export interface SessionChangeEvent {
  sessionId: string;
  type: "changed" | "removed";
}

class SessionWatcher extends EventEmitter {
  private watchers: FSWatcher[] = [];
  private refCount = 0;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  start(config: OrchestratorConfig): void {
    if (this.started) return;
    this.started = true;

    for (const project of Object.values(config.projects)) {
      const sessionsDir = getSessionsDir(config.configPath, project.path);
      if (!existsSync(sessionsDir)) continue;

      try {
        const watcher = watch(sessionsDir, (eventType, filename) => {
          if (!filename) return;
          // Skip archive directory and dotfiles
          if (filename === "archive" || filename.startsWith(".")) return;

          const sessionId = filename;
          const filePath = join(sessionsDir, filename);

          // Per-file debounce: coalesce rapid writes (e.g. spawn writes 2-3 times)
          const existing = this.debounceTimers.get(sessionId);
          if (existing) clearTimeout(existing);

          this.debounceTimers.set(
            sessionId,
            setTimeout(() => {
              this.debounceTimers.delete(sessionId);
              const changeType = existsSync(filePath) ? "changed" : "removed";
              this.emit("session-change", {
                sessionId,
                type: changeType,
              } satisfies SessionChangeEvent);
            }, 300),
          );
        });

        this.watchers.push(watcher);

        watcher.on("error", (err) => {
          console.warn(`[session-watcher] Watch error on ${sessionsDir}:`, err);
        });
      } catch (err) {
        console.warn(`[session-watcher] Failed to watch ${sessionsDir}:`, err);
      }
    }
  }

  subscribe(): void {
    this.refCount++;
  }

  unsubscribe(): void {
    this.refCount--;
    if (this.refCount <= 0) {
      this.close();
    }
  }

  private close(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.started = false;
    this.refCount = 0;
    this.removeAllListeners();

    // Clear the globalThis cache so next subscriber creates a fresh watcher
    const g = globalThis as typeof globalThis & { _aoSessionWatcher?: SessionWatcher };
    if (g._aoSessionWatcher === this) {
      g._aoSessionWatcher = undefined;
    }
  }
}

/** Get or create the singleton SessionWatcher. */
export function getSessionWatcher(config: OrchestratorConfig): SessionWatcher {
  const g = globalThis as typeof globalThis & { _aoSessionWatcher?: SessionWatcher };
  if (!g._aoSessionWatcher) {
    g._aoSessionWatcher = new SessionWatcher();
    g._aoSessionWatcher.start(config);
  }
  return g._aoSessionWatcher;
}
