import { describe, it, expect, vi, beforeEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";

// Mock node:https to avoid real network calls
vi.mock("node:https");

import { create, manifest } from "../index.js";
import type { OrchestratorEvent, EventType } from "@composio/ao-core";

interface RequestOpts {
  hostname: string;
  port: number | string;
  path: string;
  method: string;
  headers: Record<string, string>;
}

function getRequestOpts(): RequestOpts {
  const raw = vi.mocked(https.request).mock.calls[0]![0];
  return raw as unknown as RequestOpts;
}

function makeEvent(overrides: Partial<OrchestratorEvent> = {}): OrchestratorEvent {
  return {
    id: "evt-1",
    type: "pr.created" as EventType,
    priority: "action",
    sessionId: "test-session",
    projectId: "my-project",
    timestamp: new Date("2026-01-01"),
    message: "PR opened for test-session",
    data: {},
    ...overrides,
  };
}

describe("notifier-ntfy", () => {
  let mockReq: EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      write: vi.fn(),
    });
    const mockRes = Object.assign(new EventEmitter(), { statusCode: 200 });
    vi.mocked(https.request).mockImplementation((_opts, cb) => {
      if (cb) (cb as (res: unknown) => void)(mockRes);
      return mockReq as never;
    });
  });

  it("exports correct manifest", () => {
    expect(manifest.name).toBe("ntfy");
    expect(manifest.slot).toBe("notifier");
  });

  it("throws if topic is not configured", () => {
    expect(() => create({})).toThrow("topic");
  });

  it("sends POST to ntfy.sh with correct headers", async () => {
    const notifier = create({ topic: "ao-test-topic" });
    await notifier.notify(makeEvent());

    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "ntfy.sh",
        path: "/ao-test-topic",
        method: "POST",
      }),
      expect.any(Function),
    );
    expect(mockReq.end).toHaveBeenCalledWith("PR opened for test-session");
  });

  it("maps urgent priority to ntfy priority 5", async () => {
    const notifier = create({ topic: "ao-test-topic" });
    await notifier.notify(makeEvent({ priority: "urgent" }));

    expect(getRequestOpts().headers["Priority"]).toBe("5");
  });

  it("maps action priority to ntfy priority 4", async () => {
    const notifier = create({ topic: "ao-test-topic" });
    await notifier.notify(makeEvent({ priority: "action" }));

    expect(getRequestOpts().headers["Priority"]).toBe("4");
  });

  it("uses custom baseUrl when configured", async () => {
    const notifier = create({ topic: "my-topic", baseUrl: "https://ntfy.myserver.com" });
    await notifier.notify(makeEvent());

    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "ntfy.myserver.com" }),
      expect.any(Function),
    );
  });

  it("includes Authorization header when token is configured", async () => {
    const notifier = create({ topic: "ao-test-topic", token: "tk_secret" });
    await notifier.notify(makeEvent());

    expect(getRequestOpts().headers["Authorization"]).toBe("Bearer tk_secret");
  });

  it("includes Click header when dashboardUrl is configured", async () => {
    const notifier = create({
      topic: "ao-test-topic",
      dashboardUrl: "https://agentflow.monster",
    });
    await notifier.notify(makeEvent());

    expect(getRequestOpts().headers["Click"]).toBe(
      "https://agentflow.monster/sessions/test-session",
    );
  });

  it("does not throw if ntfy request fails", async () => {
    vi.mocked(https.request).mockImplementation((_opts, _cb) => {
      const req = Object.assign(new EventEmitter(), {
        end: vi.fn(),
        write: vi.fn(),
      });
      // Emit error on next tick so the error handler is registered
      process.nextTick(() => req.emit("error", new Error("network error")));
      return req as never;
    });

    const notifier = create({ topic: "ao-test-topic" });
    await expect(notifier.notify(makeEvent())).resolves.not.toThrow();
  });

  it("sets correct tags for known event types", async () => {
    const notifier = create({ topic: "ao-test-topic" });
    await notifier.notify(makeEvent({ type: "pr.created" as EventType }));

    expect(getRequestOpts().headers["Tags"]).toBe("tada");
  });

  it("uses robot tag for unknown event types", async () => {
    const notifier = create({ topic: "ao-test-topic" });
    await notifier.notify(makeEvent({ type: "session.spawned" as EventType }));

    expect(getRequestOpts().headers["Tags"]).toBe("robot");
  });

  it("has name property on notifier instance", () => {
    const notifier = create({ topic: "ao-test-topic" });
    expect(notifier.name).toBe("ntfy");
  });
});
