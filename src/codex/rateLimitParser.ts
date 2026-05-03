import type { RateLimitBucket, RateLimitWindow } from "./types.js";

type UnknownRecord = Record<string, unknown>;

export function normalizeRateLimitResponse(value: unknown, preferredLimitId = "codex"): RateLimitBucket[] {
  const root = asRecord(value) ?? {};
  const result = asRecord(root.result) ?? root;
  const bucketsById = asRecord(result.rateLimitsByLimitId ?? result.rate_limits_by_limit_id);
  const buckets: RateLimitBucket[] = [];

  if (bucketsById) {
    for (const [id, rawBucket] of Object.entries(bucketsById)) {
      const bucket = normalizeBucket(rawBucket, id);
      if (bucket) buckets.push(bucket);
    }
  }

  const single = result.rateLimits ?? result.rate_limits;
  const singleBucket = normalizeBucket(single, preferredLimitId);
  if (singleBucket && !buckets.some((bucket) => bucket.limitId === singleBucket.limitId)) {
    buckets.unshift(singleBucket);
  }

  return buckets;
}

export function selectRateLimitBucket(buckets: RateLimitBucket[], preferredLimitId = "codex"): RateLimitBucket {
  const exact = buckets.find((bucket) => bucket.limitId === preferredLimitId);
  if (exact) return exact;

  const codex = buckets.find((bucket) => bucket.limitId === "codex");
  if (codex) return codex;

  const compatible = buckets.find((bucket) => bucket.primary?.windowDurationMins === 300 && bucket.secondary?.windowDurationMins === 10080);
  if (compatible) return compatible;

  if (buckets[0]) return buckets[0];
  throw new Error("No Codex rate limit bucket was found in the response.");
}

export function extractRolloutRateLimit(value: unknown): RateLimitBucket | undefined {
  const root = asRecord(value) ?? {};
  const candidates = [
    root.rate_limits,
    root.rateLimits,
    asRecord(root.payload)?.rate_limits,
    asRecord(root.payload)?.rateLimits,
    asRecord(root.item)?.rate_limits,
    asRecord(root.item)?.rateLimits
  ];

  for (const candidate of candidates) {
    const bucket = normalizeBucket(candidate, "codex");
    if (bucket) return bucket;
  }

  return undefined;
}

function normalizeBucket(value: unknown, fallbackLimitId: string): RateLimitBucket | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const primary = normalizeWindow(raw.primary);
  const secondary = normalizeWindow(raw.secondary);
  if (!primary && !secondary) return undefined;

  return {
    credits: normalizeCredits(raw.credits),
    limitId: stringOrNull(raw.limitId ?? raw.limit_id) ?? fallbackLimitId,
    limitName: stringOrNull(raw.limitName ?? raw.limit_name),
    planType: stringOrNull(raw.planType ?? raw.plan_type),
    primary,
    rateLimitReachedType: stringOrNull(raw.rateLimitReachedType ?? raw.rate_limit_reached_type),
    secondary
  };
}

function normalizeWindow(value: unknown): RateLimitWindow | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const usedPercent = numberOrNull(raw.usedPercent ?? raw.used_percent);
  const windowDurationMins = numberOrNull(raw.windowDurationMins ?? raw.window_minutes ?? raw.windowDurationMinutes);
  if (usedPercent === null || windowDurationMins === null) return null;

  return {
    resetsAt: numberOrNull(raw.resetsAt ?? raw.resets_at),
    usedPercent,
    windowDurationMins
  };
}

function normalizeCredits(value: unknown): RateLimitBucket["credits"] {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    balance: stringOrNull(raw.balance),
    hasCredits: Boolean(raw.hasCredits ?? raw.has_credits),
    unlimited: Boolean(raw.unlimited)
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
