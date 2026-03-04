import { type NextRequest, NextResponse } from "next/server";
import { getServices } from "@/lib/services";
import type { Tracker } from "@composio/ao-core";

/**
 * Map GitHub webhook event+action to reaction config key.
 * Mirrors the lifecycle-manager's eventToReactionKey mapping.
 *
 * @param merged - For pull_request.closed events, whether the PR was merged (true) or just closed (false).
 */
function githubEventToReactionKey(event: string, action?: string, merged?: boolean): string | null {
  const key = action ? `${event}.${action}` : event;
  switch (key) {
    case "pull_request.opened":
    case "pull_request.reopened":
      return "pr-opened";
    case "pull_request.closed":
      // Only react to actual merges, not close-without-merge
      return merged === true ? "pr-merged" : null;
    case "pull_request_review.changes_requested":
      return "changes-requested";
    case "pull_request_review.approved":
      return "review-approved";
    case "check_suite.failure":
      return "ci-failed";
    case "check_suite.success":
      return "ci-passed";
    default:
      return null;
  }
}

/**
 * POST /api/internal/reaction — Fire a tracker reaction for a session.
 *
 * Called by webhook-github when an event is correlated to a session.
 * No auth required — only accessible from localhost.
 *
 * Body: { event: string, action?: string, sessionId: string }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.event || !body.sessionId) {
    return NextResponse.json({ error: "Missing event or sessionId" }, { status: 400 });
  }

  const event = body.event as string;
  const action = body.action as string | undefined;
  const sessionId = body.sessionId as string;
  const merged = typeof body.merged === "boolean" ? body.merged : undefined;

  const reactionKey = githubEventToReactionKey(event, action, merged);
  if (!reactionKey) {
    return NextResponse.json({ skipped: true, reason: "no reaction for event" });
  }

  try {
    const { config, registry, sessionManager } = await getServices();
    const reactionConfig = config.reactions[reactionKey];
    if (!reactionConfig?.trackerState) {
      return NextResponse.json({ skipped: true, reason: "no trackerState configured" });
    }

    const session = await sessionManager.get(sessionId);
    if (!session) {
      return NextResponse.json({ skipped: true, reason: "session not found" });
    }

    const issueId = session.issueId ?? session.metadata["issue"];
    if (!issueId) {
      return NextResponse.json({ skipped: true, reason: "no issueId on session" });
    }

    const project = config.projects[session.projectId];
    if (!project) {
      return NextResponse.json({ skipped: true, reason: "project not found" });
    }

    const trackerName = project.tracker?.plugin ?? "linear";
    const tracker = registry.get<Tracker>("tracker", trackerName);
    if (!tracker?.updateIssue) {
      return NextResponse.json({ skipped: true, reason: "tracker has no updateIssue" });
    }

    await tracker.updateIssue(
      issueId as string,
      { stateName: reactionConfig.trackerState },
      project,
    );

    return NextResponse.json({
      ok: true,
      reaction: reactionKey,
      trackerState: reactionConfig.trackerState,
      issueId,
    });
  } catch (err) {
    console.error(`[reaction] Failed to execute ${reactionKey}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reaction failed" },
      { status: 500 },
    );
  }
}
