/**
 * app-server stdio 传输层：
 *   spawn `codex app-server --stdio`
 *   stdout 按 \n 分帧 → JSON.parse → 'message'
 *   stdin  JSON.stringify + '\n'
 * 处理：stderr 行收集、畸形帧容错、EPIPE、退出事件、Windows 进程树清理、写背压。
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { logger, maskSecrets } from "../logging.ts";

export interface AppServerTransportOptions {
  /** app-server 工作目录（独立于渲染进程任何页面）。 */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface TransportExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 是否为客户端主动 stop() 触发。 */
  expected: boolean;
}

export declare interface AppServerTransport {
  on(event: "message", listener: (obj: unknown) => void): this;
  on(event: "frameError", listener: (line: string, err: Error) => void): this;
  on(event: "stderr", listener: (line: string) => void): this;
  on(event: "exit", listener: (info: TransportExit) => void): this;
  on(event: "spawnError", listener: (err: Error) => void): this;
}

export class AppServerTransport extends EventEmitter {
  private child: ChildProcess | null = null;
  private rxBuffer = Buffer.alloc(0);
  private stderrBuffer = "";
  private stopping = false;
  readonly codexPath: string;
  private readonly options: AppServerTransportOptions;

  constructor(codexPath: string, options: AppServerTransportOptions = {}) {
    super();
    this.codexPath = codexPath;
    this.options = options;
  }

  get childPid(): number | undefined {
    return this.child?.pid;
  }

  get alive(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null;
  }

  start(): void {
    if (this.child) throw new Error("transport 已启动");
    this.stopping = false;
    this.rxBuffer = Buffer.alloc(0);
    this.stderrBuffer = "";

    const child = spawn(this.codexPath, ["app-server", "--stdio"], {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => this.onStdout(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.onStderr(chunk.toString("utf8")));
    child.on("error", (err) => {
      logger.error("app-server 进程错误", { error: err.message });
      this.emit("spawnError", err);
    });
    child.on("exit", (code, signal) => {
      this.flushStderr();
      logger.warn("app-server 退出", { code, signal, expected: this.stopping });
      this.child = null;
      this.emit("exit", { code, signal, expected: this.stopping } satisfies TransportExit);
    });
  }

  private onStdout(chunk: Buffer): void {
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
    let nl: number;
    while ((nl = this.rxBuffer.indexOf(0x0a)) >= 0) {
      const line = this.rxBuffer.subarray(0, nl).toString("utf8").trim();
      this.rxBuffer = this.rxBuffer.subarray(nl + 1);
      if (!line) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch (err) {
        logger.warn("app-server 畸形帧已丢弃", { head: line.slice(0, 200) });
        this.emit("frameError", line, err as Error);
        continue;
      }
      this.emit("message", obj);
    }
  }

  /**
   * app-server 默认把 otel/hickory 追踪 span 刷到 stderr（每个请求数十行），
   * 无诊断价值，直接丢弃：tracing enter/exit/close 行 + app_server.request span 上下文行。
   */
  private static readonly STDERR_NOISE =
    /codex_app_server::app_server_tracing|app_server\.request\{.*otel\.kind|hickory_proto|hickory_resolver/;

  private emitStderrLine(raw: string): void {
    const line = maskSecrets(raw);
    if (AppServerTransport.STDERR_NOISE.test(line)) return;
    logger.debug(`[app-server stderr] ${line}`);
    this.emit("stderr", line);
  }

  private onStderr(text: string): void {
    this.stderrBuffer += text;
    let nl: number;
    while ((nl = this.stderrBuffer.indexOf("\n")) >= 0) {
      const line = this.stderrBuffer.slice(0, nl).trim();
      this.stderrBuffer = this.stderrBuffer.slice(nl + 1);
      if (line) this.emitStderrLine(line);
    }
  }

  private flushStderr(): void {
    const tail = this.stderrBuffer.trim();
    this.stderrBuffer = "";
    if (tail) this.emitStderrLine(tail);
  }

  /** 发送一帧 JSON；仅在进程/管道真正不可写时返回 false（背压由流缓冲处理）。 */
  sendJson(obj: unknown): boolean {
    const stdin = this.child?.stdin;
    if (!this.alive || !stdin?.writable) return false;
    try {
      // write 返回 false 只表示超过 highWaterMark（背压），数据仍在内部队列中，
      // 不能据此判定断连——否则高峰期每个请求都会被误报 RpcDisconnectedError。
      stdin.write(JSON.stringify(obj) + "\n", (err) => {
        if (err && this.alive) logger.warn("app-server 写入失败", { error: err.message });
      });
      return this.alive;
    } catch (err) {
      logger.warn("app-server 写入失败", { error: (err as Error).message });
      return false;
    }
  }

  /** 优雅关闭 → 超时后 Windows taskkill /T /F 树清理。 */
  async stop(graceMs = 2000): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    const exitPromise = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      child.stdin?.end();
    } catch {
      /* ignore */
    }
    const timer = setTimeout(() => {
      if (child.pid) this.killTree(child.pid);
    }, graceMs);
    await exitPromise;
    clearTimeout(timer);
    this.child = null;
  }

  private killTree(pid: number): void {
    if (process.platform === "win32") {
      execFile(
        "taskkill",
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true },
        () => {
          /* sandbox-bin 包装器会拉起子进程，必须整树清理 */
        },
      );
      return;
    }
    try {
      childKill(pid);
    } catch {
      /* ignore */
    }
  }
}

function childKill(pid: number): void {
  process.kill(pid, "SIGKILL");
}
