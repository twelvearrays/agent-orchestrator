import { readdir, readFile } from "node:fs/promises";
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
 * Find sessionId by matching branch + repo against session metadata files.
 * Metadata files are flat key=value format (one per line), not JSON.
 * Returns the first matching sessionId or null.
 */
export async function correlateSession(
  branch: string,
  repo: string,
  dataDir: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    // Skip archive directory and hidden files
    if (entry === "archive" || entry.startsWith(".")) continue;

    const metadataPath = join(dataDir, entry);
    try {
      const raw = await readFile(metadataPath, "utf-8");
      const meta = parseMetadataFile(raw);

      if (meta["branch"] === branch) {
        // Match repo: check if the metadata repo contains the repo name
        // Handles both "owner/repo" and just "repo" in metadata
        const metaRepo = meta["repo"] ?? meta["project"] ?? "";
        const repoName = repo.split("/")[1] ?? repo;
        if (metaRepo.includes(repoName) || metaRepo === repo) {
          return entry;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}
