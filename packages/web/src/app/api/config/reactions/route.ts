import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const CONFIG_PATH = join(process.cwd(), "agent-orchestrator.yaml");

const EVENT_FLOW = [
  { event: "pr.created", reactionKey: "pr-opened", description: "Agent opened a PR" },
  { event: "ci.failing", reactionKey: "ci-failed", description: "CI checks failing" },
  { event: "review.changes_requested", reactionKey: "changes-requested", description: "Reviewer requested changes" },
  { event: "automated_review.found", reactionKey: "bugbot-comments", description: "Automated review comments" },
  { event: "merge.conflicts", reactionKey: "merge-conflicts", description: "Merge conflicts" },
  { event: "merge.ready", reactionKey: "approved-and-green", description: "PR approved + CI green" },
  { event: "session.stuck", reactionKey: "agent-stuck", description: "Agent appears stuck" },
  { event: "session.needs_input", reactionKey: "agent-needs-input", description: "Agent needs human input" },
  { event: "session.killed", reactionKey: "agent-exited", description: "Agent process exited" },
  { event: "summary.all_complete", reactionKey: "all-complete", description: "All sessions complete" },
];

export async function GET() {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    const reactions = (config["reactions"] as Record<string, unknown> | undefined) ?? {};
    return NextResponse.json({ reactions, eventFlow: EVENT_FLOW });
  } catch {
    return NextResponse.json({ reactions: {}, eventFlow: EVENT_FLOW });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { reactions: Record<string, unknown> };
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    config["reactions"] = body.reactions;
    writeFileSync(CONFIG_PATH, stringifyYaml(config), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
