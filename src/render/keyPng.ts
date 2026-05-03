import type { ScreenMode } from "../settings/settings.js";
import type { RateLimitBucket, RateLimitWindow, UsageResult, UsageSnapshot } from "../codex/types.js";
import { PngCanvas, measureText } from "./pngCanvas.js";

type RenderInput = {
  result?: UsageResult;
  screenMode: ScreenMode;
};

const SIZE = 144;
const COLORS = {
  background: "#1A1C1F",
  blue: "#339CFF",
  green: "#34D66F",
  orange: "#FF5A1F",
  text: "#FFFFFF"
} as const;

export function renderLoadingPngDataUri(): string {
  const canvas = baseCanvas(COLORS.background);
  drawHeader(canvas);
  canvas.text("LOADING", 72, 58, 2, COLORS.blue, "center");
  canvas.text("USAGE", 72, 88, 2, COLORS.text, "center");
  drawMeter(canvas, 24, 112, 96, 8, 42, COLORS.blue);
  return canvas.toDataUri();
}

export function renderRefreshingPngDataUri(): string {
  const canvas = baseCanvas(COLORS.background);
  drawHeader(canvas);
  drawRefreshMark(canvas);
  canvas.text("REFRESH", 72, 102, 2, COLORS.blue, "center");
  drawMeter(canvas, 24, 120, 96, 8, 74, COLORS.blue);
  return canvas.toDataUri();
}

export function renderUsagePngDataUri(input: RenderInput): string {
  if (!input.result) return renderLoadingPngDataUri();

  if (input.result.status === "error") {
    if (input.result.lastSnapshot) {
      return renderSnapshotPng(input.result.lastSnapshot, input.screenMode, "STALE");
    }
    return renderErrorPng(input.result.error);
  }

  return renderSnapshotPng(input.result.snapshot, input.screenMode, input.result.warning ? "STALE" : undefined);
}

function renderSnapshotPng(snapshot: UsageSnapshot, screenMode: ScreenMode, message?: string): string {
  const stale = message ?? (snapshot.stale ? "STALE" : undefined);
  return screenMode === "details" ? renderDetailsPng(snapshot.selected, stale) : renderUsageOverviewPng(snapshot.selected, stale);
}

function renderUsageOverviewPng(bucket: RateLimitBucket, message?: string): string {
  const sessionPercent = remainingPercent(bucket.primary);
  const weeklyPercent = remainingPercent(bucket.secondary);

  const canvas = baseCanvas(COLORS.background);
  drawHeader(canvas);
  drawAlertIndicator(canvas, sessionPercent, weeklyPercent, message);
  drawUsageRow(canvas, 34, "5H", sessionPercent, COLORS.blue);
  drawUsageRow(canvas, 88, "1W", weeklyPercent, COLORS.green);
  return canvas.toDataUri();
}

function renderDetailsPng(bucket: RateLimitBucket, message?: string): string {
  const canvas = baseCanvas(COLORS.background);
  drawHeader(canvas);
  drawAlertIndicator(canvas, remainingPercent(bucket.primary), remainingPercent(bucket.secondary), message);
  drawFittedText(canvas, planLabel(bucket), 72, 36, 2, 2, 118, COLORS.text);
  drawDetailRow(canvas, 18, 68, "5H", formatReset(bucket.primary, false), COLORS.blue);
  drawWeeklyDetailRow(canvas, 18, 98, formatReset(bucket.secondary, true), COLORS.green);
  return canvas.toDataUri();
}

function renderErrorPng(error: string): string {
  const canvas = baseCanvas(COLORS.background);
  drawHeader(canvas);
  canvas.text("ERROR", 72, 58, 4, COLORS.orange, "center");
  canvas.text(shortError(error), 72, 96, 2, COLORS.text, "center");
  drawMeter(canvas, 24, 114, 96, 8, 25, COLORS.orange);
  return canvas.toDataUri();
}

function baseCanvas(background: string): PngCanvas {
  return new PngCanvas(SIZE, SIZE, background);
}

function drawHeader(canvas: PngCanvas): void {
  canvas.text("CODEX", 72, 8, 2, COLORS.text, "center");
  canvas.roundedRect(52, 28, 40, 4, 2, COLORS.blue);
}

function drawRefreshMark(canvas: PngCanvas): void {
  canvas.roundedRect(40, 48, 64, 8, 4, COLORS.blue);
  canvas.roundedRect(40, 84, 64, 8, 4, COLORS.blue);
  canvas.rect(36, 52, 8, 18, COLORS.blue);
  canvas.rect(100, 68, 8, 18, COLORS.blue);
  canvas.rect(90, 40, 8, 8, COLORS.blue);
  canvas.rect(98, 48, 8, 8, COLORS.blue);
  canvas.rect(100, 92, 8, 8, COLORS.blue);
  canvas.rect(92, 84, 8, 8, COLORS.blue);
  canvas.text("SYNC", 72, 62, 4, COLORS.text, "center");
}

function drawUsageRow(canvas: PngCanvas, y: number, label: string, percent: number | null, color: string): void {
  canvas.text(label, 18, y + 10, 2, COLORS.text);
  drawFittedText(canvas, percentText(percent), 126, y, 4, 2, 86, color, "right");
  drawMeter(canvas, 18, y + 38, 108, 8, percent ?? 0, color);
}

function drawDetailRow(canvas: PngCanvas, x: number, y: number, label: string, value: string, color: string): void {
  canvas.text(label, x, y, 2, COLORS.text);
  drawFittedText(canvas, value, 126, y - 4, 2, 2, 86, color, "right");
}

function drawWeeklyDetailRow(canvas: PngCanvas, x: number, y: number, value: string, color: string): void {
  canvas.text("1W", x, y, 2, COLORS.text);
  drawFittedText(canvas, value, 72, y + 20, 2, 2, 126, color);
}

function drawMeter(canvas: PngCanvas, x: number, y: number, width: number, height: number, percent: number, color: string): void {
  const safePercent = Math.max(0, Math.min(100, percent));
  const trackY = y + Math.floor(height / 2);
  const filledWidth = snapToGrid(Math.max(height, Math.round(width * safePercent / 100)));
  canvas.rect(x, trackY, width, 2, COLORS.text);
  if (safePercent > 0) canvas.roundedRect(x, y, filledWidth, height, height / 2, color);
}

function drawAlertIndicator(canvas: PngCanvas, sessionPercent: number | null, weeklyPercent: number | null, message?: string): void {
  const alert = alertColor(sessionPercent, weeklyPercent, message);
  if (alert) canvas.roundedRect(52, 28, 40, 4, 2, alert);
}

function drawFittedText(
  canvas: PngCanvas,
  value: string,
  x: number,
  y: number,
  preferredScale: number,
  minimumScale: number,
  maxWidth: number,
  color: string,
  align: "center" | "right" = "center"
): void {
  const minimum = evenScale(minimumScale);
  let scale = evenScale(preferredScale);
  while (scale > minimum && measureText(value, scale) > maxWidth) scale -= 2;
  canvas.text(value, x, y, scale, color, align);
}

function evenScale(scale: number): number {
  const rounded = Math.max(2, Math.round(scale));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function snapToGrid(value: number): number {
  return Math.round(value / 2) * 2;
}

function remainingPercent(window: RateLimitWindow | null): number | null {
  if (!window) return null;
  const used = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
  return 100 - used;
}

function percentText(percent: number | null): string {
  return percent === null ? "N/A" : `${percent}%`;
}

function alertColor(sessionPercent: number | null, weeklyPercent: number | null, message?: string): string | undefined {
  if (message) return COLORS.orange;
  const values = [sessionPercent, weeklyPercent].filter((value): value is number => value !== null);
  if (values.length === 0) return COLORS.orange;
  const minimum = Math.min(...values);
  if (minimum <= 35) return COLORS.orange;
  return undefined;
}

function planLabel(bucket: RateLimitBucket): string {
  const raw = (bucket.planType ?? bucket.limitName ?? bucket.limitId ?? "Codex").trim();
  const combined = [bucket.planType, bucket.limitName, bucket.limitId].filter(Boolean).join(" ");
  const multiplier = planMultiplier(combined, bucket.planType);
  if (/enterprise/i.test(raw)) return "ENTERPRISE";
  if (/business/i.test(raw)) return "BUSINESS";
  if (/team/i.test(raw)) return "TEAM";
  if (/plus/i.test(raw)) return "PLUS";
  if (/pro/i.test(combined)) return multiplier ? `PRO ${multiplier}` : "PRO";
  if (/free/i.test(raw)) return "FREE";
  const sanitized = raw.toUpperCase().replace(/[^A-Z0-9 /-]/g, "").trim();
  return sanitized ? sanitized.slice(0, 14) : "CODEX";
}

function planMultiplier(value: string, planType: string | null): "5X" | "20X" | undefined {
  const compactPlanType = (planType ?? "").replace(/[\s_-]/g, "").toLowerCase();
  if (compactPlanType === "prolite") return "5X";
  if (compactPlanType === "pro") return "20X";

  const normalized = value.replace(/[_-]/g, " ");
  const compact = normalized.replace(/\s+/g, "").toLowerCase();
  if (compact.includes("prolite")) return "5X";
  if (compact.includes("pro20x")) return "20X";
  if (compact.includes("pro5x")) return "5X";
  const match = normalized.match(/(?:^|\s)(20|5)\s*x(?:\s|$)/i) ?? normalized.match(/(?:^|\s)pro\s*(20|5)\s*x(?:\s|$)/i);
  if (!match?.[1]) return undefined;
  return match[1] === "20" ? "20X" : "5X";
}

function formatReset(window: RateLimitWindow | null, includeDate: boolean): string {
  if (!window?.resetsAt) return "N/A";
  const date = new Date(window.resetsAt * 1000);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  if (!includeDate) return `${hours}:${minutes}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

function shortError(error: string): string {
  if (/not found/i.test(error)) return "NO CODEX";
  if (/logged in|account/i.test(error)) return "LOGIN";
  if (/denied|access/i.test(error)) return "ACCESS";
  return "CHECK LOG";
}
