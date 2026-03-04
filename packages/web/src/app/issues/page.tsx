import type { Metadata } from "next";
import { IssuesPage } from "@/components/IssuesPage";
import type { DashboardIssue } from "@/app/api/issues/route";
import type { Tracker } from "@composio/ao-core";
import { getServices } from "@/lib/services";
import { getProjectName } from "@/lib/project-name";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const projectName = getProjectName();
  return { title: { absolute: `Issues | ${projectName}` } };
}

export default async function Issues() {
  let issues: DashboardIssue[] = [];
  const projectName = getProjectName();

  try {
    const { config, registry, sessionManager } = await getServices();

    const projectId = Object.keys(config.projects)[0];
    const projectConfig = config.projects[projectId];
    if (!projectConfig) {
      return <IssuesPage issues={[]} projectName={projectName} />;
    }

    const trackerName = projectConfig.tracker?.plugin ?? "linear";
    const tracker = registry.get<Tracker>("tracker", trackerName);

    if (tracker?.listIssues) {
      const rawIssues = await tracker.listIssues(
        { state: "all", limit: 200 },
        projectConfig,
      );

      // Cross-reference with active sessions
      const sessions = await sessionManager.list();
      const issueSessionMap = new Map<
        string,
        { id: string; status: string; pr?: string }
      >();
      for (const s of sessions) {
        if (s.issueId) {
          issueSessionMap.set(s.issueId, {
            id: s.id,
            status: s.status,
            pr: s.pr?.url,
          });
        }
      }

      issues = rawIssues.map((issue) => {
        const session = issueSessionMap.get(issue.id);
        return {
          ...issue,
          sessionId: session?.id,
          sessionStatus: session?.status,
          prUrl: session?.pr,
        };
      });
    }
  } catch {
    // Config not found or services unavailable — show empty page
  }

  return <IssuesPage issues={issues} projectName={projectName} />;
}
