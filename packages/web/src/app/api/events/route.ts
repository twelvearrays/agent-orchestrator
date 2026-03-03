import { getServices } from "@/lib/services";
import { sessionToDashboard } from "@/lib/serialize";
import { getAttentionLevel } from "@/lib/types";
import { getSessionWatcher, type SessionChangeEvent } from "@/lib/session-watcher";

export const dynamic = "force-dynamic";

/**
 * GET /api/events — SSE stream for real-time lifecycle events
 *
 * Uses fs.watch() on session metadata directories for near-instant updates.
 * On file change: reads just the changed session and pushes a targeted event.
 * 30s fallback poll catches activity state changes from JSONL files (not in metadata dirs).
 * 15s heartbeat keeps the connection alive.
 */
export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let fallbackPoll: ReturnType<typeof setInterval> | undefined;
  let watcherCleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      function send(data: string): boolean {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          return true;
        } catch {
          cleanup();
          return false;
        }
      }

      function cleanup(): void {
        clearInterval(heartbeat);
        clearInterval(fallbackPoll);
        watcherCleanup?.();
        heartbeat = undefined;
        fallbackPoll = undefined;
        watcherCleanup = undefined;
      }

      // Send initial snapshot + set up watcher
      void (async () => {
        let services;
        try {
          services = await getServices();
        } catch {
          send(JSON.stringify({ type: "snapshot", sessions: [] }));
          return;
        }

        const { sessionManager, config } = services;

        // Send initial snapshot
        try {
          const sessions = await sessionManager.list();
          const dashboardSessions = sessions.map(sessionToDashboard);
          send(
            JSON.stringify({
              type: "snapshot",
              sessions: dashboardSessions.map((s) => ({
                id: s.id,
                status: s.status,
                activity: s.activity,
                attentionLevel: getAttentionLevel(s),
                lastActivityAt: s.lastActivityAt,
              })),
            }),
          );
        } catch {
          send(JSON.stringify({ type: "snapshot", sessions: [] }));
        }

        // Subscribe to file watcher for targeted updates
        const watcher = getSessionWatcher(config);
        watcher.subscribe();

        const onChange = (event: SessionChangeEvent) => {
          void (async () => {
            if (event.type === "removed") {
              send(JSON.stringify({ type: "session-removed", sessionId: event.sessionId }));
              return;
            }

            // File changed — read just this session
            try {
              const session = await sessionManager.get(event.sessionId);
              if (!session) {
                send(JSON.stringify({ type: "session-removed", sessionId: event.sessionId }));
                return;
              }
              const dashboard = sessionToDashboard(session);
              send(
                JSON.stringify({
                  type: "session-update",
                  session: {
                    id: dashboard.id,
                    status: dashboard.status,
                    activity: dashboard.activity,
                    attentionLevel: getAttentionLevel(dashboard),
                    lastActivityAt: dashboard.lastActivityAt,
                  },
                }),
              );
            } catch {
              // Transient read error — skip, next change or fallback poll will catch it
            }
          })();
        };

        watcher.on("session-change", onChange);

        watcherCleanup = () => {
          watcher.off("session-change", onChange);
          watcher.unsubscribe();
        };

        // 30s fallback poll: catches activity state changes from JSONL files
        // (which live in workspace dirs, not in the watched metadata dirs)
        fallbackPoll = setInterval(() => {
          void (async () => {
            try {
              const { sessionManager: sm } = await getServices();
              const sessions = await sm.list();
              const dashboardSessions = sessions.map(sessionToDashboard);
              send(
                JSON.stringify({
                  type: "snapshot",
                  sessions: dashboardSessions.map((s) => ({
                    id: s.id,
                    status: s.status,
                    activity: s.activity,
                    attentionLevel: getAttentionLevel(s),
                    lastActivityAt: s.lastActivityAt,
                  })),
                }),
              );
            } catch {
              // Transient service error — skip, retry on next interval
            }
          })();
        }, 30_000);
      })();

      // 15s heartbeat
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
          clearInterval(fallbackPoll);
          watcherCleanup?.();
        }
      }, 15_000);
    },
    cancel() {
      clearInterval(heartbeat);
      clearInterval(fallbackPoll);
      watcherCleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
