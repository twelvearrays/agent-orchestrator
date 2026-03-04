import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createPipelineManager } from "../pipeline-manager.js";
import type {
  Session,
  SessionManager,
  OrchestratorConfig,
  PluginRegistry,
  PipelineConfig,
} from "../types.js";

// =============================================================================
// TEST HELPERS
// =============================================================================

let tmpDir: string;
let configPath: string;

function makePipelineConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    enabled: true,
    checkCommands: ["echo ok"],
    testAgent: { agent: "mock-agent", model: "test-model", maxRetries: 2 },
    reviewAgent: { agent: "mock-agent", model: "test-model", maxRetries: 2 },
    maxIterations: 3,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "app-1",
    projectId: "test-project",
    status: "working",
    activity: "active",
    branch: "feat/test",
    issueId: null,
    pr: null,
    workspacePath: tmpDir,
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: { role: "coder" },
    ...overrides,
  };
}

function makeConfig(pipeline?: PipelineConfig): OrchestratorConfig {
  return {
    configPath,
    readyThresholdMs: 300_000,
    defaults: {
      runtime: "mock",
      agent: "mock-agent",
      workspace: "mock-ws",
      notifiers: [],
    },
    projects: {
      "test-project": {
        name: "Test Project",
        repo: "owner/repo",
        path: tmpDir,
        defaultBranch: "main",
        sessionPrefix: "app",
      },
    },
    notifiers: {},
    notificationRouting: {
      urgent: [],
      action: [],
      warning: [],
      info: [],
    },
    reactions: {},
    pipeline,
  };
}

function makeSessionManager(overrides?: Partial<SessionManager>): SessionManager {
  return {
    spawn: vi.fn().mockResolvedValue(makeSession({ id: "app-2", status: "spawning" })),
    spawnOrchestrator: vi.fn().mockResolvedValue(makeSession()),
    restore: vi.fn().mockResolvedValue(makeSession()),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    kill: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue({ killed: [], skipped: [], errors: [] }),
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeRegistry(): PluginRegistry {
  return {
    register: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    list: vi.fn().mockReturnValue([]),
    loadBuiltins: vi.fn().mockResolvedValue(undefined),
    loadFromConfig: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `ao-test-pipeline-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  configPath = join(tmpDir, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
});

// =============================================================================
// TESTS
// =============================================================================

describe("createPipelineManager", () => {
  it("returns an object with run and isRunning methods", () => {
    const sm = makeSessionManager();
    const config = makeConfig();
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });

    expect(pm).toBeDefined();
    expect(typeof pm.run).toBe("function");
    expect(typeof pm.isRunning).toBe("function");
  });
});

describe("pipeline disabled", () => {
  it("returns approved immediately when pipeline is disabled", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(makePipelineConfig({ enabled: false }));
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(makeSession());

    expect(result.success).toBe(true);
    expect(result.stage).toBe("approved");
    expect(result.iteration).toBe(0);
  });

  it("returns approved when pipeline config is undefined", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(undefined);
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(makeSession());

    expect(result.success).toBe(true);
    expect(result.stage).toBe("approved");
  });
});

describe("pipeline skipped", () => {
  it("skips pipeline for tester role", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(makePipelineConfig());
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(makeSession({ metadata: { role: "tester" } }));

    expect(result.success).toBe(true);
    expect(result.stage).toBe("approved");
  });

  it("skips pipeline for reviewer role", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(makePipelineConfig());
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(makeSession({ metadata: { role: "reviewer" } }));

    expect(result.success).toBe(true);
    expect(result.stage).toBe("approved");
  });

  it("skips pipeline when skipPipeline flag is set", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(makePipelineConfig());
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(
      makeSession({ metadata: { role: "coder", skipPipeline: "true" } }),
    );

    expect(result.success).toBe(true);
    expect(result.stage).toBe("approved");
  });
});

describe("isRunning", () => {
  it("returns false for unknown session", () => {
    const sm = makeSessionManager();
    const config = makeConfig();
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    expect(pm.isRunning("nonexistent")).toBe(false);
  });

  it("tracks active pipelines", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(makePipelineConfig({ enabled: false }));
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const session = makeSession();

    // Not running before
    expect(pm.isRunning(session.id)).toBe(false);

    // Run (disabled pipeline returns immediately)
    await pm.run(session);

    // Not running after (disabled pipeline completes synchronously)
    expect(pm.isRunning(session.id)).toBe(false);
  });
});

describe("checks stage", () => {
  it("fails when session has no workspace path", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(makePipelineConfig());
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(makeSession({ workspacePath: null }));

    expect(result.success).toBe(false);
    expect(result.stage).toBe("checks");
    expect(result.message).toContain("No workspace path");
  });

  it("passes when all check commands succeed", async () => {
    // Use a pipeline with only checks (no test/review agents needed)
    // We mock out the test and review stages by having the spawn fail gracefully
    const spawnCall = vi.fn().mockRejectedValue(new Error("spawn disabled in test"));
    const sm = makeSessionManager({ spawn: spawnCall });
    const config = makeConfig(
      makePipelineConfig({
        checkCommands: ["echo hello", "echo world"],
        maxIterations: 1,
      }),
    );
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(makeSession());

    // Checks pass, but test agent spawn fails
    expect(result.stage).toBe("testing");
    expect(result.success).toBe(false);
  });

  it("fails when a check command fails", async () => {
    const sm = makeSessionManager();
    const config = makeConfig(
      makePipelineConfig({
        checkCommands: ["false"],
        maxIterations: 1,
      }),
    );
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const result = await pm.run(makeSession());

    expect(result.success).toBe(false);
    expect(result.stage).toBe("checks");
    expect(result.message).toContain("Check failed: false");
  });
});

describe("concurrent pipeline guard", () => {
  it("rejects concurrent run on same session", async () => {
    // The first run will: pass checks (sleep 0.5), then try to spawn test agent.
    // We make get() return a terminal session so pollUntilTerminal exits quickly,
    // but the 0.5s sleep gives us enough time to start a concurrent run.
    const sm = makeSessionManager({
      // get() returns a terminal session so pollUntilTerminal finishes
      get: vi.fn().mockResolvedValue(makeSession({ id: "app-2", status: "done", activity: "exited" })),
    });
    const config = makeConfig(
      makePipelineConfig({
        checkCommands: ["sleep 0.5"],
        maxIterations: 1,
      }),
    );
    const registry = makeRegistry();

    const pm = createPipelineManager({ sessionManager: sm, config, registry });
    const session = makeSession();

    // Start first run (will take ~0.5s due to sleep command)
    const run1 = pm.run(session);

    // Immediately verify isRunning
    expect(pm.isRunning(session.id)).toBe(true);

    // Try to start second run concurrently
    const run2 = pm.run(session);

    const result2 = await run2;
    expect(result2.success).toBe(false);
    expect(result2.message).toContain("Pipeline already running");

    // Clean up first run
    await run1;
  });
});
