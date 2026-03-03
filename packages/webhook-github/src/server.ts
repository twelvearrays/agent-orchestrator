import express from "express";
import http from "node:http";
import { loadConfig } from "./config.js";
import { verifySignature } from "./verify.js";
import { extractBranchAndRepo } from "./events.js";
import { correlateSession } from "./correlate.js";
import { isDuplicate, cleanup } from "./dedup.js";
import { sendNtfy } from "./notify.js";

const config = loadConfig();
const app = express();

app.use("/webhook/github", express.raw({ type: "application/json" }));

app.post("/webhook/github", (req, res) => {
  const body = req.body as Buffer;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const eventType = req.headers["x-github-event"] as string | undefined;

  if (!verifySignature(body, signature, config.webhookSecret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Always respond immediately — GitHub requires < 10s
  res.status(200).json({ ok: true });

  if (!eventType) return;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
  } catch {
    return;
  }

  const extracted = extractBranchAndRepo(eventType, payload);
  if (!extracted) return;

  const dedupKey = `${eventType}:${extracted.repo}:${extracted.branch}`;
  if (isDuplicate(dedupKey)) return;

  const action = (payload as Record<string, string>)["action"];

  // Async: correlate + fire reaction + send notification
  correlateSession(extracted.branch, extracted.repo, config.dataDir)
    .then((sessionId) => {
      if (!sessionId) {
        console.log(
          `[SKIP] No session for ${extracted.repo}@${extracted.branch}`,
        );
        return;
      }
      console.log(`[EVENT] ${eventType} → check session ${sessionId}`);
      try { sendNtfy(config, eventType, action, sessionId, extracted.branch); } catch { /* silent */ }
      return Promise.all([
        signalLifecycle(sessionId),
        fireReaction(eventType, action, sessionId),
      ]).then(() => {});
    })
    .catch((err: unknown) => {
      console.error("[ERROR] correlate/signal failed:", err);
    });
});

function fireReaction(eventType: string, action: string | undefined, sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL(`${config.webUrl}/api/internal/reaction`);
    const body = JSON.stringify({ event: eventType, action, sessionId });
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (parsed["ok"]) {
              console.log(`[REACTION] ${parsed["reaction"]} → ${parsed["trackerState"]} (${parsed["issueId"]})`);
            } else if (parsed["skipped"]) {
              console.log(`[REACTION] skipped: ${parsed["reason"]}`);
            }
          } catch { /* silent */ }
          resolve();
        });
      },
    );
    req.once("error", () => resolve()); // silent-fail
    req.end(body);
  });
}

function signalLifecycle(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL(
      `${config.internalUrl}/internal/check/${encodeURIComponent(sessionId)}`,
    );
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
      },
      () => resolve(),
    );
    req.once("error", () => resolve()); // silent-fail
    req.end();
  });
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    internalUrl: config.internalUrl,
    dataDir: config.dataDir,
  });
});

const cleanupInterval = setInterval(cleanup, 60_000);

const server = app.listen(config.port, () => {
  console.log(`[ao-webhook-github] Listening on :${config.port}`);
  console.log(`  Internal URL: ${config.internalUrl}`);
  console.log(`  Data dir:     ${config.dataDir}`);
});

process.once("SIGTERM", () => {
  clearInterval(cleanupInterval);
  server.close();
});
