import { type NextRequest, NextResponse } from "next/server";
import { getSessionsDir, updateMetadata } from "@composio/ao-core";
import { getServices } from "@/lib/services";

/** POST /api/prs/:number/adopt — Create a pipeline-only session for a human PR */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number: prNumber } = await params;
  if (!/^\d+$/.test(prNumber)) {
    return NextResponse.json({ error: "Invalid PR number" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, prUrl, branch } = body as {
    projectId?: string;
    prUrl?: string;
    branch?: string;
  };

  if (!prUrl || !branch) {
    return NextResponse.json({ error: "prUrl and branch are required" }, { status: 400 });
  }

  try {
    const { config, sessionManager } = await getServices();

    const resolvedProjectId = projectId ?? Object.keys(config.projects)[0];
    const projectConfig = config.projects[resolvedProjectId];
    if (!projectConfig) {
      return NextResponse.json(
        { error: `Project ${resolvedProjectId} not found` },
        { status: 404 },
      );
    }

    // Create session with role "pipeline" — no coder agent, just pipeline stages
    const session = await sessionManager.spawn({
      projectId: resolvedProjectId,
      branch,
      role: "pipeline",
      skipPipeline: false,
    });

    // Write PR metadata so lifecycle manager picks it up
    const sessionsDir = getSessionsDir(config.configPath, projectConfig.path);
    updateMetadata(sessionsDir, session.id, {
      pr: prUrl,
      status: "pr_open",
      adoptedPr: prNumber,
    });

    // TODO: Log pr.adopted event once event logging is available from API routes
    // (event system currently lives in lifecycle-manager)

    return NextResponse.json({ sessionId: session.id, prNumber }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to adopt PR" },
      { status: 500 },
    );
  }
}
