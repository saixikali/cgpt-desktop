/**
 * 在脚本侧定位本机 codex CLI（与主进程 codex-resolver 的解析顺序保持一致）。
 *
 * 顺序：CODEX_BIN → PATH → MSIX(OpenAI.Codex) → ~/.codex/.sandbox-bin
 * 每个候选都会实际执行 `--version` 探活，权限不足/被杀的候选自动跳过。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function onPath(exe) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [exe], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0 || !r.stdout) return null;
  const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return first && existsSync(first) ? first : null;
}

function msixCodex() {
  if (process.platform !== "win32") return null;
  let ps;
  try {
    ps = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
    );
  } catch {
    return null;
  }
  const loc = ps.trim();
  if (!loc) return null;
  const candidate = join(loc, "app", "resources", "codex.exe");
  return existsSync(candidate) ? candidate : null;
}

export function codexCandidates() {
  const candidates = [];
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) {
    candidates.push({ path: process.env.CODEX_BIN, source: "CODEX_BIN" });
  }
  const fromPath =
    onPath(process.platform === "win32" ? "codex.exe" : "codex") ??
    onPath("codex");
  if (fromPath) candidates.push({ path: fromPath, source: "PATH" });
  const msix = msixCodex();
  if (msix) candidates.push({ path: msix, source: "MSIX" });
  const sandboxBin = join(
    homedir(),
    ".codex",
    ".sandbox-bin",
    process.platform === "win32" ? "codex.exe" : "codex",
  );
  if (existsSync(sandboxBin)) {
    candidates.push({ path: sandboxBin, source: "sandbox-bin" });
  }
  return candidates;
}

/** 执行 `codex --version`；返回版本字符串，失败返回 null。 */
export function probeCodex(codexPath) {
  let r;
  try {
    r = spawnSync(codexPath, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    });
  } catch {
    return null;
  }
  if (r.error || r.status === null) return null;
  const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const match = combined.match(/codex-cli\s+([0-9][^\s]*)/);
  return match ? match[1] : null;
}

/** 依次探活全部候选，返回首个可用项。 */
export function locateCodex() {
  for (const candidate of codexCandidates()) {
    const version = probeCodex(candidate.path);
    if (version) return { ...candidate, version };
  }
  return null;
}

/** Windows 下杀掉进程树（sandbox-bin 包装器会拉起子进程）。 */
export function killProcessTree(pid) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}
