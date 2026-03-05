/**
 * ao-daemon — standalone lifecycle/pipeline daemon.
 *
 * Runs the session polling loop, pre-PR pipeline, and internal signal server
 * as a standalone process. Can run as a systemd service on the VPS or be
 * spawned as a child process by `ao start`.
 *
 * Config via env vars:
 *   AO_CONFIG_PATH    — path to agent-orchestrator.yaml (required)
 *   AO_INTERNAL_PORT  — internal signal server port (default: 3101)
 *   AO_POLL_INTERVAL  — poll interval in ms (default: 30000)
 */

import {
  loadConfig,
  createPluginRegistry,
  createSessionManager,
  createPipelineManager,
  createLifecycleManager,
  createInternalServer,
} from "@composio/ao-core";

async function main(): Promise<void> {
  const configPath = process.env["AO_CONFIG_PATH"];
  if (!configPath) {
    console.error("ao-daemon: AO_CONFIG_PATH environment variable is required");
    process.exit(1);
  }

  const internalPort = parseInt(process.env["AO_INTERNAL_PORT"] ?? "3101", 10);
  const pollInterval = parseInt(process.env["AO_POLL_INTERVAL"] ?? "30000", 10);

  // Load config
  const config = loadConfig(configPath);

  // Build plugin registry — pass daemon's import context so pnpm strict
  // resolution can find plugin packages from this package's dependencies.
  const registry = createPluginRegistry();
  await registry.loadFromConfig(config, (pkg: string) => import(pkg));

  // Create managers
  const sessionManager = createSessionManager({ config, registry });
  const pipelineManager = createPipelineManager({ sessionManager, config, registry });
  const lifecycleManager = createLifecycleManager({
    config,
    registry,
    sessionManager,
    pipelineManager,
  });

  // Start internal signal server (for webhook relay + Claude Code hook push)
  const server = createInternalServer(lifecycleManager, internalPort);
  server.listen(internalPort, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  // Start lifecycle polling loop
  lifecycleManager.start(pollInterval);

  console.log(
    `ao-daemon running, polling every ${pollInterval / 1000}s, internal server on :${internalPort}`,
  );

  // Graceful shutdown
  const shutdown = (): void => {
    console.log("ao-daemon shutting down");
    lifecycleManager.stop();
    server.close();
    process.exit(0);
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  console.error("ao-daemon failed to start:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
