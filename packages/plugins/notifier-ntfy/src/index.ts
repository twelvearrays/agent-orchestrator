import https from "node:https";
import type {
  PluginModule,
  Notifier,
  OrchestratorEvent,
  EventPriority,
} from "@composio/ao-core";

interface NtfyConfig {
  topic: string;
  baseUrl?: string;
  token?: string;
  dashboardUrl?: string;
}

export const manifest = {
  name: "ntfy",
  slot: "notifier" as const,
  description: "Notifier plugin: ntfy.sh push notifications for iOS and macOS",
  version: "0.1.0",
};

const PRIORITY_MAP: Record<EventPriority, string> = {
  urgent: "5",
  action: "4",
  warning: "3",
  info: "2",
};

const TAG_MAP: Record<string, string> = {
  "pr.created": "tada",
  "ci.failing": "x",
  "merge.ready": "white_check_mark",
  "merge.completed": "rocket",
  "session.stuck": "sos",
  "session.needs_input": "speech_balloon",
  "session.killed": "stop_sign",
  "review.changes_requested": "pencil",
};

function ntfyTag(eventType: string): string {
  return TAG_MAP[eventType] ?? "robot";
}

export function create(config?: Record<string, unknown>): Notifier {
  const topic = config?.["topic"] as string | undefined;
  if (!topic) {
    throw new Error("notifier-ntfy requires a 'topic' config value");
  }
  const baseUrl = (config?.["baseUrl"] as string | undefined) ?? "https://ntfy.sh";
  const token = config?.["token"] as string | undefined;
  const dashboardUrl = config?.["dashboardUrl"] as string | undefined;
  const url = new URL(`${baseUrl}/${topic}`);

  return {
    name: "ntfy",

    async notify(event: OrchestratorEvent): Promise<void> {
      const headers: Record<string, string> = {
        "Title": event.type,
        "Priority": PRIORITY_MAP[event.priority] ?? "3",
        "Tags": ntfyTag(event.type),
        "Content-Type": "text/plain",
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      if (dashboardUrl) {
        headers["Click"] = `${dashboardUrl}/sessions/${encodeURIComponent(event.sessionId)}`;
      }

      await new Promise<void>((resolve) => {
        const req = https.request(
          {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: "POST",
            headers,
          },
          () => resolve(),
        );
        req.once("error", () => resolve()); // silent-fail — never block on notification
        req.end(event.message);
      });
    },
  };
}

export default { manifest, create } satisfies PluginModule<Notifier>;
