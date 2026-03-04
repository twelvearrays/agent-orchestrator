/**
 * Builds the set of repos + SCM plugins to fetch PRs from.
 *
 * When `config.dashboard.repos` is set, only those repos are included.
 * Otherwise falls back to all project repos (backward compatible).
 */

import type { OrchestratorConfig, SCM, PluginRegistry } from "@composio/ao-core";
import { getSCM } from "./services";

export function getWatchedRepoSCMs(
  config: OrchestratorConfig,
  registry: PluginRegistry,
): Map<string, SCM> {
  const repoSCMs = new Map<string, SCM>();
  const dashboardRepos = config.dashboard?.repos;

  if (dashboardRepos && dashboardRepos.length > 0) {
    // Use only the explicitly listed repos.
    // Resolve SCM plugin from the first project that has one configured.
    const allowedSet = new Set(dashboardRepos);
    for (const project of Object.values(config.projects)) {
      if (!project.repo || !allowedSet.has(project.repo) || repoSCMs.has(project.repo)) continue;
      const scm = getSCM(registry, project);
      if (scm?.listOpenPRs) {
        repoSCMs.set(project.repo, scm);
      }
    }

    // For repos listed in dashboard.repos but not matching any project,
    // fall back to the first project's SCM plugin.
    const firstProject = Object.values(config.projects)[0];
    const fallbackSCM = firstProject ? getSCM(registry, firstProject) : null;
    if (fallbackSCM?.listOpenPRs) {
      for (const repo of dashboardRepos) {
        if (!repoSCMs.has(repo)) {
          repoSCMs.set(repo, fallbackSCM);
        }
      }
    }
  } else {
    // Default: all project repos
    for (const project of Object.values(config.projects)) {
      if (!project.repo || repoSCMs.has(project.repo)) continue;
      const scm = getSCM(registry, project);
      if (scm?.listOpenPRs) {
        repoSCMs.set(project.repo, scm);
      }
    }
  }

  return repoSCMs;
}
