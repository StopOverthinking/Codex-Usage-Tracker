import { spawn } from "node:child_process";
import type { NormalizedUsageSettings } from "../settings/settings.js";
import { locateCodexBinary } from "./codexLocator.js";
import { normalizeRateLimitResponse, selectRateLimitBucket } from "./rateLimitParser.js";
import type { UsageSnapshot } from "./types.js";

export async function readUsageViaAppServer(settings: NormalizedUsageSettings): Promise<UsageSnapshot> {
  const binary = await locateCodexBinary(settings);
  const result = await requestRateLimits(binary.path);
  const buckets = normalizeRateLimitResponse(result, settings.limitId);
  const selected = selectRateLimitBucket(buckets, settings.limitId);

  return {
    buckets,
    fetchedAt: Date.now(),
    selected,
    source: {
      detail: binary.copiedFrom ? `copied from ${binary.copiedFrom}` : binary.path,
      kind: "app-server"
    },
    stale: false
  };
}

function requestRateLimits(codexPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      finish(new Error("Timed out waiting for Codex rate limits."));
    }, 20000);

    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        child.stdin.end();
      } catch {
        // ignored during shutdown
      }
      try {
        child.kill();
      } catch {
        // ignored during shutdown
      }
      if (error) reject(error);
      else resolve(value);
    };

    child.once("error", (error) => finish(error));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const message = parseJson(line);
        if (!message || message.id !== 1) continue;

        if (message.error) {
          finish(new Error(`Codex app-server returned an error: ${JSON.stringify(message.error)}`));
        } else {
          finish(undefined, message.result);
        }
      }
    });
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(new Error(`Codex app-server exited before replying: code=${code}, signal=${signal}. ${stderr}`.trim()));
      }
    });

    send(child.stdin, {
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "streamdeck_codex_usage",
          title: "Stream Deck Codex Usage",
          version: "0.1.0"
        }
      }
    });
    send(child.stdin, { method: "initialized", params: {} });
    send(child.stdin, { method: "account/rateLimits/read", id: 1 });
  });
}

function send(stdin: NodeJS.WritableStream, message: unknown): void {
  stdin.write(`${JSON.stringify(message)}\n`);
}

function parseJson(line: string): { error?: unknown; id?: number; result?: unknown } | undefined {
  try {
    return JSON.parse(line) as { error?: unknown; id?: number; result?: unknown };
  } catch {
    return undefined;
  }
}
