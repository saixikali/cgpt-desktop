/**
 * codex CLI 解析器：依次在 用户覆盖 → CODEX_BIN → PATH → MSIX → ~/.codex/.sandbox-bin
 * 中定位可执行文件，并对每个候选实际执行 `codex --version` 探活
 * （MSIX 资源在部分权限场景不可执行，不能只看文件是否存在）。
 *
 * 仅依赖 Node 内置模块，可被纯 Node 脚本直接导入测试。
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CodexSource = "override" | "env" | "PATH" | "MSIX" | "sandbox-bin";

export interface CodexResolution {
  path: string;
  version: string;
  source: CodexSource;
}

export interface CodexCandidate {
  path: string;
  source: CodexSource;
}

export interface ResolveFailure {
  candidate: CodexCandidate;
  reason: string;
}

const VERSION_RE = /codex-cli\s+([0-9][^\s]*)/;
const exeName = process.platform === "win32" ? "codex.exe" : "codex";

function which(bin: string): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  return execFileAsync(finder, [bin], { windowsHide: true, timeout: 10_000 })
    .then(({ stdout }) => {
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      return first && existsSync(first) ? first : null;
    })
    .catch(() => null);
}

async function msixCodex(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation",
      ],
      { windowsHide: true, timeout: 15_000 },
    );
    const loc = stdout.trim();
    if (!loc) return null;
    const candidate = join(loc, "app", "resources", "codex.exe");
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** 杀掉进程树（sandbox-bin 的 codex 是包装器，单 kill 会留下孙进程占用管道）。 */
function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** 执行 `codex --version`，返回版本字符串；失败/超时/不可执行返回 null。 */
export function probeCodex(path: string, timeoutMs = 20_000): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(path, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child.pid ?? -1);
      resolve(null);
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }
      const m = out.match(VERSION_RE);
      resolve(m ? m[1] : null);
    });
  });
}

/** 按优先级生成候选列表（文件存在性过滤）。 */
export async function codexCandidates(overridePath?: string): Promise<CodexCandidate[]> {
  const list: CodexCandidate[] = [];
  const push = (path: string | null, source: CodexSource) => {
    if (path && existsSync(path)) list.push({ path, source });
  };
  if (overridePath) push(overridePath, "override");
  if (process.env.CODEX_BIN) push(process.env.CODEX_BIN, "env");
  push(await which(exeName), "PATH");
  if (process.platform === "win32") push(await which("codex"), "PATH");
  push(await msixCodex(), "MSIX");
  push(join(homedir(), ".codex", ".sandbox-bin", exeName), "sandbox-bin");
  return list;
}

export interface ResolveResult {
  resolution: CodexResolution | null;
  failures: ResolveFailure[];
}

/**
 * 依次探活全部候选，返回首个可用项与落选原因。
 */
export async function resolveCodex(overridePath?: string): Promise<ResolveResult> {
  const candidates = await codexCandidates(overridePath);
  const failures: ResolveFailure[] = [];
  for (const candidate of candidates) {
    const version = await probeCodex(candidate.path);
    if (version) {
      return { resolution: { ...candidate, version }, failures };
    }
    failures.push({ candidate, reason: "--version 探活失败（不可执行/超时/版本无法识别）" });
  }
  return { resolution: null, failures };
}
