import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";
import type { DashboardSession, DashboardPR } from "@/lib/types";
import type { DashboardIssue } from "@/app/api/issues/route";
import type { PRInfo, Tracker } from "@composio/ao-core";
import { getServices, getSCM } from "@/lib/services";
import { crossReferenceIssues } from "@/lib/issue-helpers";
import {
  sessionToDashboard,
  resolveProject,
  enrichSessionPR,
  enrichDashboardPR,
  enrichSessionsMetadata,
  computeStats,
  prInfoToDashboard,
} from "@/lib/serialize";
import { prCache, prCacheKey } from "@/lib/cache";
import { getProjectName } from "@/lib/project-name";
import { getWatchedRepoSCMs } from "@/lib/repo-filter";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const projectName = getProjectName();
  // Use absolute to opt out of the layout's "%s | project" template
  return { title: { absolute: `ao | ${projectName}` } };
}

export default async function Home() {
  let sessions: DashboardSession[] = [];
  let extraPRs: DashboardPR[] = [];
  let issues: DashboardIssue[] = [];
  let orchestratorId: string | null = null;
  const projectName = getProjectName();
  try {
    const { config, registry, sessionManager } = await getServices();
    const allSessions = await sessionManager.list();

    // Find the orchestrator session (any session ending with -orchestrator)
    // Only set orchestratorId if an actual session exists (no fallback)
    const orchSession = allSessions.find((s) => s.id.endsWith("-orchestrator"));
    if (orchSession) {
      orchestratorId = orchSession.id;
    }

    // Filter out orchestrator from worker sessions
    const coreSessions = allSessions.filter((s) => !s.id.endsWith("-orchestrator"));
    sessions = coreSessions.map(sessionToDashboard);

    // Enrich metadata (issue labels, agent summaries, issue titles) — cap at 2s
    const metaTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    await Promise.race([enrichSessionsMetadata(coreSessions, sessions, config, registry), metaTimeout]);

    // ── Run session PR enrichment, repo PR fetch, and issue fetch in parallel ──
    const repoSCMs = getWatchedRepoSCMs(config, registry);

    // Phase A: Enrich session PRs with live SCM data
    const sessionEnrichTask = (async () => {
      const terminalStatuses = new Set(["merged", "killed", "cleanup", "done", "terminated"]);
      const enrichPromises = coreSessions.map((core, i) => {
        if (!core.pr) return Promise.resolve();

        const cacheKey = prCacheKey(core.pr.owner, core.pr.repo, core.pr.number);
        const cached = prCache.get(cacheKey);

        if (cached) {
          if (sessions[i].pr) {
            sessions[i].pr.state = cached.state;
            sessions[i].pr.title = cached.title;
            sessions[i].pr.additions = cached.additions;
            sessions[i].pr.deletions = cached.deletions;
            sessions[i].pr.ciStatus = cached.ciStatus as "none" | "pending" | "passing" | "failing";
            sessions[i].pr.reviewDecision = cached.reviewDecision as
              | "none"
              | "pending"
              | "approved"
              | "changes_requested";
            sessions[i].pr.ciChecks = cached.ciChecks.map((c) => ({
              name: c.name,
              status: c.status as "pending" | "running" | "passed" | "failed" | "skipped",
              url: c.url,
            }));
            sessions[i].pr.mergeability = cached.mergeability;
            sessions[i].pr.unresolvedThreads = cached.unresolvedThreads;
            sessions[i].pr.unresolvedComments = cached.unresolvedComments;
          }

          if (
            terminalStatuses.has(core.status) ||
            cached.state === "merged" ||
            cached.state === "closed"
          ) {
            return Promise.resolve();
          }
        }

        const project = resolveProject(core, config.projects);
        const scm = getSCM(registry, project);
        if (!scm) return Promise.resolve();
        return enrichSessionPR(sessions[i], scm, core.pr);
      });
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      await Promise.race([Promise.allSettled(enrichPromises), timeout]);
    })();

    // Phase B: Fetch and enrich open PRs from configured repos
    const repoFetchTask = (async (): Promise<DashboardPR[]> => {
      if (repoSCMs.size === 0) return [];

      const repoFetches = Array.from(repoSCMs.entries()).map(async ([repo, scm]) => {
        try {
          if (!scm.listOpenPRs) return [];
          return await scm.listOpenPRs(repo);
        } catch {
          return [];
        }
      });

      const fetchTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      const repoResults = await Promise.race([
        Promise.allSettled(repoFetches),
        fetchTimeout.then(() => [] as PromiseSettledResult<never>[]),
      ]);

      const allRepoPRs = (repoResults as PromiseSettledResult<PRInfo[]>[])
        .filter((r): r is PromiseFulfilledResult<PRInfo[]> => r.status === "fulfilled")
        .flatMap((r) => r.value);

      const sessionPRKeys = new Set(
        sessions
          .filter((s): s is DashboardSession & { pr: DashboardPR } => s.pr !== null)
          .map((s) => `${s.pr.owner}/${s.pr.repo}#${s.pr.number}`),
      );

      const newPRs = allRepoPRs
        .filter((pr) => !sessionPRKeys.has(`${pr.owner}/${pr.repo}#${pr.number}`))
        .map(prInfoToDashboard);

      if (newPRs.length > 0) {
        const extraEnrichPromises = newPRs.map((dashPR) => {
          const repo = `${dashPR.owner}/${dashPR.repo}`;
          const scm = repoSCMs.get(repo);
          if (!scm) return Promise.resolve();
          const prInfo: PRInfo = {
            number: dashPR.number,
            url: dashPR.url,
            title: dashPR.title,
            owner: dashPR.owner,
            repo: dashPR.repo,
            branch: dashPR.branch,
            baseBranch: dashPR.baseBranch,
            isDraft: dashPR.isDraft,
          };
          return enrichDashboardPR(dashPR, scm, prInfo);
        });
        const enrichTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        await Promise.race([Promise.allSettled(extraEnrichPromises), enrichTimeout]);
      }

      return newPRs;
    })();

    // Phase C: Fetch issues from tracker
    const issueFetchTask = (async (): Promise<DashboardIssue[]> => {
      try {
        const firstProjectId = Object.keys(config.projects)[0];
        const firstProject = firstProjectId ? config.projects[firstProjectId] : undefined;
        if (!firstProject) return [];
        const trackerName = firstProject.tracker?.plugin ?? "linear";
        const tracker = registry.get<Tracker>("tracker", trackerName);
        if (!tracker?.listIssues) return [];
        const issueTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2_000),
        );
        const rawIssues = await Promise.race([
          tracker.listIssues({ state: "open", limit: 50 }, firstProject),
          issueTimeout,
        ]);
        return crossReferenceIssues(rawIssues, allSessions);
      } catch {
        return [];
      }
    })();

    // Wait for all three phases concurrently
    const [, fetchedPRs, fetchedIssues] = await Promise.all([
      sessionEnrichTask,
      repoFetchTask,
      issueFetchTask,
    ]);
    extraPRs = fetchedPRs;
    issues = fetchedIssues;
  } catch {
    // Config not found or services unavailable — show empty dashboard
  }

  return (
    <Dashboard initialSessions={sessions} stats={computeStats(sessions)} orchestratorId={orchestratorId} projectName={projectName} extraPRs={extraPRs} issues={issues} />
  );
}
