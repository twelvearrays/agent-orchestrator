import { describe, it, expect } from "vitest";
import { extractBranchAndRepo } from "../events.js";

describe("extractBranchAndRepo", () => {
  it("extracts from pull_request event", () => {
    const result = extractBranchAndRepo("pull_request", {
      action: "opened",
      pull_request: { head: { ref: "feature/my-branch" } },
      repository: { full_name: "owner/repo" },
    });
    expect(result).toEqual({ branch: "feature/my-branch", repo: "owner/repo" });
  });

  it("extracts from check_suite event", () => {
    const result = extractBranchAndRepo("check_suite", {
      action: "completed",
      check_suite: { head_branch: "feature/ci-branch", conclusion: "success" },
      repository: { full_name: "owner/repo" },
    });
    expect(result).toEqual({ branch: "feature/ci-branch", repo: "owner/repo" });
  });

  it("extracts from check_run event", () => {
    const result = extractBranchAndRepo("check_run", {
      action: "completed",
      check_run: {
        check_suite: { head_branch: "feature/run-branch" },
      },
      repository: { full_name: "owner/repo" },
    });
    expect(result).toEqual({
      branch: "feature/run-branch",
      repo: "owner/repo",
    });
  });

  it("extracts from pull_request_review event", () => {
    const result = extractBranchAndRepo("pull_request_review", {
      action: "submitted",
      pull_request: { head: { ref: "feature/reviewed" } },
      repository: { full_name: "owner/repo" },
    });
    expect(result).toEqual({ branch: "feature/reviewed", repo: "owner/repo" });
  });

  it("returns null for unhandled event types", () => {
    expect(extractBranchAndRepo("ping", {})).toBeNull();
  });

  it("returns null when pull_request payload is missing head ref", () => {
    expect(
      extractBranchAndRepo("pull_request", {
        action: "opened",
        pull_request: {},
        repository: { full_name: "owner/repo" },
      }),
    ).toBeNull();
  });
});
