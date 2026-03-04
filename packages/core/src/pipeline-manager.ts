/**
 * Pipeline Manager — Pre-PR quality pipeline.
 *
 * Orchestrates a 4-stage pipeline before a PR is opened:
 *   1. Automated checks (lint, typecheck, build)
 *   2. Test agent (spawns a tester to write/run tests)
 *   3. Review agent (spawns a reviewer to code-review)
 *   4. Approved — ready for PR
 *
 * On failure at any stage, feedback is sent back to the coder session,
 * and the pipeline waits for the fix before retrying.
 *
 * The pipeline loops up to maxIterations times before giving up.
 */

import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  Session,
  SessionManager,
  OrchestratorConfig,
  PluginRegistry,
  PipelineConfig,
} from "./types.js";
import { TERMINAL_STATUSES } from "./types.js";
import { updateMetadata } from "./metadata.js";
import { getSessionsDir } from "./paths.js";

const execFileAsync = promisify(execFile);

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface PipelineDeps {
  sessionManager: SessionManager;
  config: OrchestratorConfig;
  registry: PluginRegistry;
}

export interface PipelineResult {
  stage: "checks" | "testing" | "reviewing" | "approved";
  success: boolean;
  message?: string;
  iteration: number;
}

export interface PipelineManager {
  run(session: Session): Promise<PipelineResult>;
  isRunning(sessionId: string): boolean;
}

// =============================================================================
// VERDICT FILE TYPES
// =============================================================================

interface ReviewVerdict {
  verdict: "approve" | "request_changes";
  summary: string;
  comments: string[];
}

function isReviewVerdict(value: unknown): value is ReviewVerdict {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj["verdict"] !== "approve" && obj["verdict"] !== "request_changes") return false;
  if (typeof obj["summary"] !== "string") return false;
  if (!Array.isArray(obj["comments"])) return false;
  return true;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CHECK_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes per check command
const AGENT_POLL_INTERVAL_MS = 5_000; // 5 seconds
const AGENT_TIMEOUT_MS = 600_000; // 10 minutes
const CODER_POLL_INTERVAL_MS = 10_000; // 10 seconds
const CODER_FIX_TIMEOUT_MS = 1_200_000; // 20 minutes

const DEFAULT_TEST_PROMPT = `You are a test-writing agent. Your job is to:
1. Examine the code changes in this workspace
2. Write comprehensive tests for the new or changed functionality
3. Run the tests to verify they pass
4. Fix any failing tests

Focus on edge cases, error handling, and integration between components.
Do NOT modify the source code — only add or update test files.`;

const DEFAULT_REVIEW_PROMPT_TEMPLATE = `You are a code review agent. Your job is to:
1. Review all code changes in this workspace
2. Check for bugs, security issues, code style, and best practices
3. Write your verdict to the file: .ao-review-SESSION_ID.json

The verdict file MUST be valid JSON with this exact structure:
{
  "verdict": "approve" or "request_changes",
  "summary": "Brief summary of your review",
  "comments": ["comment 1", "comment 2", ...]
}

If the code is good, set verdict to "approve".
If changes are needed, set verdict to "request_changes" and list specific issues in comments.

Do NOT modify any source or test files — only write the verdict file.`;

// =============================================================================
// HELPERS
// =============================================================================

function log(sessionId: string, message: string): void {
  console.log(`[PIPELINE] [${sessionId}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the sessions directory for a session's project.
 */
function getSessionDataDir(config: OrchestratorConfig, session: Session): string {
  const project = config.projects[session.projectId];
  if (!project) {
    throw new Error(`Unknown project: ${session.projectId}`);
  }
  return getSessionsDir(config.configPath, project.path);
}

/**
 * Get pipeline config with defaults.
 */
function getPipelineConfig(config: OrchestratorConfig): PipelineConfig {
  return (
    config.pipeline ?? {
      enabled: false,
      checkCommands: [],
      testAgent: { agent: "claude-code", model: "sonnet", maxRetries: 2 },
      reviewAgent: { agent: "claude-code", model: "sonnet", maxRetries: 2 },
      maxIterations: 3,
    }
  );
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createPipelineManager(deps: PipelineDeps): PipelineManager {
  const { sessionManager, config } = deps;
  const runningPipelines = new Set<string>();

  /**
   * Update the session status in metadata.
   */
  function setSessionStatus(session: Session, status: string): void {
    const dataDir = getSessionDataDir(config, session);
    updateMetadata(dataDir, session.id, { status });
    log(session.id, `Status -> ${status}`);
  }

  /**
   * Stage 1: Run automated check commands (lint, typecheck, build, etc.).
   */
  async function runChecks(session: Session, pipelineConfig: PipelineConfig): Promise<PipelineResult & { iteration: -1 }> {
    const workspace = session.workspacePath;
    if (!workspace) {
      return { stage: "checks", success: false, message: "No workspace path", iteration: -1 as -1 };
    }

    setSessionStatus(session, "checking");

    for (const cmd of pipelineConfig.checkCommands) {
      log(session.id, `Running check: ${cmd}`);

      // Split command on whitespace: "pnpm typecheck" -> ["pnpm", "typecheck"]
      const parts = cmd.trim().split(/\s+/);
      const command = parts[0];
      const args = parts.slice(1);

      if (!command) continue;

      try {
        await execFileAsync(command, args, {
          cwd: workspace,
          timeout: CHECK_COMMAND_TIMEOUT_MS,
          env: { ...process.env },
        });
        log(session.id, `Check passed: ${cmd}`);
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        const output = [error.stdout ?? "", error.stderr ?? ""].filter(Boolean).join("\n");
        const message = `Check failed: ${cmd}\n\n${output || error.message || "Unknown error"}`;
        log(session.id, `Check failed: ${cmd}`);
        return { stage: "checks", success: false, message, iteration: -1 as -1 };
      }
    }

    log(session.id, "All checks passed");
    return { stage: "checks", success: true, iteration: -1 as -1 };
  }

  /**
   * Poll a spawned agent session until it reaches a terminal status.
   * Returns the final session object.
   */
  async function pollUntilTerminal(
    spawnedSessionId: string,
    timeoutMs: number,
  ): Promise<Session | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const spawnedSession = await sessionManager.get(spawnedSessionId);
      if (!spawnedSession) {
        log(spawnedSessionId, "Spawned session not found");
        return null;
      }

      if (
        TERMINAL_STATUSES.has(spawnedSession.status) ||
        spawnedSession.activity === "exited"
      ) {
        log(spawnedSessionId, `Reached terminal state: status=${spawnedSession.status}, activity=${spawnedSession.activity ?? "null"}`);
        return spawnedSession;
      }

      await sleep(AGENT_POLL_INTERVAL_MS);
    }

    log(spawnedSessionId, "Timed out waiting for terminal state");
    return null;
  }

  /**
   * Build the test agent prompt, using custom promptFile if configured.
   */
  async function buildTestPrompt(pipelineConfig: PipelineConfig): Promise<string> {
    if (pipelineConfig.testAgent.promptFile) {
      try {
        const content = await readFile(pipelineConfig.testAgent.promptFile, "utf-8");
        return content;
      } catch {
        log("pipeline", `Failed to read test prompt file: ${pipelineConfig.testAgent.promptFile}, using default`);
      }
    }
    return DEFAULT_TEST_PROMPT;
  }

  /**
   * Build the review agent prompt, using custom promptFile if configured.
   */
  async function buildReviewPrompt(
    sessionId: string,
    pipelineConfig: PipelineConfig,
  ): Promise<string> {
    if (pipelineConfig.reviewAgent.promptFile) {
      try {
        const content = await readFile(pipelineConfig.reviewAgent.promptFile, "utf-8");
        // Replace placeholder with actual session ID
        return content.replace(/SESSION_ID/g, sessionId);
      } catch {
        log(sessionId, `Failed to read review prompt file: ${pipelineConfig.reviewAgent.promptFile}, using default`);
      }
    }
    return DEFAULT_REVIEW_PROMPT_TEMPLATE.replace(/SESSION_ID/g, sessionId);
  }

  /**
   * Stage 2: Spawn a test agent to write and run tests.
   */
  async function runTestAgent(
    session: Session,
    pipelineConfig: PipelineConfig,
  ): Promise<PipelineResult & { iteration: -1 }> {
    setSessionStatus(session, "testing");

    const prompt = await buildTestPrompt(pipelineConfig);
    log(session.id, "Spawning test agent");

    let spawnedSession: Session;
    try {
      spawnedSession = await sessionManager.spawn({
        projectId: session.projectId,
        workspacePath: session.workspacePath ?? undefined,
        role: "tester",
        parentSession: session.id,
        prompt,
        agent: pipelineConfig.testAgent.agent,
        skipPipeline: true,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(session.id, `Failed to spawn test agent: ${message}`);
      return { stage: "testing", success: false, message: `Failed to spawn test agent: ${message}`, iteration: -1 as -1 };
    }

    log(session.id, `Test agent spawned: ${spawnedSession.id}`);

    // Poll until test agent exits
    const finalSession = await pollUntilTerminal(spawnedSession.id, AGENT_TIMEOUT_MS);
    if (!finalSession) {
      return { stage: "testing", success: false, message: "Test agent timed out", iteration: -1 as -1 };
    }

    // Re-run checks to verify tests pass
    log(session.id, "Test agent finished, re-running checks");
    const checkResult = await runChecks(session, pipelineConfig);
    if (!checkResult.success) {
      return { stage: "testing", success: false, message: `Tests added but checks failed:\n${checkResult.message ?? ""}`, iteration: -1 as -1 };
    }

    log(session.id, "Test stage passed");
    return { stage: "testing", success: true, iteration: -1 as -1 };
  }

  /**
   * Stage 3: Spawn a review agent to code-review the changes.
   */
  async function runReviewAgent(
    session: Session,
    pipelineConfig: PipelineConfig,
  ): Promise<PipelineResult & { iteration: -1 }> {
    setSessionStatus(session, "reviewing");

    const prompt = await buildReviewPrompt(session.id, pipelineConfig);
    log(session.id, "Spawning review agent");

    let spawnedSession: Session;
    try {
      spawnedSession = await sessionManager.spawn({
        projectId: session.projectId,
        workspacePath: session.workspacePath ?? undefined,
        role: "reviewer",
        parentSession: session.id,
        prompt,
        agent: pipelineConfig.reviewAgent.agent,
        skipPipeline: true,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(session.id, `Failed to spawn review agent: ${message}`);
      return { stage: "reviewing", success: false, message: `Failed to spawn review agent: ${message}`, iteration: -1 as -1 };
    }

    log(session.id, `Review agent spawned: ${spawnedSession.id}`);

    // Poll until review agent exits
    const finalSession = await pollUntilTerminal(spawnedSession.id, AGENT_TIMEOUT_MS);
    if (!finalSession) {
      return { stage: "reviewing", success: false, message: "Review agent timed out", iteration: -1 as -1 };
    }

    // Read the verdict file
    const workspace = session.workspacePath;
    if (!workspace) {
      return { stage: "reviewing", success: false, message: "No workspace path for verdict file", iteration: -1 as -1 };
    }

    const verdictPath = path.join(workspace, `.ao-review-${session.id}.json`);
    let verdict: ReviewVerdict;

    try {
      const content = await readFile(verdictPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (!isReviewVerdict(parsed)) {
        return { stage: "reviewing", success: false, message: "Invalid verdict file format", iteration: -1 as -1 };
      }
      verdict = parsed;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(session.id, `Failed to read verdict file: ${message}`);
      return { stage: "reviewing", success: false, message: `Review agent did not produce a verdict file: ${message}`, iteration: -1 as -1 };
    }

    // Clean up verdict file
    try {
      await unlink(verdictPath);
    } catch {
      // Best effort — file may already be gone
    }

    if (verdict.verdict === "approve") {
      log(session.id, `Review approved: ${verdict.summary}`);
      return { stage: "reviewing", success: true, message: verdict.summary, iteration: -1 as -1 };
    }

    // Format feedback from review comments
    const feedback = [
      `Review requested changes: ${verdict.summary}`,
      "",
      ...verdict.comments.map((c, i) => `${i + 1}. ${c}`),
    ].join("\n");

    log(session.id, `Review requested changes: ${verdict.summary}`);
    return { stage: "reviewing", success: false, message: feedback, iteration: -1 as -1 };
  }

  /**
   * Send feedback to the coder session about a pipeline failure.
   */
  async function sendFeedback(session: Session, feedback: string): Promise<void> {
    log(session.id, "Sending feedback to coder session");
    try {
      await sessionManager.send(session.id, feedback);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(session.id, `Failed to send feedback: ${message}`);
    }
  }

  /**
   * Wait for the coder to apply a fix after receiving feedback.
   * Polls until the agent becomes idle/ready or reaches a terminal status.
   */
  async function awaitCoderFix(session: Session): Promise<boolean> {
    log(session.id, "Waiting for coder to apply fix");
    const deadline = Date.now() + CODER_FIX_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const currentSession = await sessionManager.get(session.id);
      if (!currentSession) {
        log(session.id, "Coder session not found");
        return false;
      }

      // If coder exited or reached terminal state, give up
      if (
        TERMINAL_STATUSES.has(currentSession.status) ||
        currentSession.activity === "exited"
      ) {
        log(session.id, "Coder session terminated while waiting for fix");
        return false;
      }

      // If coder is ready/idle, they've finished their fix
      if (
        currentSession.activity === "ready" ||
        currentSession.activity === "idle"
      ) {
        log(session.id, "Coder fix detected (agent became ready/idle)");
        return true;
      }

      await sleep(CODER_POLL_INTERVAL_MS);
    }

    log(session.id, "Timed out waiting for coder fix");
    return false;
  }

  /**
   * Main pipeline run loop.
   */
  async function run(session: Session): Promise<PipelineResult> {
    const pipelineConfig = getPipelineConfig(config);

    // If pipeline is disabled, immediately approve
    if (!pipelineConfig.enabled) {
      log(session.id, "Pipeline disabled, auto-approving");
      return { stage: "approved", success: true, iteration: 0 };
    }

    // Skip pipeline for tester/reviewer sessions (avoid infinite recursion)
    if (session.metadata["role"] === "tester" || session.metadata["role"] === "reviewer") {
      log(session.id, "Skipping pipeline for sub-agent session");
      return { stage: "approved", success: true, iteration: 0 };
    }

    // Skip if explicitly flagged
    if (session.metadata["skipPipeline"] === "true") {
      log(session.id, "Pipeline skipped via flag");
      return { stage: "approved", success: true, iteration: 0 };
    }

    // Guard against concurrent runs on the same session
    if (runningPipelines.has(session.id)) {
      return { stage: "checks", success: false, message: "Pipeline already running for this session", iteration: 0 };
    }

    runningPipelines.add(session.id);
    const maxIterations = pipelineConfig.maxIterations;

    try {
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        log(session.id, `Pipeline iteration ${iteration}/${maxIterations}`);

        // Stage 1: Automated checks
        const checkResult = await runChecks(session, pipelineConfig);
        if (!checkResult.success) {
          log(session.id, `Checks failed (iteration ${iteration}): ${checkResult.message ?? ""}`);
          if (iteration < maxIterations) {
            await sendFeedback(
              session,
              `[PIPELINE] Automated checks failed (attempt ${iteration}/${maxIterations}):\n\n${checkResult.message ?? "Unknown failure"}`,
            );
            const fixed = await awaitCoderFix(session);
            if (!fixed) {
              return { stage: "checks", success: false, message: checkResult.message, iteration };
            }
            continue;
          }
          return { stage: "checks", success: false, message: checkResult.message, iteration };
        }

        // Stage 2: Test agent
        const testResult = await runTestAgent(session, pipelineConfig);
        if (!testResult.success) {
          log(session.id, `Testing failed (iteration ${iteration}): ${testResult.message ?? ""}`);
          if (iteration < maxIterations) {
            await sendFeedback(
              session,
              `[PIPELINE] Testing stage failed (attempt ${iteration}/${maxIterations}):\n\n${testResult.message ?? "Unknown failure"}`,
            );
            const fixed = await awaitCoderFix(session);
            if (!fixed) {
              return { stage: "testing", success: false, message: testResult.message, iteration };
            }
            continue;
          }
          return { stage: "testing", success: false, message: testResult.message, iteration };
        }

        // Stage 3: Review agent
        const reviewResult = await runReviewAgent(session, pipelineConfig);
        if (!reviewResult.success) {
          log(session.id, `Review failed (iteration ${iteration}): ${reviewResult.message ?? ""}`);
          if (iteration < maxIterations) {
            await sendFeedback(
              session,
              `[PIPELINE] Code review requested changes (attempt ${iteration}/${maxIterations}):\n\n${reviewResult.message ?? "Unknown failure"}`,
            );
            const fixed = await awaitCoderFix(session);
            if (!fixed) {
              return { stage: "reviewing", success: false, message: reviewResult.message, iteration };
            }
            continue;
          }
          return { stage: "reviewing", success: false, message: reviewResult.message, iteration };
        }

        // All stages passed
        log(session.id, `Pipeline approved (iteration ${iteration})`);
        setSessionStatus(session, "approved");
        return { stage: "approved", success: true, message: reviewResult.message, iteration };
      }

      // Exhausted all iterations
      log(session.id, `Pipeline exhausted after ${maxIterations} iterations`);
      return {
        stage: "checks",
        success: false,
        message: `Pipeline failed after ${maxIterations} iterations`,
        iteration: maxIterations,
      };
    } finally {
      runningPipelines.delete(session.id);
    }
  }

  function isRunning(sessionId: string): boolean {
    return runningPipelines.has(sessionId);
  }

  return { run, isRunning };
}
