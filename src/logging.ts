import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const MAX_LOG_BYTES = 256 * 1024;
const MAX_LOG_FILES = 3;

function pluginRoot(): string {
  const pluginScript = process.argv.find((arg) => /com\.codexusage\.tracker\.sdPlugin[\\/]bin[\\/]plugin\.js$/i.test(arg)) ?? process.argv[1];
  if (!pluginScript) return process.cwd();
  return path.resolve(path.dirname(pluginScript), "..");
}

export async function log(message: string): Promise<void> {
  try {
    const directory = path.join(pluginRoot(), "logs");
    const file = path.join(directory, "codex-usage.log");
    await mkdir(directory, { recursive: true });
    await rotateLog(file);
    await appendFile(file, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Logging must never affect Stream Deck rendering.
  }
}

async function rotateLog(file: string): Promise<void> {
  try {
    const info = await stat(file);
    if (info.size < MAX_LOG_BYTES) return;
  } catch {
    return;
  }

  await rm(indexedLog(file, MAX_LOG_FILES), { force: true });
  for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
    await rename(indexedLog(file, index), indexedLog(file, index + 1)).catch(() => undefined);
  }
  await rename(file, indexedLog(file, 1)).catch(() => undefined);
}

function indexedLog(file: string, index: number): string {
  return `${file}.${index}`;
}
