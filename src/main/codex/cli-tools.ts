/**
 * CLI 工具（Task 15）：`codex update` 实时流式输出、`codex doctor` 采集、
 * 诊断日志 zip 导出（PowerShell Compress-Archive，免 zip 原生依赖）。
 * 均直接调用本机 codex 二进制，不经过 app-server。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENTS, type CliToolResult } from "../../shared/ipc/contract.ts";
import { maskSecrets } from "../logging.ts";
import { logger } from "../logging.ts";
import { resolveCodex } from "./codex-resolver.ts";

type Broadcast = (event: string, payload: unknown) => void;

const DOCTOR_TIMEOUT_MS = 60_000;
const DOCTOR_OUTPUT_CAP = 200_000;

export class CliToolsService {
  private updateProc: ChildProcess | null = null;
  private readonly broadcast: Broadcast;
  private readonly getOverride: () => string | null;

  constructor(broadcast: Broadcast, getOverride: () => string | null) {
    this.broadcast = broadcast;
    this.getOverride = getOverride;
  }

  private async codexPath(): Promise<string> {
    const { resolution } = await resolveCodex(this.getOverride() ?? undefined);
    if (!resolution) throw new Error("未找到可用的 Codex CLI，无法执行该操作");
    return resolution.path;
  }

  isUpdating(): boolean {
    return this.updateProc !== null;
  }

  /** 启动 `codex update`；输出经 cli-update:output 实时推送，结束推 cli-update:exited。 */
  async startUpdate(): Promise<{ started: boolean; message?: string }> {
    if (this.updateProc) return { started: false, message: "更新已在进行中" };
    const codexPath = await this.codexPath();
    const child = spawn(codexPath, ["update"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.updateProc = child;
    logger.info("codex update 启动", { codexPath });
    const forward = (chunk: Buffer) => {
      // 输出可能夹带令牌/环境变量，推送前统一脱敏（G-6）。
      this.broadcast(EVENTS.cliUpdateOutput, { data: maskSecrets(chunk.toString("utf8")) });
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.on("error", (err) => {
      this.broadcast(EVENTS.cliUpdateOutput, { data: `\n[启动失败] ${err.message}\n` });
      this.broadcast(EVENTS.cliUpdateExited, { exitCode: -1 });
      this.updateProc = null;
    });
    child.on("exit", (code) => {
      logger.info("codex update 退出", { code });
      this.broadcast(EVENTS.cliUpdateExited, { exitCode: code ?? -1 });
      this.updateProc = null;
    });
    return { started: true };
  }

  /**
   * 取消更新：Windows 下 taskkill /T /F 杀整棵进程树
   * （codex update 会拉起子进程，child.kill 只杀直接进程，G-6）。
   */
  cancelUpdate(): void {
    const child = this.updateProc;
    if (!child || child.pid === undefined) return;
    logger.warn("用户取消 codex update", { pid: child.pid });
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    } catch (err) {
      logger.warn("取消更新失败", { error: (err as Error).message });
    }
  }

  /** 应用退出前清理，避免 codex update 成为孤儿进程。 */
  dispose(): void {
    if (this.updateProc) this.cancelUpdate();
  }

  /** 运行 `codex doctor` 并完整采集输出。 */
  async runDoctor(): Promise<CliToolResult> {
    const codexPath = await this.codexPath();
    return new Promise<CliToolResult>((resolve) => {
      const child = spawn(codexPath, ["doctor"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      let done = false;
      const finish = (code: number) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, output: output.slice(-DOCTOR_OUTPUT_CAP) });
      };
      const timer = setTimeout(() => {
        child.kill();
        output += "\n[超时] doctor 运行超过 60s 已终止";
        finish(124);
      }, DOCTOR_TIMEOUT_MS);
      child.stdout?.on("data", (c: Buffer) => (output += maskSecrets(c.toString("utf8"))));
      child.stderr?.on("data", (c: Buffer) => (output += maskSecrets(c.toString("utf8"))));
      child.on("error", (err) => {
        output += `\n[启动失败] ${err.message}`;
        finish(-1);
      });
      child.on("exit", (code) => finish(code ?? -1));
    });
  }

  /**
   * 导出诊断 zip：logs 目录副本 + 脱敏环境摘要。
   * 返回生成的 zip 路径；用户取消保存对话框返回 null。
   */
  async exportLogs(logsDir: string, envSummary: Record<string, unknown>, savePath: string): Promise<string | null> {
    const work = mkdtempSync(join(tmpdir(), "cgpt-diag-"));
    try {
      const bundleDir = join(work, "bundle");
      mkdirSync(bundleDir, { recursive: true });
      if (existsSync(logsDir)) {
        cpSync(logsDir, join(bundleDir, "logs"), { recursive: true });
      }
      writeFileSync(join(bundleDir, "env-summary.json"), JSON.stringify(envSummary, null, 2), "utf8");
      await runPowerShellCompress(bundleDir, savePath);
      logger.info("诊断包导出", { savePath });
      return savePath;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** 脱敏后的环境摘要（导出前调用，避免明文密钥入包）。 */
  buildEnvSummary(extra: Record<string, unknown>): Record<string, unknown> {
    const masked = JSON.stringify(extra, null, 2);
    return { generatedAt: new Date().toISOString(), summary: JSON.parse(maskSecrets(masked)) };
  }
}

function runPowerShellCompress(srcDir: string, destZip: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -Path (Join-Path '${srcDir.replace(/'/g, "''")}' *) -DestinationPath '${destZip.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true },
    );
    let err = "";
    child.stderr?.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Compress-Archive 失败: ${err.trim()}`))));
  });
}
