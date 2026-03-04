/**
 * Launch the internal HTTP server for inter-process lifecycle signalling.
 *
 * Accepts a real LifecycleManager (with pipeline support) when available,
 * or falls back to a minimal adapter that just refreshes session metadata.
 */

import http from "node:http";
import { createInternalServer } from "@composio/ao-core";
import type { LifecycleManager, SessionManager } from "@composio/ao-core";

/**
 * Build a minimal LifecycleManager adapter that delegates check() to
 * sessionManager.get(), which forces a metadata refresh. Used as fallback
 * when no real lifecycle manager is provided.
 */
function buildLifecycleAdapter(sm: SessionManager): LifecycleManager {
  return {
    start: () => {},
    stop: () => {},
    getStates: () => new Map(),
    check: async (sessionId: string) => {
      await sm.get(sessionId);
    },
  };
}

export async function startInternalServer(
  sm: SessionManager,
  port = 3101,
  lifecycle?: LifecycleManager,
): Promise<http.Server> {
  const lm = lifecycle ?? buildLifecycleAdapter(sm);
  const server = createInternalServer(lm, port);

  // Bind to loopback only — never 0.0.0.0
  server.listen(port, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  // Resolve actual port (for port 0 / OS-assigned)
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;

  // Make port available to child processes (agents)
  process.env["AO_INTERNAL_PORT"] = String(actualPort);

  return server;
}
