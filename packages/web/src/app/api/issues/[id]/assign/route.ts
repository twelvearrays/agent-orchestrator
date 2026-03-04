import { type NextRequest, NextResponse } from "next/server";
import { validateIdentifier } from "@/lib/validation";
import { getServices } from "@/lib/services";
import type { Tracker } from "@composio/ao-core";

/** PUT /api/issues/:id/assign — Add agent-ready label and spawn a session */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: issueId } = await params;

  const idErr = validateIdentifier(issueId, "issueId");
  if (idErr) {
    return NextResponse.json({ error: idErr }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  try {
    const { sessionManager, config, registry } = await getServices();

    const issueQueue = config.issueQueue;
    if (!issueQueue) {
      return NextResponse.json({ error: "issueQueue not configured" }, { status: 400 });
    }

    const resolvedProjectId = (body?.projectId as string) ?? Object.keys(config.projects)[0];
    const projectIdErr = validateIdentifier(resolvedProjectId, "projectId");
    if (projectIdErr) {
      return NextResponse.json({ error: projectIdErr }, { status: 400 });
    }

    const projectConfig = config.projects[resolvedProjectId];
    if (!projectConfig) {
      return NextResponse.json(
        { error: `Project ${resolvedProjectId} not found` },
        { status: 404 },
      );
    }

    // Guard: check issue isn't already assigned to an active session
    const sessions = await sessionManager.list();
    const existing = sessions.find(
      (s) =>
        s.issueId === issueId &&
        !["merged", "killed", "terminated", "done"].includes(s.status),
    );
    if (existing) {
      return NextResponse.json(
        { error: `Issue already has active session: ${existing.id}` },
        { status: 409 },
      );
    }

    // Add agent-ready label via tracker
    const trackerName = projectConfig.tracker?.plugin ?? "linear";
    const tracker = registry.get<Tracker>("tracker", trackerName);
    if (tracker?.updateIssue) {
      await tracker.updateIssue(
        issueId,
        { labels: [issueQueue.agentLabel] },
        projectConfig,
      );
    }

    // Spawn agent immediately
    const session = await sessionManager.spawn({
      projectId: resolvedProjectId,
      issueId,
    });

    return NextResponse.json({ sessionId: session.id, issueId }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to assign issue" },
      { status: 500 },
    );
  }
}
