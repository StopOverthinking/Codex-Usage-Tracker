import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { NormalizedUsageSettings } from "../settings/settings.js";
import { extractRolloutRateLimit, selectRateLimitBucket } from "./rateLimitParser.js";
import type { RateLimitBucket, UsageSnapshot } from "./types.js";

type CandidateFile = {
  mtimeMs: number;
  path: string;
};

export async function readUsageFromSessionFiles(settings: NormalizedUsageSettings): Promise<UsageSnapshot> {
  const sessionsRoot = path.join(homedir(), ".codex", "sessions");
  const files = (await collectJsonlFiles(sessionsRoot)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 80);
  const buckets: RateLimitBucket[] = [];

  for (const file of files) {
    const bucket = await readLatestBucket(file.path);
    if (bucket && !buckets.some((existing) => existing.limitId === bucket.limitId)) {
      buckets.push(bucket);
    }
    if (buckets.some((existing) => existing.limitId === settings.limitId || existing.limitId === "codex")) break;
  }

  const selected = selectRateLimitBucket(buckets, settings.limitId);
  return {
    buckets,
    fetchedAt: Date.now(),
    selected,
    source: {
      detail: sessionsRoot,
      kind: "session-files"
    },
    stale: true
  };
}

async function collectJsonlFiles(root: string): Promise<CandidateFile[]> {
  const files: CandidateFile[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const info = await stat(fullPath);
          files.push({ mtimeMs: info.mtimeMs, path: fullPath });
        }
      })
    );
  }

  await walk(root);
  return files;
}

async function readLatestBucket(file: string): Promise<RateLimitBucket | undefined> {
  let content;
  try {
    content = await readFile(file, "utf8");
  } catch {
    return undefined;
  }

  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line || (!line.includes("rate_limits") && !line.includes("rateLimits"))) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const bucket = extractRolloutRateLimit(parsed);
      if (bucket) return bucket;
    } catch {
      // Keep scanning older lines.
    }
  }

  return undefined;
}
