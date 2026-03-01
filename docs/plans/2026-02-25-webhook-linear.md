# Linear Webhook Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Linear webhook server package that spawns agents when issues get labeled or completed.

**Architecture:** Express server at `packages/webhook-linear/` receives Linear webhooks, verifies signatures, and calls `ao spawn`. Two triggers: "agent-ready" label spawns coding agent, "Done" state spawns test-gen agent. In-memory dedup prevents double-spawns.

**Tech Stack:** Express, node:crypto (timingSafeEqual), vitest for tests.

---

### Task 1: Scaffold the package

**Files:**
- Create: `packages/webhook-linear/package.json`
- Create: `packages/webhook-linear/tsconfig.json`
- Create: `packages/webhook-linear/src/server.ts` (empty placeholder)

**Step 1: Create package.json**

```json
{
  "name": "@composio/ao-webhook-linear",
  "version": "0.1.0",
  "private": true,
  "description": "Linear webhook server — spawns agents on issue events",
  "license": "MIT",
  "type": "module",
  "main": "dist/server.js",
  "types": "dist/server.d.ts",
  "exports": {
    ".": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js"
    }
  },
  "files": ["dist"],
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "node --watch dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "express": "^5.1.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^25.2.3",
    "typescript": "^5.7.0",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Create empty `src/server.ts`**

Just a placeholder comment.

**Step 4: Run `pnpm install` from repo root**

Run: `pnpm install`
Expected: Installs express + devDeps, links workspace.

**Step 5: Verify build scaffolding**

Run: `cd packages/webhook-linear && pnpm typecheck`
Expected: PASS (empty file).

**Step 6: Commit**

```
feat(webhook-linear): scaffold package
```

---

### Task 2: Write core types and config module

Extract types and config into a testable module separate from the Express server.

**Files:**
- Create: `packages/webhook-linear/src/types.ts`
- Create: `packages/webhook-linear/src/config.ts`

**Step 1: Create `src/types.ts`**

```typescript
export interface LinearLabel {
  id: string;
  name: string;
}

export interface LinearState {
  id: string;
  name: string;
  type: string;
}

export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "IssueLabel" | "Comment" | "Project" | string;
  data: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state?: LinearState;
    team?: {
      id: string;
      key: string;
      name: string;
    };
    labels?: LinearLabel[];
    labelIds?: string[];
  };
  updatedFrom?: {
    stateId?: string;
    labelIds?: string[];
    state?: LinearState;
  };
}

export type SpawnType = "code" | "test-gen";
```

**Step 2: Create `src/config.ts`**

```typescript
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebhookConfig {
  port: number;
  webhookSecret: string;
  aoProjectId: string;
  aoBin: string;
  dashboardTeamId: string;
  triggerLabel: string;
  dryRun: boolean;
  testGenPrompt: string;
}

export function loadConfig(): WebhookConfig {
  const port = parseInt(process.env["PORT"] ?? "3100", 10);
  const webhookSecret = process.env["LINEAR_WEBHOOK_SECRET"] ?? "";
  const aoProjectId = process.env["AO_PROJECT_ID"] ?? "dashboard";
  const aoBin = process.env["AO_BIN"] ?? "ao";
  const dashboardTeamId =
    process.env["DASHBOARD_TEAM_ID"] ?? "f65d8805-05b4-41d2-a90b-dffe27e24d0b";
  const triggerLabel = process.env["TRIGGER_LABEL"] ?? "agent-ready";
  const dryRun = process.env["DRY_RUN"] === "true";

  const testGenPromptFile = resolve(
    process.env["TEST_GEN_PROMPT_FILE"] ?? resolve(__dirname, "../../test-gen-prompt.md"),
  );

  let testGenPrompt: string;
  try {
    testGenPrompt = readFileSync(testGenPromptFile, "utf-8");
  } catch {
    throw new Error(`Cannot read test-gen prompt: ${testGenPromptFile}`);
  }

  return {
    port,
    webhookSecret,
    aoProjectId,
    aoBin,
    dashboardTeamId,
    triggerLabel,
    dryRun,
    testGenPrompt,
  };
}
```

**Step 3: Commit**

```
feat(webhook-linear): add types and config module
```

---

### Task 3: Write event detection logic with tests (TDD)

**Files:**
- Create: `packages/webhook-linear/src/events.ts`
- Create: `packages/webhook-linear/test/events.test.ts`

**Step 1: Write failing tests for `wasLabelAdded` and `wasMovedToCompleted`**

Test cases:
- `wasLabelAdded` returns true when label is newly added
- `wasLabelAdded` returns false when label was already present
- `wasLabelAdded` returns false when label not in current labels
- `wasLabelAdded` is case-insensitive
- `wasMovedToCompleted` returns true when state.type becomes "completed"
- `wasMovedToCompleted` returns false when already completed
- `wasMovedToCompleted` returns false when no state

**Step 2: Run tests to verify they fail**

Run: `cd packages/webhook-linear && pnpm test`
Expected: FAIL — module not found.

**Step 3: Implement `src/events.ts`**

```typescript
import type { LinearWebhookPayload } from "./types.js";

export function wasLabelAdded(payload: LinearWebhookPayload, labelName: string): boolean {
  const currentLabels = payload.data.labels;
  if (!currentLabels) return false;

  const target = labelName.toLowerCase();
  const matchingLabel = currentLabels.find((l) => l.name.toLowerCase() === target);
  if (!matchingLabel) return false;

  const previousLabelIds = payload.updatedFrom?.labelIds;
  if (previousLabelIds && previousLabelIds.includes(matchingLabel.id)) {
    return false;
  }

  return true;
}

export function wasMovedToCompleted(payload: LinearWebhookPayload): boolean {
  const currentState = payload.data.state;
  const previousState = payload.updatedFrom?.state;

  if (!currentState || currentState.type !== "completed") return false;
  if (previousState?.type === "completed") return false;

  return true;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/webhook-linear && pnpm test`
Expected: PASS.

**Step 5: Commit**

```
feat(webhook-linear): add event detection with tests
```

---

### Task 4: Write signature verification with tests (TDD)

**Files:**
- Create: `packages/webhook-linear/src/verify.ts`
- Create: `packages/webhook-linear/test/verify.test.ts`

**Step 1: Write failing tests**

Test cases:
- Valid signature returns true
- Invalid signature returns false
- Mismatched length returns false
- Empty secret skips verification (returns true + warns)
- Missing signature with secret configured returns false (security fix from review)

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `src/verify.ts`**

Use `timingSafeEqual` instead of `===` (security fix from review):

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(
  body: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!secret) {
    console.warn("[WARN] LINEAR_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }

  if (!signature) {
    console.warn("[WARN] No signature header — rejecting");
    return false;
  }

  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  const expected = hmac.digest("hex");

  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(webhook-linear): add timing-safe signature verification
```

---

### Task 5: Write dedup tracker with tests (TDD)

**Files:**
- Create: `packages/webhook-linear/src/dedup.ts`
- Create: `packages/webhook-linear/test/dedup.test.ts`

**Step 1: Write failing tests**

Test cases:
- `wasRecentlySpawned` returns false for unknown issue
- `markSpawned` + `wasRecentlySpawned` returns true
- Different spawn types are independent
- Expired entries return false
- `cleanup` removes expired entries

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `src/dedup.ts`**

```typescript
import type { SpawnType } from "./types.js";

const DEDUP_WINDOW_MS = 5 * 60 * 1000;

const recentSpawns = new Map<string, number>();

function dedupKey(issueId: string, type: SpawnType): string {
  return `${issueId}:${type}`;
}

export function wasRecentlySpawned(issueId: string, type: SpawnType): boolean {
  const key = dedupKey(issueId, type);
  const lastSpawn = recentSpawns.get(key);
  if (!lastSpawn) return false;
  if (Date.now() - lastSpawn > DEDUP_WINDOW_MS) {
    recentSpawns.delete(key);
    return false;
  }
  return true;
}

export function markSpawned(issueId: string, type: SpawnType): void {
  recentSpawns.set(dedupKey(issueId, type), Date.now());
}

export function cleanup(): void {
  const now = Date.now();
  for (const [key, timestamp] of recentSpawns) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      recentSpawns.delete(key);
    }
  }
}

export function reset(): void {
  recentSpawns.clear();
}

export function entries(): ReadonlyMap<string, number> {
  return recentSpawns;
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(webhook-linear): add dedup tracker with tests
```

---

### Task 6: Write spawn helpers with tests (TDD)

**Files:**
- Create: `packages/webhook-linear/src/spawn.ts`
- Create: `packages/webhook-linear/test/spawn.test.ts`

**Step 1: Write failing tests**

Mock `execFile` and `writeFileSync`. Test cases:
- `spawnCodingAgent` calls `ao spawn <project> <identifier>`
- `spawnCodingAgent` skips if recently spawned
- `spawnCodingAgent` in dry-run mode logs without executing
- `spawnTestGenAgent` writes prompt to temp file and calls `ao spawn` with `--prompt`
- `spawnTestGenAgent` skips if recently spawned
- `spawnTestGenAgent` cleans up temp file after spawn

**Step 2: Run tests — expect FAIL**

**Step 3: Implement `src/spawn.ts`**

Key changes from original:
- Accept config as parameter (testable)
- Clean up temp files after spawn (fix from review)
- Return promises with proper error handling (no unhandled rejections)

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync } from "node:fs";
import { wasRecentlySpawned, markSpawned } from "./dedup.js";
import type { WebhookConfig } from "./config.js";

const execFileAsync = promisify(execFile);

async function runAoSpawn(
  aoBin: string,
  args: string[],
  label: string,
  dryRun: boolean,
): Promise<boolean> {
  if (dryRun) {
    console.log(`[DRY_RUN] Would run: ${aoBin} ${args.join(" ")}`);
    return true;
  }

  try {
    const { stdout, stderr } = await execFileAsync(aoBin, args, {
      timeout: 30_000,
    });
    console.log(`[OK] ${label}`);
    if (stdout.trim()) console.log(`  stdout: ${stdout.trim()}`);
    if (stderr.trim()) console.log(`  stderr: ${stderr.trim()}`);
    return true;
  } catch (err) {
    console.error(`[ERROR] ${label}:`, err);
    return false;
  }
}

export async function spawnCodingAgent(
  issueIdentifier: string,
  issueTitle: string,
  config: WebhookConfig,
): Promise<void> {
  if (wasRecentlySpawned(issueIdentifier, "code")) {
    console.log(`[SKIP] ${issueIdentifier} (code) — already spawned within dedup window`);
    return;
  }

  console.log(`[SPAWN:CODE] ${issueIdentifier}: "${issueTitle}"`);

  const success = await runAoSpawn(
    config.aoBin,
    ["spawn", config.aoProjectId, issueIdentifier],
    `Coding agent for ${issueIdentifier}`,
    config.dryRun,
  );

  if (success) {
    markSpawned(issueIdentifier, "code");
  }
}

export async function spawnTestGenAgent(
  issueIdentifier: string,
  issueTitle: string,
  config: WebhookConfig,
): Promise<void> {
  if (wasRecentlySpawned(issueIdentifier, "test-gen")) {
    console.log(`[SKIP] ${issueIdentifier} (test-gen) — already spawned within dedup window`);
    return;
  }

  const prompt = [
    config.testGenPrompt,
    "",
    "## Target Issue",
    `Issue: ${issueIdentifier}`,
    `Title: ${issueTitle}`,
    "",
    "Generate tests for the changes introduced by this issue. The code has already been merged to main.",
  ].join("\n");

  console.log(`[SPAWN:TEST] ${issueIdentifier}: "${issueTitle}"`);

  const promptFile = `/tmp/ao-testgen-${issueIdentifier}.md`;
  writeFileSync(promptFile, prompt, "utf-8");

  try {
    const success = await runAoSpawn(
      config.aoBin,
      ["spawn", config.aoProjectId, issueIdentifier, "--prompt", promptFile],
      `Test-gen agent for ${issueIdentifier}`,
      config.dryRun,
    );

    if (success) {
      markSpawned(issueIdentifier, "test-gen");
    }
  } finally {
    try {
      unlinkSync(promptFile);
    } catch {
      // best-effort cleanup
    }
  }
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```
feat(webhook-linear): add spawn helpers with tests
```

---

### Task 7: Assemble the Express server

**Files:**
- Create: `packages/webhook-linear/src/server.ts`

**Step 1: Write `src/server.ts`**

Wire together all modules. The server itself is thin — just Express routing that delegates to the tested modules.

```typescript
import express from "express";
import { loadConfig } from "./config.js";
import { verifySignature } from "./verify.js";
import { wasLabelAdded, wasMovedToCompleted } from "./events.js";
import { spawnCodingAgent, spawnTestGenAgent } from "./spawn.js";
import { cleanup, entries } from "./dedup.js";
import type { LinearWebhookPayload } from "./types.js";

const config = loadConfig();
const app = express();

app.use("/webhook/linear", express.raw({ type: "application/json" }));

app.post("/webhook/linear", (req, res) => {
  const body = req.body as Buffer;
  const signature = req.headers["linear-signature"] as string | undefined;

  if (!verifySignature(body, signature, config.webhookSecret)) {
    console.warn("[REJECT] Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(body.toString("utf-8")) as LinearWebhookPayload;
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  res.status(200).json({ ok: true });

  if (payload.type !== "Issue" || payload.action !== "update") return;
  if (payload.data.team?.id !== config.dashboardTeamId) return;

  const { identifier, title } = payload.data;

  if (wasLabelAdded(payload, config.triggerLabel)) {
    console.log(`[EVENT] ${identifier} — label "${config.triggerLabel}" added`);
    spawnCodingAgent(identifier, title, config).catch((err) =>
      console.error(`[ERROR] spawnCodingAgent(${identifier}):`, err),
    );
    return;
  }

  if (wasMovedToCompleted(payload)) {
    const stateName = payload.data.state?.name ?? "Done";
    const prevName = payload.updatedFrom?.state?.name ?? "unknown";
    console.log(`[EVENT] ${identifier} → ${stateName} (was: ${prevName})`);
    spawnTestGenAgent(identifier, title, config).catch((err) =>
      console.error(`[ERROR] spawnTestGenAgent(${identifier}):`, err),
    );
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    project: config.aoProjectId,
    teamId: config.dashboardTeamId,
    triggerLabel: config.triggerLabel,
    dryRun: config.dryRun,
    recentSpawns: Object.fromEntries(entries()),
  });
});

const cleanupInterval = setInterval(cleanup, 60_000);

const server = app.listen(config.port, () => {
  console.log(`[ao-linear-webhook] Listening on :${config.port}`);
  console.log(`  Project:       ${config.aoProjectId}`);
  console.log(`  Team:          ${config.dashboardTeamId}`);
  console.log(`  Trigger label: ${config.triggerLabel}`);
  console.log(`  Dry run:       ${config.dryRun}`);
});

process.once("SIGTERM", () => {
  clearInterval(cleanupInterval);
  server.close();
});
```

**Step 2: Build and verify**

Run: `cd packages/webhook-linear && pnpm build`
Expected: PASS, compiles cleanly.

**Step 3: Commit**

```
feat(webhook-linear): assemble Express server
```

---

### Task 8: Add example config and test-gen prompt

**Files:**
- Create: `packages/webhook-linear/test-gen-prompt.md`
- Create: `examples/webhook-linear.yaml`

**Step 1: Create `test-gen-prompt.md`**

A starter test-gen prompt template. User will customize.

```markdown
# Test Generation Instructions

You are a test-generation agent. Your job is to write comprehensive tests for code that was recently merged to main.

## Guidelines

- Write unit tests using vitest
- Cover happy path, edge cases, and error cases
- Mock external dependencies
- Keep tests focused and readable
- Run all tests before opening the PR
- Create a branch named `test/{issue-identifier}-coverage`
```

**Step 2: Create `examples/webhook-linear.yaml`**

Example AO config snippet showing the webhook setup.

**Step 3: Commit**

```
feat(webhook-linear): add example config and test-gen prompt
```

---

### Task 9: Verify full build and lint

**Step 1: Run full build**

Run: `pnpm build`
Expected: PASS — all packages including webhook-linear.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

**Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (fix any issues).

**Step 4: Run tests**

Run: `pnpm test`
Expected: PASS.

**Step 5: Commit any fixes**

```
chore(webhook-linear): fix lint/type issues
```
