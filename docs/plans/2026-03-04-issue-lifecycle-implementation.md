# Issue Lifecycle & PR Adoption Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add issue triage queue to dashboard, auto-spawn agents on `agent-ready` label, failure guards, full `/issues` page, and "Adopt PR" for human PRs.

**Architecture:** New `issueQueue` config section drives a home-page queue panel + `/issues` page. `GET /api/issues` fetches from tracker and cross-references sessions. `PUT /api/issues/:id/assign` adds label + spawns. Webhook detects label changes from Linear. `POST /api/prs/:id/adopt` creates pipeline-only sessions. Both trackers need `removeLabels` support added to `updateIssue()`.

**Tech Stack:** TypeScript ESM, Next.js 15 App Router, Tailwind CSS, Zod config validation, existing tracker/SCM plugin interfaces.

**Design doc:** `docs/plans/2026-03-04-issue-lifecycle-design.md`

---

## Task 1: Add `issueQueue` Config Schema

**Files:**
- Modify: `packages/core/src/config.ts:138-155` (OrchestratorConfigSchema)
- Modify: `packages/core/src/types.ts` (add IssueQueueConfig type)

**Step 1: Add type to types.ts**

Add after the `CreateIssueInput` interface (~line 550):

```typescript
export interface IssueQueueConfig {
  /** Linear/tracker state name that means "ready for triage" */
  readyState: string;
  /** Label that triggers auto-spawn */
  agentLabel: string;
  /** Label applied on terminal failure */
  failedLabel: string;
  /** Max re-spawns before giving up (default 1 = no retry) */
  maxRetries: number;
}
```

**Step 2: Add Zod schema to config.ts**

Add `IssueQueueSchema` before `OrchestratorConfigSchema`:

```typescript
const IssueQueueSchema = z.object({
  readyState: z.string().default("Todo"),
  agentLabel: z.string().default("agent-ready"),
  failedLabel: z.string().default("agent-failed"),
  maxRetries: z.number().int().min(0).default(1),
});
```

Add `issueQueue` to `OrchestratorConfigSchema`:

```typescript
issueQueue: IssueQueueSchema.optional(),
```

**Step 3: Export type from config.ts**

Ensure `IssueQueueConfig` is available via `@composio/ao-core` exports.

**Step 4: Build and verify**

Run: `pnpm build`
Expected: Clean build, no errors.

**Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/types.ts
git commit -m "feat: add issueQueue config schema"
```

---

## Task 2: Add `removeLabels` to Tracker Interface & Implementations

Neither tracker currently supports removing labels. The failure guard needs to remove `agent-ready` when adding `agent-failed`.

**Files:**
- Modify: `packages/core/src/types.ts:530-537` (IssueUpdate interface)
- Modify: `packages/plugins/tracker-linear/src/index.ts:584-625` (label handling in updateIssue)
- Modify: `packages/plugins/tracker-github/src/index.ts:214-225` (label handling in updateIssue)

**Step 1: Add `removeLabels` to IssueUpdate**

In `types.ts`, modify `IssueUpdate`:

```typescript
export interface IssueUpdate {
  state?: "open" | "in_progress" | "closed";
  labels?: string[];
  removeLabels?: string[];
  assignee?: string;
  comment?: string;
  stateName?: string;
}
```

**Step 2: Implement in tracker-linear**

In `tracker-linear/src/index.ts`, after the existing label-add logic (~line 625), add removal logic:

```typescript
if (update.removeLabels?.length) {
  // Fetch current label IDs
  const issueData = await this.client.issue(identifier);
  const currentLabels = await issueData.labels();
  const currentLabelNodes = currentLabels.nodes;

  // Find IDs of labels to remove
  const removeNames = new Set(update.removeLabels.map((n) => n.toLowerCase()));
  const keepIds = currentLabelNodes
    .filter((l) => !removeNames.has(l.name.toLowerCase()))
    .map((l) => l.id);

  await this.client.issueUpdate(identifier, { labelIds: keepIds });
}
```

**Step 3: Implement in tracker-github**

In `tracker-github/src/index.ts`, after the existing `--add-label` block, add:

```typescript
if (update.removeLabels?.length) {
  for (const label of update.removeLabels) {
    await execFileAsync("gh", [
      "issue", "edit", identifier,
      "--remove-label", label,
      "-R", `${project.repo}`,
    ], { timeout: 30_000 });
  }
}
```

**Step 4: Build and verify**

Run: `pnpm build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/plugins/tracker-linear/src/index.ts packages/plugins/tracker-github/src/index.ts
git commit -m "feat: add removeLabels support to tracker interface"
```

---

## Task 3: `GET /api/issues` Route

**Files:**
- Create: `packages/web/src/app/api/issues/route.ts`

**Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { loadConfig, findConfigFile } from "@composio/ao-core";
import { createTracker } from "@/lib/plugins.js";
import { getSessionManager } from "@/lib/session-manager.js";

import type { Issue, IssueFilters } from "@composio/ao-core";

export interface DashboardIssue extends Issue {
  /** Session ID if this issue has an active agent */
  sessionId?: string;
  /** Session status if linked */
  sessionStatus?: string;
  /** PR URL if linked session has a PR */
  prUrl?: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = (url.searchParams.get("state") as IssueFilters["state"]) ?? "open";
  const project = url.searchParams.get("project");
  const labelsParam = url.searchParams.get("labels");
  const labels = labelsParam ? labelsParam.split(",") : undefined;

  const configPath = findConfigFile();
  if (!configPath) {
    return NextResponse.json({ error: "No config found" }, { status: 500 });
  }
  const config = await loadConfig(configPath);

  // Use first project if none specified
  const projectId = project ?? Object.keys(config.projects)[0];
  const projectConfig = config.projects[projectId];
  if (!projectConfig) {
    return NextResponse.json({ error: `Project ${projectId} not found` }, { status: 404 });
  }

  const tracker = await createTracker(config, projectConfig);
  if (!tracker.listIssues) {
    return NextResponse.json({ error: "Tracker does not support listIssues" }, { status: 501 });
  }

  const issues = await tracker.listIssues({ state, labels, limit: 100 }, projectConfig);

  // Cross-reference with active sessions
  const sessionManager = getSessionManager(config);
  const sessions = await sessionManager.list();
  const issueSessionMap = new Map<string, { id: string; status: string; pr?: string }>();
  for (const s of sessions) {
    if (s.issueId) {
      issueSessionMap.set(s.issueId, {
        id: s.id,
        status: s.status,
        pr: s.metadata?.pr,
      });
    }
  }

  const dashboardIssues: DashboardIssue[] = issues.map((issue) => {
    const session = issueSessionMap.get(issue.id);
    return {
      ...issue,
      sessionId: session?.id,
      sessionStatus: session?.status,
      prUrl: session?.pr,
    };
  });

  return NextResponse.json(dashboardIssues);
}
```

> **Note:** `createTracker` and `getSessionManager` are helper functions. Check if they already exist in `packages/web/src/lib/`. If not, extract the tracker/session creation logic from existing routes like `spawn/route.ts` into shared helpers. Follow the existing patterns in that directory.

**Step 2: Build and verify**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/web/src/app/api/issues/route.ts
git commit -m "feat: add GET /api/issues route with session cross-reference"
```

---

## Task 4: `PUT /api/issues/:id/assign` Route

**Files:**
- Create: `packages/web/src/app/api/issues/[id]/assign/route.ts`

**Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { loadConfig, findConfigFile } from "@composio/ao-core";
import { createTracker } from "@/lib/plugins.js";
import { getSessionManager } from "@/lib/session-manager.js";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: issueId } = await params;

  const body = await request.json();
  const projectId = body.projectId;

  const configPath = findConfigFile();
  if (!configPath) {
    return NextResponse.json({ error: "No config found" }, { status: 500 });
  }
  const config = await loadConfig(configPath);
  const issueQueue = config.issueQueue;
  if (!issueQueue) {
    return NextResponse.json({ error: "issueQueue not configured" }, { status: 400 });
  }

  const resolvedProjectId = projectId ?? Object.keys(config.projects)[0];
  const projectConfig = config.projects[resolvedProjectId];
  if (!projectConfig) {
    return NextResponse.json({ error: `Project ${resolvedProjectId} not found` }, { status: 404 });
  }

  const tracker = await createTracker(config, projectConfig);

  // Guard: check issue isn't already assigned to a session
  const sessionManager = getSessionManager(config);
  const sessions = await sessionManager.list();
  const existing = sessions.find(
    (s) => s.issueId === issueId && !["merged", "killed", "terminated", "done"].includes(s.status),
  );
  if (existing) {
    return NextResponse.json(
      { error: `Issue already has active session: ${existing.id}` },
      { status: 409 },
    );
  }

  // Add agent-ready label
  if (tracker.updateIssue) {
    await tracker.updateIssue(issueId, { labels: [issueQueue.agentLabel] }, projectConfig);
  }

  // Spawn agent immediately
  const session = await sessionManager.spawn({
    projectId: resolvedProjectId,
    issueId,
  });

  return NextResponse.json({ sessionId: session.id, issueId });
}
```

**Step 2: Build and verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add packages/web/src/app/api/issues/[id]/assign/route.ts
git commit -m "feat: add PUT /api/issues/:id/assign route"
```

---

## Task 5: `PUT /api/issues/:id/retry` Route

**Files:**
- Create: `packages/web/src/app/api/issues/[id]/retry/route.ts`

**Step 1: Create the route**

```typescript
import { NextResponse } from "next/server";
import { loadConfig, findConfigFile } from "@composio/ao-core";
import { createTracker } from "@/lib/plugins.js";
import { getSessionManager } from "@/lib/session-manager.js";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: issueId } = await params;

  const body = await request.json();
  const projectId = body.projectId;

  const configPath = findConfigFile();
  if (!configPath) {
    return NextResponse.json({ error: "No config found" }, { status: 500 });
  }
  const config = await loadConfig(configPath);
  const issueQueue = config.issueQueue;
  if (!issueQueue) {
    return NextResponse.json({ error: "issueQueue not configured" }, { status: 400 });
  }

  const resolvedProjectId = projectId ?? Object.keys(config.projects)[0];
  const projectConfig = config.projects[resolvedProjectId];
  if (!projectConfig) {
    return NextResponse.json({ error: `Project ${resolvedProjectId} not found` }, { status: 404 });
  }

  const tracker = await createTracker(config, projectConfig);

  if (tracker.updateIssue) {
    // Remove failed label, add agent-ready label
    await tracker.updateIssue(
      issueId,
      {
        labels: [issueQueue.agentLabel],
        removeLabels: [issueQueue.failedLabel],
      },
      projectConfig,
    );
  }

  // Spawn agent
  const sessionManager = getSessionManager(config);
  const session = await sessionManager.spawn({
    projectId: resolvedProjectId,
    issueId,
  });

  return NextResponse.json({ sessionId: session.id, issueId });
}
```

**Step 2: Build and verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add packages/web/src/app/api/issues/[id]/retry/route.ts
git commit -m "feat: add PUT /api/issues/:id/retry route"
```

---

## Task 6: `POST /api/prs/:number/adopt` Route

**Files:**
- Create: `packages/web/src/app/api/prs/[number]/adopt/route.ts`

**Step 1: Create the route**

This creates a pipeline-only session for a human PR. The session skips the coder phase and goes straight to checking → testing → reviewing.

```typescript
import { NextResponse } from "next/server";
import { loadConfig, findConfigFile } from "@composio/ao-core";
import { getSessionManager } from "@/lib/session-manager.js";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number: prNumber } = await params;

  const body = await request.json();
  const { projectId, prUrl, branch } = body;

  if (!prUrl || !branch) {
    return NextResponse.json({ error: "prUrl and branch are required" }, { status: 400 });
  }

  const configPath = findConfigFile();
  if (!configPath) {
    return NextResponse.json({ error: "No config found" }, { status: 500 });
  }
  const config = await loadConfig(configPath);

  const resolvedProjectId = projectId ?? Object.keys(config.projects)[0];
  const projectConfig = config.projects[resolvedProjectId];
  if (!projectConfig) {
    return NextResponse.json({ error: `Project ${resolvedProjectId} not found` }, { status: 404 });
  }

  const sessionManager = getSessionManager(config);

  // Create session with role "pipeline" — no coder agent, just pipeline stages
  const session = await sessionManager.spawn({
    projectId: resolvedProjectId,
    branch,
    role: "pipeline",
    skipPipeline: false,
  });

  // Write PR metadata so lifecycle manager picks it up
  await sessionManager.updateMetadata(session.id, {
    pr: prUrl,
    status: "pr_open",
    adoptedPr: prNumber,
  });

  return NextResponse.json({ sessionId: session.id, prNumber });
}
```

> **Note:** The `sessionManager.updateMetadata()` method may not exist yet. Check session-manager.ts. If not, write metadata directly using the flat-file pattern used elsewhere (see how spawn writes metadata at ~line 564-578). The key is getting `pr=<url>` and `status=pr_open` into the metadata file so lifecycle manager detects it.

**Step 2: Build and verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add packages/web/src/app/api/prs/[number]/adopt/route.ts
git commit -m "feat: add POST /api/prs/:number/adopt route"
```

---

## Task 7: `IssueQueue` Component (Home Page Panel)

**Files:**
- Create: `packages/web/src/components/IssueQueue.tsx`
- Modify: `packages/web/src/components/Dashboard.tsx` (add IssueQueue between PipelineStrip and board)
- Modify: `packages/web/src/app/page.tsx` (fetch issues, pass as prop)
- Modify: `packages/web/src/app/api/sessions/route.ts` (return issues alongside sessions)

**Step 1: Create IssueQueue component**

Follow the existing component patterns in the codebase (Tailwind classes, CSS variables like `var(--color-text-primary)`, `var(--color-border-subtle)`, etc.).

```tsx
"use client";

import { useState } from "react";

import type { DashboardIssue } from "@/app/api/issues/route.js";

interface IssueQueueProps {
  issues: DashboardIssue[];
  onAssign: (issueId: string) => Promise<void>;
}

export function IssueQueue({ issues, onAssign }: IssueQueueProps) {
  // Filter to only show unassigned issues (no active session)
  const readyIssues = issues.filter((i) => !i.sessionId);

  if (readyIssues.length === 0) return null;

  return (
    <div className="mb-4 rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          Ready Issues ({readyIssues.length})
        </h2>
        <a
          href="/issues"
          className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
        >
          View All
        </a>
      </div>
      <div className="divide-y divide-[var(--color-border-subtle)]">
        {readyIssues.slice(0, 8).map((issue) => (
          <IssueQueueRow key={issue.id} issue={issue} onAssign={onAssign} />
        ))}
      </div>
    </div>
  );
}

function IssueQueueRow({
  issue,
  onAssign,
}: {
  issue: DashboardIssue;
  onAssign: (id: string) => Promise<void>;
}) {
  const [assigning, setAssigning] = useState(false);

  const handleAssign = async () => {
    setAssigning(true);
    try {
      await onAssign(issue.id);
    } finally {
      setAssigning(false);
    }
  };

  const priorityLabel = issue.priority != null ? `P${issue.priority}` : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {priorityLabel && (
        <span className="flex-shrink-0 rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
          {priorityLabel}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-secondary)]">
        {issue.title}
      </span>
      <button
        onClick={handleAssign}
        disabled={assigning}
        className="flex-shrink-0 rounded-[5px] bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-inverse)] transition-all hover:brightness-110 disabled:opacity-50"
      >
        {assigning ? "Assigning..." : "Assign"}
      </button>
    </div>
  );
}
```

**Step 2: Wire into Dashboard.tsx**

Add `issues` to Dashboard props (~line 30). Import and render `<IssueQueue>` between the PipelineStrip and the session board (~line 338). Add an `onAssign` handler that calls `PUT /api/issues/:id/assign`.

**Step 3: Wire into page.tsx**

In the server component, fetch issues from the tracker (same pattern as session enrichment). Pass as `issues` prop to `<Dashboard>`. Also add issues to the `/api/sessions` response so SSE-driven refreshes include them.

**Step 4: Build and verify**

Run: `pnpm build`

**Step 5: Commit**

```bash
git add packages/web/src/components/IssueQueue.tsx packages/web/src/components/Dashboard.tsx packages/web/src/app/page.tsx packages/web/src/app/api/sessions/route.ts
git commit -m "feat: add IssueQueue panel to dashboard home page"
```

---

## Task 8: `/issues` Page

**Files:**
- Create: `packages/web/src/app/issues/page.tsx` (server component)
- Create: `packages/web/src/components/IssuesPage.tsx` (client component)

**Step 1: Create server component**

`packages/web/src/app/issues/page.tsx` — fetches all issues (all states), cross-references sessions, passes to client component. Follow the same data-fetching pattern as `packages/web/src/app/page.tsx`.

**Step 2: Create client component**

`packages/web/src/components/IssuesPage.tsx` — full issue browser:
- Filter dropdowns: State (All/Open/Closed), Priority, Label
- Search input for title filtering
- Table with columns: status icon, issue label, title, priority, state, session/PR linkage, action
- Status icons: circle (ready), filled circle (working), X (failed), check (done)
- Actions: "Assign" on ready issues, "Retry" on failed issues
- Bulk select checkboxes + "Assign All" button
- Click row to expand: show linked session details, PR info, timeline

Follow existing UI patterns from Dashboard.tsx — same Tailwind classes, CSS variables, component structure.

**Step 3: Add to CommandPalette**

Add "Issues" option to the command palette (check `CommandPalette.tsx`) so users can navigate with keyboard.

**Step 4: Build and verify**

Run: `pnpm build`

**Step 5: Commit**

```bash
git add packages/web/src/app/issues/ packages/web/src/components/IssuesPage.tsx packages/web/src/components/CommandPalette.tsx
git commit -m "feat: add /issues page with filtering and bulk assign"
```

---

## Task 9: "Adopt PR" Button on Unlinked PRs

**Files:**
- Modify: `packages/web/src/components/PRStatus.tsx:72-130` (PRTableRow)
- Modify: `packages/web/src/components/Dashboard.tsx` (add adopt handler)

**Step 1: Add Adopt button to PRTableRow**

In `PRStatus.tsx`, modify `PRTableRow` to accept an optional `onAdopt` callback. When the PR is unlinked (no session), render an "Adopt" button that calls `POST /api/prs/:number/adopt` with the PR's URL, branch, and project.

**Step 2: Wire adopt handler in Dashboard**

In `Dashboard.tsx`, pass an `onAdopt` handler to `PRTableRow` for unlinked PRs. The handler calls the adopt API and triggers a refresh.

**Step 3: Build and verify**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add packages/web/src/components/PRStatus.tsx packages/web/src/components/Dashboard.tsx
git commit -m "feat: add Adopt button for unlinked PRs"
```

---

## Task 10: Failure Guard — Label Swap on Session Death

**Files:**
- Modify: `packages/core/src/lifecycle-manager.ts` (detect terminal session with agent-ready issue)

**Step 1: Add failure guard logic**

In the lifecycle manager's poll loop, when a session transitions to a terminal state (stuck, errored, killed) and has an `issueId`:

1. Load `issueQueue` config
2. Check if issue has `agentLabel`
3. Call `tracker.updateIssue(issueId, { labels: [failedLabel], removeLabels: [agentLabel] })`
4. Fire notification: `issue.failed` event
5. Log to event log

This prevents the respawn loop: issue loses `agent-ready`, gains `agent-failed`, won't be re-spawned.

**Step 2: Build and verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add packages/core/src/lifecycle-manager.ts
git commit -m "feat: failure guard swaps agent-ready for agent-failed on session death"
```

---

## Task 11: Integration Testing & Verification

**Step 1: Build everything**

Run: `pnpm build`
Expected: Clean build across all packages.

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

**Step 3: Lint**

Run: `pnpm lint`
Expected: No errors (or only pre-existing ones).

**Step 4: Manual verification**

1. Start dev server: `cd packages/web && pnpm dev`
2. Verify `/api/issues` returns issues from Linear
3. Verify Issue Queue appears on home page
4. Verify `/issues` page loads with filters
5. Verify "Assign" spawns an agent
6. Verify "Adopt" on unlinked PR creates a session

**Step 5: Final commit if any fixes needed**

---

## Task Dependencies

```
Task 1 (config) ──┐
Task 2 (labels) ──┼── Task 3 (GET /api/issues) ── Task 7 (IssueQueue component) ── Task 8 (/issues page)
                   ├── Task 4 (assign route) ──────┘
                   ├── Task 5 (retry route) ────── Task 10 (failure guard)
                   └── Task 6 (adopt route) ────── Task 9 (adopt button)

Task 11 (integration) depends on all above
```

**Parallelizable groups:**
- **Group A:** Tasks 1 + 2 (core/types changes)
- **Group B:** Tasks 3, 4, 5, 6 (API routes — can be parallel after Group A)
- **Group C:** Tasks 7, 8, 9 (UI components — can be parallel after their API route dependency)
- **Group D:** Task 10 (lifecycle — after Task 2)
- **Group E:** Task 11 (integration — after all)
