import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  SessionNotRestorableError,
  type Session,
  type SessionManager,
  type OrchestratorConfig,
  type PluginRegistry,
  type SCM,
  type Tracker,
  type Issue,
} from "@composio/ao-core";

// ── Mock Data ─────────────────────────────────────────────────────────
// Provides test sessions covering the key states the dashboard needs.

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    projectId: "my-app",
    status: "working",
    activity: "active",
    branch: null,
    issueId: null,
    pr: null,
    workspacePath: null,
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

const testSessions: Session[] = [
  makeSession({ id: "backend-3", status: "needs_input", activity: "waiting_input" }),
  makeSession({
    id: "backend-7",
    status: "mergeable",
    activity: "idle",
    pr: {
      number: 432,
      url: "https://github.com/acme/my-app/pull/432",
      title: "feat: health check",
      owner: "acme",
      repo: "my-app",
      branch: "feat/health-check",
      baseBranch: "main",
      isDraft: false,
    },
  }),
  makeSession({ id: "backend-9", status: "working", activity: "active" }),
  makeSession({
    id: "frontend-1",
    status: "killed",
    activity: "exited",
    projectId: "my-app",
    issueId: "INT-1270",
    branch: "feat/INT-1270-table",
  }),
];

// ── Mock Services ─────────────────────────────────────────────────────

const mockSessionManager: SessionManager = {
  list: vi.fn(async () => testSessions),
  get: vi.fn(async (id: string) => testSessions.find((s) => s.id === id) ?? null),
  spawn: vi.fn(async (config) =>
    makeSession({
      id: `session-${Date.now()}`,
      projectId: config.projectId,
      issueId: config.issueId ?? null,
      status: "spawning",
    }),
  ),
  kill: vi.fn(async (id: string) => {
    if (!testSessions.find((s) => s.id === id)) {
      throw new Error(`Session ${id} not found`);
    }
  }),
  send: vi.fn(async (id: string) => {
    if (!testSessions.find((s) => s.id === id)) {
      throw new Error(`Session ${id} not found`);
    }
  }),
  cleanup: vi.fn(async () => ({ killed: [], skipped: [], errors: [] })),
  spawnOrchestrator: vi.fn(),
  restore: vi.fn(async (id: string) => {
    const session = testSessions.find((s) => s.id === id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }
    // Simulate SessionNotRestorableError for non-terminal sessions
    if (session.status === "working" && session.activity !== "exited") {
      throw new SessionNotRestorableError(id, "session is not in a terminal state");
    }
    return { ...session, status: "spawning" as const, activity: "active" as const };
  }),
};

const mockSCM: SCM = {
  name: "github",
  detectPR: vi.fn(async () => null),
  getPRState: vi.fn(async () => "open" as const),
  mergePR: vi.fn(async () => {}),
  closePR: vi.fn(async () => {}),
  getCIChecks: vi.fn(async () => []),
  getCISummary: vi.fn(async () => "passing" as const),
  getReviews: vi.fn(async () => []),
  getReviewDecision: vi.fn(async () => "approved" as const),
  getPendingComments: vi.fn(async () => []),
  getAutomatedComments: vi.fn(async () => []),
  getMergeability: vi.fn(async () => ({
    mergeable: true,
    ciPassing: true,
    approved: true,
    noConflicts: true,
    blockers: [],
  })),
};

const testIssues: Issue[] = [
  {
    id: "INT-100",
    title: "Add user auth",
    description: "Implement user authentication",
    url: "https://linear.app/test/issue/INT-100",
    state: "open",
    labels: ["agent-ready"],
  },
  {
    id: "INT-101",
    title: "Fix login bug",
    description: "Login page crashes on submit",
    url: "https://linear.app/test/issue/INT-101",
    state: "in_progress",
    labels: ["bug"],
  },
  {
    id: "INT-102",
    title: "Update docs",
    description: "Update API docs",
    url: "https://linear.app/test/issue/INT-102",
    state: "open",
    labels: ["docs", "agent-ready"],
  },
];

const mockTracker: Tracker = {
  name: "linear",
  getIssue: vi.fn(async (id: string) => {
    const issue = testIssues.find((i) => i.id === id);
    if (!issue) throw new Error(`Issue ${id} not found`);
    return issue;
  }),
  isCompleted: vi.fn(async () => false),
  issueUrl: vi.fn((id: string) => `https://linear.app/test/issue/${id}`),
  branchName: vi.fn((id: string) => `feat/${id.toLowerCase()}`),
  generatePrompt: vi.fn(async () => "Work on this issue"),
  listIssues: vi.fn(async () => testIssues),
  updateIssue: vi.fn(async () => {}),
};

const mockRegistry: PluginRegistry = {
  register: vi.fn(),
  get: vi.fn((slot: string) => {
    if (slot === "tracker") return mockTracker;
    return mockSCM;
  }) as PluginRegistry["get"],
  list: vi.fn(() => []),
  loadBuiltins: vi.fn(async () => {}),
  loadFromConfig: vi.fn(async () => {}),
};

const mockConfig: OrchestratorConfig = {
  configPath: "/tmp/ao-test/agent-orchestrator.yaml",
  port: 3000,
  readyThresholdMs: 300_000,
  defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
  projects: {
    "my-app": {
      name: "My App",
      repo: "acme/my-app",
      path: "/tmp/my-app",
      defaultBranch: "main",
      sessionPrefix: "my-app",
      scm: { plugin: "github" },
      tracker: { plugin: "linear" },
    },
  },
  issueQueue: {
    readyState: "Ready",
    agentLabel: "agent-ready",
    failedLabel: "agent-failed",
    maxRetries: 2,
  },
  notifiers: {},
  notificationRouting: { urgent: [], action: [], warning: [], info: [] },
  reactions: {},
};

vi.mock("@/lib/services", () => ({
  getServices: vi.fn(async () => ({
    config: mockConfig,
    registry: mockRegistry,
    sessionManager: mockSessionManager,
  })),
  getSCM: vi.fn(() => mockSCM),
}));

vi.mock("@composio/ao-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@composio/ao-core")>();
  return {
    ...actual,
    getSessionsDir: vi.fn(() => "/tmp/ao-test/sessions"),
    updateMetadata: vi.fn(),
  };
});

// ── Import routes after mocking ───────────────────────────────────────

import { GET as sessionsGET } from "@/app/api/sessions/route";
import { POST as spawnPOST } from "@/app/api/spawn/route";
import { POST as sendPOST } from "@/app/api/sessions/[id]/send/route";
import { POST as killPOST } from "@/app/api/sessions/[id]/kill/route";
import { POST as restorePOST } from "@/app/api/sessions/[id]/restore/route";
import { POST as mergePOST } from "@/app/api/prs/[id]/merge/route";
import { GET as eventsGET } from "@/app/api/events/route";
import { GET as issuesGET } from "@/app/api/issues/route";
import { PUT as assignPUT } from "@/app/api/issues/[id]/assign/route";
import { PUT as retryPUT } from "@/app/api/issues/[id]/retry/route";
import { POST as adoptPOST } from "@/app/api/prs/[id]/adopt/route";

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(
    new URL(url, "http://localhost:3000"),
    init as ConstructorParameters<typeof NextRequest>[1],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set default return values
  (mockSessionManager.list as ReturnType<typeof vi.fn>).mockResolvedValue(testSessions);
  (mockSessionManager.get as ReturnType<typeof vi.fn>).mockImplementation(
    async (id: string) => testSessions.find((s) => s.id === id) ?? null,
  );
});

describe("API Routes", () => {
  // ── GET /api/sessions ──────────────────────────────────────────────

  describe("GET /api/sessions", () => {
    it("returns sessions array and stats", async () => {
      const res = await sessionsGET(makeRequest("http://localhost:3000/api/sessions"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.sessions.length).toBe(testSessions.length);
      expect(data.stats).toBeDefined();
      expect(data.stats.totalSessions).toBe(data.sessions.length);
    });

    it("stats include expected fields", async () => {
      const res = await sessionsGET(makeRequest("http://localhost:3000/api/sessions"));
      const data = await res.json();
      expect(data.stats).toHaveProperty("totalSessions");
      expect(data.stats).toHaveProperty("workingSessions");
      expect(data.stats).toHaveProperty("openPRs");
      expect(data.stats).toHaveProperty("needsReview");
    });

    it("sessions have expected shape", async () => {
      const res = await sessionsGET(makeRequest("http://localhost:3000/api/sessions"));
      const data = await res.json();
      const session = data.sessions[0];
      expect(session).toHaveProperty("id");
      expect(session).toHaveProperty("projectId");
      expect(session).toHaveProperty("status");
      expect(session).toHaveProperty("activity");
      expect(session).toHaveProperty("createdAt");
    });
  });

  // ── POST /api/spawn ────────────────────────────────────────────────

  describe("POST /api/spawn", () => {
    it("creates a session with valid input", async () => {
      const req = makeRequest("/api/spawn", {
        method: "POST",
        body: JSON.stringify({ projectId: "my-app", issueId: "INT-100" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await spawnPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.session).toBeDefined();
      expect(data.session.projectId).toBe("my-app");
      expect(data.session.status).toBe("spawning");
    });

    it("returns 400 when projectId is missing", async () => {
      const req = makeRequest("/api/spawn", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      const res = await spawnPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/projectId/);
    });

    it("returns 400 with invalid JSON", async () => {
      const req = makeRequest("/api/spawn", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      });
      const res = await spawnPOST(req);
      expect(res.status).toBe(400);
    });

    it("handles missing issueId gracefully", async () => {
      const req = makeRequest("/api/spawn", {
        method: "POST",
        body: JSON.stringify({ projectId: "my-app" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await spawnPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.session.issueId).toBeNull();
    });
  });

  // ── POST /api/sessions/:id/send ────────────────────────────────────

  describe("POST /api/sessions/:id/send", () => {
    it("sends a message to a valid session", async () => {
      const req = makeRequest("/api/sessions/backend-3/send", {
        method: "POST",
        body: JSON.stringify({ message: "Fix the tests" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await sendPOST(req, { params: Promise.resolve({ id: "backend-3" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message).toBe("Fix the tests");
    });

    it("returns 404 for unknown session", async () => {
      (mockSessionManager.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Session nonexistent not found"),
      );
      const req = makeRequest("/api/sessions/nonexistent/send", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await sendPOST(req, { params: Promise.resolve({ id: "nonexistent" }) });
      expect(res.status).toBe(404);
    });

    it("returns 400 when message is missing", async () => {
      const req = makeRequest("/api/sessions/backend-3/send", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      const res = await sendPOST(req, { params: Promise.resolve({ id: "backend-3" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/message/);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = makeRequest("/api/sessions/backend-3/send", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      });
      const res = await sendPOST(req, { params: Promise.resolve({ id: "backend-3" }) });
      expect(res.status).toBe(400);
    });

    it("returns 400 for control-char-only message", async () => {
      const req = makeRequest("/api/sessions/backend-3/send", {
        method: "POST",
        body: JSON.stringify({ message: "\x00\x01\x02" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await sendPOST(req, { params: Promise.resolve({ id: "backend-3" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/empty/);
    });
  });

  // ── POST /api/sessions/:id/kill ────────────────────────────────────

  describe("POST /api/sessions/:id/kill", () => {
    it("kills a valid session", async () => {
      const req = makeRequest("/api/sessions/backend-3/kill", { method: "POST" });
      const res = await killPOST(req, { params: Promise.resolve({ id: "backend-3" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.sessionId).toBe("backend-3");
    });

    it("returns 404 for unknown session", async () => {
      (mockSessionManager.kill as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Session nonexistent not found"),
      );
      const req = makeRequest("/api/sessions/nonexistent/kill", { method: "POST" });
      const res = await killPOST(req, { params: Promise.resolve({ id: "nonexistent" }) });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/sessions/:id/restore ─────────────────────────────────

  describe("POST /api/sessions/:id/restore", () => {
    it("restores a killed session", async () => {
      const req = makeRequest("/api/sessions/frontend-1/restore", { method: "POST" });
      const res = await restorePOST(req, { params: Promise.resolve({ id: "frontend-1" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.sessionId).toBe("frontend-1");
    });

    it("returns 404 for unknown session", async () => {
      const req = makeRequest("/api/sessions/nonexistent/restore", { method: "POST" });
      const res = await restorePOST(req, { params: Promise.resolve({ id: "nonexistent" }) });
      expect(res.status).toBe(404);
    });

    it("returns 409 for active session", async () => {
      const req = makeRequest("/api/sessions/backend-9/restore", { method: "POST" });
      const res = await restorePOST(req, { params: Promise.resolve({ id: "backend-9" }) });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/not in a terminal state/);
    });
  });

  // ── POST /api/prs/:id/merge ────────────────────────────────────────

  describe("POST /api/prs/:id/merge", () => {
    it("merges a mergeable PR", async () => {
      const req = makeRequest("/api/prs/432/merge", { method: "POST" });
      const res = await mergePOST(req, { params: Promise.resolve({ id: "432" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.prNumber).toBe(432);
    });

    it("returns 404 for unknown PR", async () => {
      const req = makeRequest("/api/prs/99999/merge", { method: "POST" });
      const res = await mergePOST(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
    });

    it("returns 422 for non-mergeable PR", async () => {
      (mockSCM.getMergeability as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mergeable: false,
        ciPassing: false,
        approved: false,
        noConflicts: true,
        blockers: ["CI checks failing", "Needs review"],
      });
      const req = makeRequest("/api/prs/432/merge", { method: "POST" });
      const res = await mergePOST(req, { params: Promise.resolve({ id: "432" }) });
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/not mergeable/);
      expect(data.blockers).toBeDefined();
    });

    it("returns 400 for non-numeric PR id", async () => {
      const req = makeRequest("/api/prs/abc/merge", { method: "POST" });
      const res = await mergePOST(req, { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Invalid PR number/);
    });

    it("returns 409 for merged PR", async () => {
      (mockSCM.getPRState as ReturnType<typeof vi.fn>).mockResolvedValueOnce("merged");
      const req = makeRequest("/api/prs/432/merge", { method: "POST" });
      const res = await mergePOST(req, { params: Promise.resolve({ id: "432" }) });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/merged/);
    });
  });

  // ── GET /api/events (SSE) ──────────────────────────────────────────

  describe("GET /api/events", () => {
    it("returns SSE content type", async () => {
      const res = await eventsGET();
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
    });

    it("streams initial snapshot event", async () => {
      const res = await eventsGET();
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();
      const text = new TextDecoder().decode(value);
      expect(text).toContain("data: ");
      const jsonStr = text.replace("data: ", "").trim();
      const event = JSON.parse(jsonStr);
      expect(event.type).toBe("snapshot");
      expect(Array.isArray(event.sessions)).toBe(true);
      expect(event.sessions.length).toBeGreaterThan(0);
      expect(event.sessions[0]).toHaveProperty("id");
      expect(event.sessions[0]).toHaveProperty("attentionLevel");
    });
  });

  // ── GET /api/issues ───────────────────────────────────────────────

  describe("GET /api/issues", () => {
    it("returns issues array with session cross-reference", async () => {
      const res = await issuesGET(makeRequest("http://localhost:3000/api/issues"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(testIssues.length);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("title");
    });

    it("filters by state param", async () => {
      const res = await issuesGET(
        makeRequest("http://localhost:3000/api/issues?state=closed"),
      );
      expect(res.status).toBe(200);
      expect(mockTracker.listIssues).toHaveBeenCalledWith(
        expect.objectContaining({ state: "closed" }),
        expect.anything(),
      );
    });

    it("filters by labels param", async () => {
      const res = await issuesGET(
        makeRequest("http://localhost:3000/api/issues?labels=bug,docs"),
      );
      expect(res.status).toBe(200);
      expect(mockTracker.listIssues).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ["bug", "docs"] }),
        expect.anything(),
      );
    });

    it("returns 501 if tracker does not support listIssues", async () => {
      const trackerWithoutList: Tracker = {
        ...mockTracker,
        listIssues: undefined,
      };
      (mockRegistry.get as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (slot: string) => {
          if (slot === "tracker") return trackerWithoutList;
          return mockSCM;
        },
      );
      const res = await issuesGET(makeRequest("http://localhost:3000/api/issues"));
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.error).toMatch(/listIssues/);
    });

    it("returns issues with sessionId when linked to active session", async () => {
      // frontend-1 session has issueId "INT-1270" — add a matching issue
      const issuesWithLinked: Issue[] = [
        ...testIssues,
        {
          id: "INT-1270",
          title: "Table component",
          description: "Build table",
          url: "https://linear.app/test/issue/INT-1270",
          state: "in_progress",
          labels: [],
        },
      ];
      (mockTracker.listIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        issuesWithLinked,
      );
      const res = await issuesGET(makeRequest("http://localhost:3000/api/issues"));
      expect(res.status).toBe(200);
      const data = await res.json();
      const linkedIssue = data.find(
        (i: { id: string }) => i.id === "INT-1270",
      );
      expect(linkedIssue).toBeDefined();
      expect(linkedIssue.sessionId).toBe("frontend-1");
      expect(linkedIssue.sessionStatus).toBe("killed");
    });
  });

  // ── PUT /api/issues/:id/assign ────────────────────────────────────

  describe("PUT /api/issues/:id/assign", () => {
    it("adds label and spawns agent, returns sessionId", async () => {
      const req = makeRequest("/api/issues/INT-200/assign", {
        method: "PUT",
        body: JSON.stringify({ projectId: "my-app" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await assignPUT(req, { params: Promise.resolve({ id: "INT-200" }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.sessionId).toBeDefined();
      expect(data.issueId).toBe("INT-200");
      expect(mockTracker.updateIssue).toHaveBeenCalledWith(
        "INT-200",
        expect.objectContaining({ labels: ["agent-ready"] }),
        expect.anything(),
      );
      expect(mockSessionManager.spawn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "my-app", issueId: "INT-200" }),
      );
    });

    it("returns 409 if issue already has active session", async () => {
      // Add a session with issueId "INT-300" that is active
      const sessionsWithActive = [
        ...testSessions,
        makeSession({ id: "active-1", status: "working", activity: "active", issueId: "INT-300" }),
      ];
      (mockSessionManager.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        sessionsWithActive,
      );
      const req = makeRequest("/api/issues/INT-300/assign", {
        method: "PUT",
        body: JSON.stringify({ projectId: "my-app" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await assignPUT(req, { params: Promise.resolve({ id: "INT-300" }) });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/active session/);
    });

    it("returns 400 if issueQueue not configured", async () => {
      // Temporarily remove issueQueue from config
      const savedQueue = mockConfig.issueQueue;
      mockConfig.issueQueue = undefined;
      try {
        const req = makeRequest("/api/issues/INT-200/assign", {
          method: "PUT",
          body: JSON.stringify({ projectId: "my-app" }),
          headers: { "Content-Type": "application/json" },
        });
        const res = await assignPUT(req, { params: Promise.resolve({ id: "INT-200" }) });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/issueQueue/);
      } finally {
        mockConfig.issueQueue = savedQueue;
      }
    });
  });

  // ── PUT /api/issues/:id/retry ─────────────────────────────────────

  describe("PUT /api/issues/:id/retry", () => {
    it("removes failed label, adds ready label, spawns agent", async () => {
      const req = makeRequest("/api/issues/INT-400/retry", {
        method: "PUT",
        body: JSON.stringify({ projectId: "my-app" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await retryPUT(req, { params: Promise.resolve({ id: "INT-400" }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.sessionId).toBeDefined();
      expect(data.issueId).toBe("INT-400");
      expect(mockTracker.updateIssue).toHaveBeenCalledWith(
        "INT-400",
        expect.objectContaining({
          labels: ["agent-ready"],
          removeLabels: ["agent-failed"],
        }),
        expect.anything(),
      );
    });

    it("returns 409 if issue already has active session", async () => {
      const sessionsWithActive = [
        ...testSessions,
        makeSession({ id: "active-2", status: "working", activity: "active", issueId: "INT-500" }),
      ];
      (mockSessionManager.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        sessionsWithActive,
      );
      const req = makeRequest("/api/issues/INT-500/retry", {
        method: "PUT",
        body: JSON.stringify({ projectId: "my-app" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await retryPUT(req, { params: Promise.resolve({ id: "INT-500" }) });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/active session/);
    });

    it("returns 400 if issueQueue not configured", async () => {
      const savedQueue = mockConfig.issueQueue;
      mockConfig.issueQueue = undefined;
      try {
        const req = makeRequest("/api/issues/INT-400/retry", {
          method: "PUT",
          body: JSON.stringify({ projectId: "my-app" }),
          headers: { "Content-Type": "application/json" },
        });
        const res = await retryPUT(req, { params: Promise.resolve({ id: "INT-400" }) });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/issueQueue/);
      } finally {
        mockConfig.issueQueue = savedQueue;
      }
    });

    it("enforces maxRetries limit", async () => {
      // Create sessions that look like failed attempts for this issue
      // maxRetries is 2, so 3 terminated sessions should exceed the limit
      const sessionsWithFailures = [
        ...testSessions,
        makeSession({ id: "fail-1", status: "stuck", activity: "exited", issueId: "INT-600" }),
        makeSession({ id: "fail-2", status: "errored", activity: "exited", issueId: "INT-600" }),
        makeSession({ id: "fail-3", status: "killed", activity: "exited", issueId: "INT-600" }),
      ];
      (mockSessionManager.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        sessionsWithFailures,
      );
      const req = makeRequest("/api/issues/INT-600/retry", {
        method: "PUT",
        body: JSON.stringify({ projectId: "my-app" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await retryPUT(req, { params: Promise.resolve({ id: "INT-600" }) });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/Retry limit exceeded/);
    });
  });

  // ── POST /api/prs/:number/adopt ───────────────────────────────────

  describe("POST /api/prs/:number/adopt", () => {
    it("creates pipeline session with PR metadata", async () => {
      const req = makeRequest("/api/prs/42/adopt", {
        method: "POST",
        body: JSON.stringify({
          projectId: "my-app",
          prUrl: "https://github.com/acme/my-app/pull/42",
          branch: "feat/new-feature",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await adoptPOST(req, { params: Promise.resolve({ id: "42" }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.sessionId).toBeDefined();
      expect(data.prNumber).toBe("42");
      expect(mockSessionManager.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "my-app",
          branch: "feat/new-feature",
          role: "pipeline",
        }),
      );
    });

    it("returns 400 if prUrl or branch missing", async () => {
      const req = makeRequest("/api/prs/42/adopt", {
        method: "POST",
        body: JSON.stringify({ projectId: "my-app", prUrl: "https://github.com/acme/my-app/pull/42" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await adoptPOST(req, { params: Promise.resolve({ id: "42" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/prUrl and branch/);
    });

    it("returns 400 for invalid PR number", async () => {
      const req = makeRequest("/api/prs/abc/adopt", {
        method: "POST",
        body: JSON.stringify({
          projectId: "my-app",
          prUrl: "https://github.com/acme/my-app/pull/abc",
          branch: "feat/test",
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await adoptPOST(req, { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Invalid PR number/);
    });
  });
});
