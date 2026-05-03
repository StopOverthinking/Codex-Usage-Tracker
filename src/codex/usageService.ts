import type { NormalizedUsageSettings } from "../settings/settings.js";
import { readUsageViaAppServer } from "./appServerClient.js";
import { selectRateLimitBucket } from "./rateLimitParser.js";
import { readUsageFromSessionFiles } from "./sessionFilesFallback.js";
import type { UsageResult, UsageSnapshot } from "./types.js";

type CacheEntry = {
  result: UsageResult;
  timestamp: number;
};

export class UsageService {
  #cache: CacheEntry | undefined;
  #pending: Promise<UsageResult> | undefined;

  async getUsage(settings: NormalizedUsageSettings, options: { force?: boolean } = {}): Promise<UsageResult> {
    const ttlMs = getTtlMs(settings);
    const now = Date.now();
    if (!options.force && this.#cache && now - this.#cache.timestamp < ttlMs) {
      return this.#withSelectedBucket(this.#cache.result, settings.limitId);
    }

    if (this.#pending) return this.#pending.then((result) => this.#withSelectedBucket(result, settings.limitId));

    this.#pending = this.#refresh(settings)
      .then((result) => {
        this.#cache = { result, timestamp: Date.now() };
        return result;
      })
      .finally(() => {
        this.#pending = undefined;
      });

    return this.#pending.then((result) => this.#withSelectedBucket(result, settings.limitId));
  }

  get lastSnapshot(): UsageSnapshot | undefined {
    return this.#cache?.result.status === "ok" ? this.#cache.result.snapshot : this.#cache?.result.lastSnapshot;
  }

  async #refresh(settings: NormalizedUsageSettings): Promise<UsageResult> {
    try {
      const snapshot = await readUsageViaAppServer(settings);
      return { snapshot, status: "ok" };
    } catch (error) {
      const appServerError = friendlyError(error);

      if (settings.preferSessionFilesFallback) {
        try {
          const snapshot = await readUsageFromSessionFiles(settings);
          return {
            snapshot,
            status: "ok",
            warning: `Using last recorded Codex session data. ${appServerError}`
          };
        } catch {
          // Preserve the app-server error because it is the actionable failure.
        }
      }

      return {
        error: appServerError,
        lastSnapshot: this.lastSnapshot,
        status: "error"
      };
    }
  }

  #withSelectedBucket(result: UsageResult, limitId: string): UsageResult {
    if (result.status === "ok") {
      return {
        ...result,
        snapshot: reselectSnapshot(result.snapshot, limitId)
      };
    }

    return result.lastSnapshot
      ? {
          ...result,
          lastSnapshot: reselectSnapshot(result.lastSnapshot, limitId)
        }
      : result;
  }
}

function reselectSnapshot(snapshot: UsageSnapshot, limitId: string): UsageSnapshot {
  return {
    ...snapshot,
    selected: selectRateLimitBucket(snapshot.buckets, limitId)
  };
}

function getTtlMs(settings: NormalizedUsageSettings): number {
  if (settings.refreshSeconds === 0) return 60000;
  return Math.max(60000, settings.refreshSeconds * 1000);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|ENOENT/i.test(message)) return "Codex CLI was not found.";
  if (/access is denied|access denied|EACCES|permission/i.test(message)) return "Codex CLI could not be executed because the OS denied access.";
  if (/account\/rateLimits/i.test(message)) return "Codex returned an account/rateLimits error. Check that Codex is logged in.";
  if (/No Codex rate limit bucket/i.test(message)) return "Codex replied, but no usage bucket was present.";
  return message.replace(/\s+/g, " ").trim();
}
