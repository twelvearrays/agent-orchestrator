import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Parse a flat key=value metadata file into a record.
 * Lines starting with # are comments. Empty lines are skipped.
 * Only the first `=` is used as the delimiter (values can contain `=`).
 */
function parseMetadataFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Find sessionId by matching branch against session metadata files.
 *
 * Session metadata layout:
 *   <dataDir>/<project-hash>/sessions/<session-id>   (flat key=value file)
 *
 * We walk all project dirs → sessions subdirs → session files, looking for
 * a metadata file where `branch` matches the webhook branch.
 *
 * Returns the first matching sessionId or null.
 */
export async function correlateSession(
  branch: string,
  _repo: string,
  dataDir: string,
): Promise<string | null> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(dataDir);
  } catch {
    return null;
  }

  for (const projectDir of projectDirs) {
    if (projectDir === "archive" || projectDir.startsWith(".")) continue;

    const sessionsDir = join(dataDir, projectDir, "sessions");
    let sessionFiles: string[];
    try {
      const info = await stat(sessionsDir);
      if (!info.isDirectory()) continue;
      sessionFiles = await readdir(sessionsDir);
    } catch {
      continue;
    }

    for (const sessionFile of sessionFiles) {
      const metadataPath = join(sessionsDir, sessionFile);
      try {
        const info = await stat(metadataPath);
        if (info.isDirectory()) continue;

        const raw = await readFile(metadataPath, "utf-8");
        const meta = parseMetadataFile(raw);

        if (meta["branch"] === branch) {
          return sessionFile;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}
