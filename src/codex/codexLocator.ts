import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { NormalizedUsageSettings } from "../settings/settings.js";

const execFileAsync = promisify(execFile);

export type CodexBinary = {
  copiedFrom?: string;
  path: string;
  source: string;
};

type Candidate = {
  path: string;
  source: string;
};

export async function locateCodexBinary(settings: NormalizedUsageSettings): Promise<CodexBinary> {
  const candidates = uniqueCandidates(await getCandidates(settings));
  const failures: string[] = [];

  for (const candidate of candidates) {
    const direct = await validateCandidate(candidate);
    if (direct.ok) return { path: candidate.path, source: candidate.source };
    failures.push(`${candidate.source}: ${shortPath(candidate.path)} (${direct.error})`);

    if (settings.allowWindowsAppsCopy && isWindowsAppsPath(candidate.path)) {
      try {
        const copied = await copyWindowsAppsBinary(candidate.path);
        const copiedResult = await validateCandidate({ path: copied, source: "windowsapps-copy" });
        if (copiedResult.ok) {
          return {
            copiedFrom: candidate.path,
            path: copied,
            source: "windowsapps-copy"
          };
        }
        failures.push(`windowsapps-copy: ${shortPath(copied)} (${copiedResult.error})`);
      } catch (error) {
        failures.push(`windowsapps-copy: ${shortPath(candidate.path)} (${errorMessage(error)})`);
      }
    }
  }

  throw new Error(
    failures.length > 0
      ? `No executable Codex CLI was found. Tried ${failures.join("; ")}`
      : "No Codex CLI candidate was found. Install Codex CLI or set a custom path in the action settings."
  );
}

async function getCandidates(settings: NormalizedUsageSettings): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  if (settings.codexPath) candidates.push({ path: settings.codexPath, source: "settings" });
  if (process.env.CODEX_BIN) candidates.push({ path: process.env.CODEX_BIN, source: "CODEX_BIN" });

  const commandCandidates = await findOnPath();
  candidates.push(...commandCandidates);

  if (platform() === "win32") {
    candidates.push(
      ...(await findWindowsAppsPackages()),
      {
        path: "codex.exe",
        source: "PATH"
      }
    );
  } else {
    candidates.push(
      { path: "/opt/homebrew/bin/codex", source: "common-path" },
      { path: "/usr/local/bin/codex", source: "common-path" },
      { path: path.join(homedir(), ".local", "bin", "codex"), source: "common-path" },
      { path: "codex", source: "PATH" }
    );
  }

  return candidates;
}

async function findOnPath(): Promise<Candidate[]> {
  const command = platform() === "win32" ? "where.exe" : "which";
  const args = platform() === "win32" ? ["codex"] : ["-a", "codex"];

  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 4000, windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((a, b) => Number(b.toLowerCase().endsWith(".exe")) - Number(a.toLowerCase().endsWith(".exe")))
      .map((candidatePath) => ({ path: candidatePath, source: command }));
  } catch {
    return [];
  }
}

async function findWindowsAppsPackages(): Promise<Candidate[]> {
  const appxCandidates = await findWindowsAppsPackagesViaAppx();
  const directoryCandidates = await findWindowsAppsPackagesViaDirectory();
  return [...appxCandidates, ...directoryCandidates];
}

async function findWindowsAppsPackagesViaAppx(): Promise<Candidate[]> {
  const command = "powershell.exe";
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "$ErrorActionPreference = 'Stop'; Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | ForEach-Object { $_.InstallLocation }"
  ];

  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 5000, windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((installLocation) => ({
        path: path.join(installLocation, "app", "resources", "codex.exe"),
        source: "appx-package"
      }));
  } catch {
    return [];
  }
}

async function findWindowsAppsPackagesViaDirectory(): Promise<Candidate[]> {
  const root = "C:\\Program Files\\WindowsApps";
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" }))
      .map((entry) => ({
        path: path.join(root, entry.name, "app", "resources", "codex.exe"),
        source: "windowsapps-scan"
      }));
  } catch {
    return [];
  }
}

async function validateCandidate(candidate: Candidate): Promise<{ error: string; ok: false } | { ok: true }> {
  try {
    await execFileAsync(candidate.path, ["--version"], { timeout: 5000, windowsHide: true });
    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error), ok: false };
  }
}

async function copyWindowsAppsBinary(source: string): Promise<string> {
  await access(source);
  const info = await stat(source);
  const hash = createHash("sha256").update(`${source}:${info.size}:${info.mtimeMs}`).digest("hex").slice(0, 16);
  const targetDirectory = path.join(homedir(), ".codex-streamdeck-usage", "codex-bin", hash);
  const target = path.join(targetDirectory, "codex.exe");
  await mkdir(targetDirectory, { recursive: true });
  await copyFile(source, target);
  return target;
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const key = platform() === "win32" ? candidate.path.toLowerCase() : candidate.path;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique;
}

function isWindowsAppsPath(candidatePath: string): boolean {
  return platform() === "win32" && candidatePath.toLowerCase().includes("\\windowsapps\\");
}

function shortPath(candidatePath: string): string {
  return candidatePath.length > 96 ? `...${candidatePath.slice(-93)}` : candidatePath;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, " ").trim();
  return String(error);
}
