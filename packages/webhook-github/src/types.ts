export interface GitHubRepo {
  full_name: string; // "owner/repo"
}

export interface GitHubPRPayload {
  action: "opened" | "closed" | "reopened" | "synchronize" | string;
  pull_request: {
    head: { ref: string }; // branch name
    merged?: boolean;
  };
  repository: GitHubRepo;
}

export interface GitHubCheckSuitePayload {
  action: "completed" | string;
  check_suite: { head_branch: string; conclusion: string | null };
  repository: GitHubRepo;
}

export interface GitHubReviewPayload {
  action: "submitted" | string;
  pull_request: { head: { ref: string } };
  repository: GitHubRepo;
}
