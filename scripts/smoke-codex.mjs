import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const direct = process.argv[2];
const workspaceCopy = path.resolve(".codex-plugin-cache", "codex-smoke.exe");

async function candidate() {
  const candidates = direct ? [direct] : await findCodexCandidates();
  const failures = [];

  for (const item of candidates) {
    if (isWindowsAppsPath(item)) {
      try {
        await mkdir(path.dirname(workspaceCopy), { recursive: true });
        await copyFile(item, workspaceCopy);
        return workspaceCopy;
      } catch (error) {
        failures.push(`${item}: ${errorMessage(error)}`);
        continue;
      }
    }

    return item;
  }

  throw new Error(`No usable Codex binary was found. ${failures.join("; ")}`);
}

async function findCodexCandidates() {
  const command = platform() === "win32" ? "where.exe" : "which";
  const args = platform() === "win32" ? ["codex"] : ["-a", "codex"];

  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 4000, windowsHide: true });
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((a, b) => Number(b.toLowerCase().endsWith(".exe")) - Number(a.toLowerCase().endsWith(".exe")));
    return candidates.length > 0 ? candidates : ["codex"];
  } catch {
    return ["codex"];
  }
}

function readRateLimits(codexPath) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: process.env.HOME ?? homedir() },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => done(new Error("Timed out waiting for account/rateLimits/read")), 20000);
    let settled = false;

    function done(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // The process may already be gone.
      }
      if (error) reject(error);
      else resolve(value);
    }

    child.once("error", done);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = parseJson(line);
        if (!message) continue;
        if (message.id === 1) {
          if (message.error) done(new Error(JSON.stringify(message.error)));
          else done(undefined, message.result);
        }
      }
    });
    child.once("exit", (code, signal) => {
      if (!settled) {
        done(new Error(`app-server exited before response: code=${code} signal=${signal}; ${stderr.slice(-1000)}`));
      }
    });

    child.stdin.write(
      JSON.stringify({
        method: "initialize",
        id: 0,
        params: {
          clientInfo: {
            name: "streamdeck_codex_usage_smoke",
            title: "Stream Deck Codex Usage Smoke",
            version: "0.1.0"
          }
        }
      }) + "\n"
    );
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ method: "account/rateLimits/read", id: 1 }) + "\n");
  });
}

const codexPath = await candidate();
try {
  const result = await readRateLimits(codexPath);
  console.log(JSON.stringify(result, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 750));
} finally {
  await rm(".codex-plugin-cache", { force: true, maxRetries: 8, recursive: true, retryDelay: 250 });
}

function isWindowsAppsPath(candidatePath) {
  return platform() === "win32" && candidatePath.toLowerCase().includes("\\windowsapps\\");
}

function errorMessage(error) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : String(error);
}

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
