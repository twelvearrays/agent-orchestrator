import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";

import type { Issue, IssueFilters, Tracker } from "@composio/ao-core";

export interface DashboardIssue extends Issue {
  /** Session ID if this issue has an active agent */
  sessionId?: string;
  /** Session status if linked */
  sessionStatus?: string;
  /** PR URL if linked session has a PR */
  prUrl?: string;
}

/** GET /api/issues — List issues from tracker with session cross-reference */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const state = (searchParams.get("state") as IssueFilters["state"]) ?? "open";
    const project = searchParams.get("project");
    const labelsParam = searchParams.get("labels");
    const labels = labelsParam ? labelsParam.split(",") : undefined;

    const { config, registry, sessionManager } = await getServices();

    // Use first project if none specified
    const projectId = project ?? Object.keys(config.projects)[0];
    const projectConfig = config.projects[projectId];
    if (!projectConfig) {
      return NextResponse.json({ error: `Project ${projectId} not found` }, { status: 404 });
    }

    const trackerName = projectConfig.tracker?.plugin ?? "linear";
    const tracker = registry.get<Tracker>("tracker", trackerName);
    if (!tracker?.listIssues) {
      return NextResponse.json(
        { error: "Tracker does not support listIssues" },
        { status: 501 },
      );
    }

    const issues = await tracker.listIssues({ state, labels, limit: 100 }, projectConfig);

    // Cross-reference with active sessions
    const sessions = await sessionManager.list();
    const issueSessionMap = new Map<string, { id: string; status: string; pr?: string }>();
    for (const s of sessions) {
      if (s.issueId) {
        issueSessionMap.set(s.issueId, {
          id: s.id,
          status: s.status,
          pr: s.pr?.url,
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
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list issues" },
      { status: 500 },
    );
  }
}
