import type { JsonObject } from "@elgato/utils";

export const DEFAULT_LIMIT_ID = "codex";
export const DEFAULT_REFRESH_SECONDS = 300;

export type ScreenMode = "usage" | "details";

export type UsageSettings = JsonObject & {
  allowWindowsAppsCopy?: boolean;
  codexPath?: string;
  limitId?: string;
  preferSessionFilesFallback?: boolean;
  refreshSeconds?: number;
  screenMode?: ScreenMode;
};

export type NormalizedUsageSettings = {
  allowWindowsAppsCopy: boolean;
  codexPath?: string;
  limitId: string;
  preferSessionFilesFallback: boolean;
  refreshSeconds: number;
  screenMode: ScreenMode;
};

export function normalizeSettings(settings: UsageSettings | undefined): NormalizedUsageSettings {
  const rawRefresh = Number(settings?.refreshSeconds ?? DEFAULT_REFRESH_SECONDS);
  const refreshSeconds = rawRefresh === 0 ? 0 : clampNumber(rawRefresh, 60, 1800);
  const codexPath = typeof settings?.codexPath === "string" && settings.codexPath.trim() ? settings.codexPath.trim() : undefined;
  const limitId = typeof settings?.limitId === "string" && settings.limitId.trim() ? settings.limitId.trim() : DEFAULT_LIMIT_ID;
  const screenMode = settings?.screenMode === "details" ? "details" : "usage";

  return {
    allowWindowsAppsCopy: settings?.allowWindowsAppsCopy !== false,
    codexPath,
    limitId,
    preferSessionFilesFallback: settings?.preferSessionFilesFallback !== false,
    refreshSeconds,
    screenMode
  };
}

export function settingsForPersistence(settings: UsageSettings | undefined): UsageSettings {
  const normalized = normalizeSettings(settings);
  return {
    allowWindowsAppsCopy: normalized.allowWindowsAppsCopy,
    codexPath: normalized.codexPath ?? "",
    limitId: normalized.limitId,
    preferSessionFilesFallback: normalized.preferSessionFilesFallback,
    refreshSeconds: normalized.refreshSeconds,
    screenMode: normalized.screenMode
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REFRESH_SECONDS;
  return Math.max(min, Math.min(max, Math.round(value)));
}
