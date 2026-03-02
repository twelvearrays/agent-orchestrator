# Design: Real-time Events — GitHub Webhooks + Hook Push + ntfy.sh

Date: 2026-03-02

## Problem

The lifecycle manager currently polls every 30 seconds to detect state transitions
(PR opened, CI failed, review received, agent exited). This causes:

1. **30-second lag** on every event
2. **GitHub API rate limit pressure** — N sessions × every 30s burns quota fast

## Solution Overview

Three complementary improvements, each independent:

1. **`packages/webhook-github`** — standalone Express server receiving GitHub push events
2. **Lifecycle manager internal HTTP server** — `localhost:3101` endpoint triggering immediate `check()`
3. **`packages/plugins/notifier-ntfy`** — push notifications to macOS + iOS via ntfy.sh
4. **Claude Code hook enhancement** — signal lifecycle manager immediately on PR open / agent exit

Together, GitHub SCM events become instant (webhook-driven) and agent events become
near-instant (hook-driven). Polling remains as a fallback health check.

---

## Part 1: `packages/webhook-github`

### Structure

```
packages/webhook-github/
  src/
    server.ts       — Express server, route handler
    verify.ts       — HMAC SHA-256 signature verification
    events.ts       — payload parsers for PR / check_suite / review events
    correlate.ts    — match repo+branch to session ID via session metadata files
    dedup.ts        — drop duplicate events within 5s window (reuse webhook-linear pattern)
    config.ts       — load env vars with validation
    types.ts        — GitHub webhook payload types
  package.json
  tsconfig.json
```

### GitHub Events Handled

| Event | Actions | Triggers |
|-------|---------|---------|
| `pull_request` | `opened`, `closed`, `reopened`, `merged` | `check(sessionId)` |
| `check_suite` | `completed` | `check(sessionId)` |
| `pull_request_review` | `submitted` | `check(sessionId)` |

Other events return `200 OK` and are ignored.

### Session Correlation

GitHub sends `repository.full_name` + `head.ref` (branch name) in every payload.
`correlate.ts` reads session metadata files from `AO_DATA_DIR` to find a session
where `metadata.branch === head.ref` and the project's `repo` matches
`repository.full_name`. Returns the `sessionId` to check.

No session found → log + ignore (not our PR).

### Signature Verification

`X-Hub-Signature-256: sha256=<hmac>` — same HMAC SHA-256 pattern as `webhook-linear/verify.ts`.
Invalid signature → `401`. Missing signature → `401`.

### Config (env vars)

```
GITHUB_WEBHOOK_SECRET   — HMAC secret set in GitHub repo settings
AO_INTERNAL_URL         — http://localhost:3101 (lifecycle manager endpoint)
AO_DATA_DIR             — session metadata directory (~/.ao-sessions)
PORT                    — webhook server port (default: 3102)
```

### Flow

```
GitHub → POST /webhook/github
  → verify signature
  → parse event type + payload
  → correlate repo+branch → sessionId
  → POST http://localhost:3101/internal/check/:sessionId
  → 200 OK to GitHub (always respond fast)
```

GitHub requires a response within 10s. We respond immediately and do correlation async.

---

## Part 2: Lifecycle Manager Internal HTTP Server

### Where It Lives

New file: `packages/core/src/internal-server.ts`

Exported function: `createInternalServer(lifecycleManager, port?)` → returns `http.Server`.

Called from CLI startup (`packages/cli/src/commands/start.ts` or equivalent).

### Endpoints

```
POST /internal/check/:sessionId   — lifecycleManager.check(sessionId), returns {ok: true}
POST /internal/poll               — trigger full pollAll() immediately
GET  /internal/health             — returns {ok: true, states: [...]}
```

All endpoints bind to `127.0.0.1` only — not externally accessible.

### Error handling

- Unknown sessionId → `404 {error: "session not found"}`
- `check()` throws → `500 {error: message}`
- Always JSON responses

### Config

`AO_INTERNAL_PORT` env var (default: `3101`). Set automatically when CLI starts.

---

## Part 3: Claude Code Hook Enhancement

### Current state

`agent-claude-code` already installs a `PostToolUse` bash hook (`METADATA_UPDATER_SCRIPT`)
that detects `gh pr create` and writes the PR URL to session metadata.

### Addition

After the metadata write, add a non-blocking signal to the lifecycle manager:

```bash
# Signal lifecycle manager for immediate check (non-blocking, silent-fail)
if [[ -n "${AO_INTERNAL_PORT:-}" ]] && [[ -n "${AO_SESSION_ID:-}" ]]; then
  curl -sf -X POST "http://127.0.0.1:${AO_INTERNAL_PORT}/internal/check/${AO_SESSION_ID}" \
    -o /dev/null 2>&1 &
fi
```

Added after: PR URL write, branch write.

Also add a `Stop` hook that signals `check()` when the agent process exits — this
triggers the `session.killed` transition immediately instead of waiting for the
runtime `isAlive()` poll.

### Env var

`AO_INTERNAL_PORT` passed to agent environment at launch (alongside existing
`AO_SESSION_ID`, `AO_DATA_DIR`, `AO_ISSUE_ID`).

---

## Part 4: `packages/plugins/notifier-ntfy`

### Interface

Implements the existing `Notifier` interface from `@composio/ao-core`:

```typescript
interface Notifier {
  notify(event: OrchestratorEvent): Promise<void>;
}
```

### ntfy Protocol

`POST https://ntfy.sh/{topic}` (or self-hosted base URL) with headers:

| Header | Value |
|--------|-------|
| `Title` | Event type, e.g. `pr.created` |
| `Message` | event.message (body) |
| `Priority` | mapped from EventPriority (see below) |
| `Tags` | emoji tags per event type |
| `Click` | Dashboard URL for this session |
| `Authorization` | `Bearer {token}` if token configured |

### Priority Mapping

| EventPriority | ntfy Priority |
|---------------|---------------|
| `urgent` | `5` (max) |
| `action` | `4` (high) |
| `warning` | `3` (default) |
| `info` | `2` (low) |

### Tags (emoji)

| Event pattern | Tags |
|--------------|------|
| `merge.ready` | `white_check_mark` |
| `ci.failing` | `x` |
| `session.stuck` | `sos` |
| `session.needs_input` | `speech_balloon` |
| `pr.created` | `tada` |
| `merge.completed` | `rocket` |

### Config (`agent-orchestrator.yaml`)

```yaml
defaults:
  notifiers: [desktop, ntfy]

plugins:
  notifier-ntfy:
    topic: "ao-your-private-topic"     # required
    baseUrl: "https://ntfy.sh"          # optional, default ntfy.sh
    token: "tk_xxx"                     # optional, for private/authenticated topics
    dashboardUrl: "https://agentflow.monster"  # optional, for click-through links
```

### Structure

```
packages/plugins/notifier-ntfy/
  src/
    index.ts    — PluginModule export, Notifier implementation
  package.json
  tsconfig.json
```

No external dependencies — uses `node:https` (same pattern as `api/linear/states`).

---

## What Polling Becomes After This

- **SCM events** (PR, CI, review) → instant via GitHub webhook → polling skips SCM checks
  for sessions that got a recent webhook signal
- **Agent state** (PR opened, exit) → near-instant via hook push → polling skips
  redundant checks for recently-signaled sessions
- **Polling** → fallback only: catches anything webhooks miss, checks sessions
  with no recent signal, verifies health

Effective latency: **< 2 seconds** for GitHub events, **< 1 second** for agent events.

---

## Files Created / Modified

```
packages/webhook-github/                          NEW package
packages/plugins/notifier-ntfy/                   NEW plugin
packages/core/src/internal-server.ts              NEW — internal HTTP server
packages/core/src/types.ts                        add internalPort to OrchestratorConfig
packages/plugins/agent-claude-code/src/index.ts   add AO_INTERNAL_PORT env + Stop hook signal
packages/cli/src/...                              start internal server on ao start
agent-orchestrator.yaml.example                   add ntfy config example
```

---

## Out of Scope

- Replacing polling entirely (keep as fallback)
- GitHub App auth (use webhook secret + PAT, simpler)
- ntfy self-hosting setup (user's responsibility)
- Android support (ntfy works there too, just not in scope of this design)
