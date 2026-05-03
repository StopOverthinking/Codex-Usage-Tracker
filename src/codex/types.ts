export type RateLimitWindow = {
  resetsAt: number | null;
  usedPercent: number;
  windowDurationMins: number;
};

export type CreditsSnapshot = {
  balance: string | null;
  hasCredits: boolean;
  unlimited: boolean;
} | null;

export type RateLimitBucket = {
  credits: CreditsSnapshot;
  limitId: string;
  limitName: string | null;
  planType: string | null;
  primary: RateLimitWindow | null;
  rateLimitReachedType: string | null;
  secondary: RateLimitWindow | null;
};

export type UsageSnapshot = {
  buckets: RateLimitBucket[];
  fetchedAt: number;
  selected: RateLimitBucket;
  source: {
    detail?: string;
    kind: "app-server" | "session-files";
  };
  stale: boolean;
};

export type UsageResult =
  | {
      snapshot: UsageSnapshot;
      status: "ok";
      warning?: string;
    }
  | {
      error: string;
      lastSnapshot?: UsageSnapshot;
      status: "error";
    };
