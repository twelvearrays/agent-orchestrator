import type { Issue } from "@composio/ao-core";
import type { DashboardIssue } from "@/app/api/issues/route.js";

interface SessionRef {
  id: string;
  status: string;
  issueId?: string | null;
  pr?: { url: string } | null;
}

export function crossReferenceIssues(
  issues: Issue[],
  sessions: SessionRef[],
): DashboardIssue[] {
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
  return issues.map((issue) => {
    const session = issueSessionMap.get(issue.id);
    return {
      ...issue,
      sessionId: session?.id,
      sessionStatus: session?.status,
      prUrl: session?.pr,
    };
  });
}
