export interface BranchRepo {
  branch: string;
  repo: string;
}

export function extractBranchAndRepo(
  eventType: string,
  payload: Record<string, unknown>,
): BranchRepo | null {
  if (eventType === "pull_request" || eventType === "pull_request_review") {
    const pr = payload["pull_request"] as
      | { head?: { ref?: string } }
      | undefined;
    const repo = (payload["repository"] as { full_name?: string } | undefined)
      ?.full_name;
    const branch = pr?.head?.ref;
    if (branch && repo) return { branch, repo };
  }
  if (eventType === "check_suite") {
    const suite = payload["check_suite"] as
      | { head_branch?: string }
      | undefined;
    const repo = (payload["repository"] as { full_name?: string } | undefined)
      ?.full_name;
    const branch = suite?.head_branch;
    if (branch && repo) return { branch, repo };
  }
  if (eventType === "check_run") {
    const run = payload["check_run"] as
      | { check_suite?: { head_branch?: string } }
      | undefined;
    const repo = (payload["repository"] as { full_name?: string } | undefined)
      ?.full_name;
    const branch = run?.check_suite?.head_branch;
    if (branch && repo) return { branch, repo };
  }
  return null;
}
