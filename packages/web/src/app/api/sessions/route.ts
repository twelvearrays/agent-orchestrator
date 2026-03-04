import { ACTIVITY_STATE, type PRInfo, type Tracker } from "@composio/ao-core";
import { NextResponse } from "next/server";
import { getServices, getSCM } from "@/lib/services";
import { crossReferenceIssues } from "@/lib/issue-helpers";
import type { DashboardPR } from "@/lib/types";
import type { DashboardIssue } from "@/app/api/issues/route";
import {
  sessionToDashboard,
  resolveProject,
  enrichSessionPR,
  enrichDashboardPR,
  enrichSessionsMetadata,
  computeStats,
  prInfoToDashboard,
} from "@/lib/serialize";
import { getWatchedRepoSCMs } from "@/lib/repo-filter";

/** GET /api/sessions — List all sessions with full state
 * Query params:
 * - active=true: Only return non-exited sessions
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const { config, registry, sessionManager } = await getServices();
    const coreSessions = await sessionManager.list();

    // Find orchestrator session ID (if running) and expose to clients
    const orchSession = coreSessions.find((s) => s.id.endsWith("-orchestrator"));
    const orchestratorId = orchSession ? orchSession.id : null;

    // Filter out orchestrator sessions — they get their own button, not a card
    let workerSessions = coreSessions.filter((s) => !s.id.endsWith("-orchestrator"));

    // Convert to dashboard format
    let dashboardSessions = workerSessions.map(sessionToDashboard);

    // Filter to active sessions only if requested (keep workerSessions in sync)
    if (activeOnly) {
      const activeIndices = dashboardSessions
        .map((s, i) => (s.activity !== ACTIVITY_STATE.EXITED ? i : -1))
        .filter((i) => i !== -1);
      workerSessions = activeIndices.map((i) => workerSessions[i]);
      dashboardSessions = activeIndices.map((i) => dashboardSessions[i]);
    }

    // Enrich metadata (issue labels, agent summaries, issue titles) — cap at 2s
    const metaTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    await Promise.race([enrichSessionsMetadata(workerSessions, dashboardSessions, config, registry), metaTimeout]);

    // ── Run session PR enrichment, repo PR fetch, and issue fetch in parallel ──
    const repoSCMs = getWatchedRepoSCMs(config, registry);

    // Phase A: Enrich session PRs
    const sessionEnrichTask = (async () => {
      const enrichPromises = workerSessions.map((core, i) => {
        if (!core.pr) return Promise.resolve();
        const project = resolveProject(core, config.projects);
        const scm = getSCM(registry, project);
        if (!scm) return Promise.resolve();
        return enrichSessionPR(dashboardSessions[i], scm, core.pr);
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
        dashboardSessions
          .filter((s): s is typeof s & { pr: DashboardPR } => s.pr !== null)
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
        return crossReferenceIssues(rawIssues, coreSessions);
      } catch {
        return [];
      }
    })();

    // Wait for all three phases concurrently
    const [, extraPRs, issues] = await Promise.all([
      sessionEnrichTask,
      repoFetchTask,
      issueFetchTask,
    ]);

    return NextResponse.json({
      sessions: dashboardSessions,
      stats: computeStats(dashboardSessions),
      extraPRs,
      issues,
      orchestratorId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list sessions" },
      { status: 500 },
    );
  }
}
