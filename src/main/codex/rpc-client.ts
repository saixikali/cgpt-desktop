/**
 * Codex app-server JSON-RPC 客户端：
 *  - initialize 握手（experimentalApi）
 *  - 数字 id 请求表 + 超时 + 错误归一（RpcError）
 *  - 通知分发（'notification' / `notification:<method>`）
 *  - ServerRequest（审批/elicitation 等）分发：'serverRequest'，
 *    由高层用 respondToServerRequest/respondServerError 回送同 id 响应
 *  - 退出后指数退避自动重连（抖动 + 上限）；首次解析失败 → fatal，
 *    曾连通后暂时找不到二进制则持续自愈
 *  - 断连时拒绝全部在途 Promise，杜绝悬挂
 */
import { EventEmitter } from "node:events";
import { logger } from "../logging.ts";
import { AppServerTransport } from "./app-server-transport.ts";
import { resolveCodex, type CodexResolution } from "./codex-resolver.ts";
import type { InitializeResponse } from "@protocol/InitializeResponse";
import type { ServerNotificationEnvelope } from "@protocol/ServerNotificationEnvelope";
import type { ServerRequest } from "@protocol/ServerRequest";

export type BackendStatus =
  | "idle"
  | "resolving"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "closed"
  | "fatal";

export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export class RpcDisconnectedError extends Error {
  constructor() {
    super("app-server 连接已断开");
    this.name = "RpcDisconnectedError";
  }
}

export class RpcTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`请求超时（${timeoutMs}ms）：${method}`);
    this.name = "RpcTimeoutError";
  }
}

interface PendingCall {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface CodexRpcOptions {
  appVersion: string;
  cwd?: string;
  /** 用户手动指定的 codex 路径（设置页覆盖）。 */
  codexPathOverride?: string;
  /** 默认请求超时；Infinity 表示不限时（如长 turn）。 */
  defaultTimeoutMs?: number;
  /** 注入解析器（测试用）。 */
  resolver?: typeof resolveCodex;
  /** 注入传输层构造（测试用）。 */
  transportFactory?: (resolution: CodexResolution) => AppServerTransport;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

export declare interface CodexRpcClient {
  on(event: "status", listener: (status: BackendStatus, detail?: string) => void): this;
  on(event: "notification", listener: (n: ServerNotificationEnvelope) => void): this;
  on(event: "serverRequest", listener: (req: ServerRequest) => void): this;
  on(event: "initialize", listener: (info: InitializeResponse) => void): this;
}

export class CodexRpcClient extends EventEmitter {
  private status: BackendStatus = "idle";
  private transport: AppServerTransport | null = null;
  private resolution: CodexResolution | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private initializeCount = 0;
  private initResult: InitializeResponse | null = null;
  private readonly options: Required<Omit<CodexRpcOptions, "cwd" | "codexPathOverride">> &
    Pick<CodexRpcOptions, "cwd" | "codexPathOverride">;

  constructor(options: CodexRpcOptions) {
    super();
    this.options = {
      defaultTimeoutMs: 120_000,
      initialDelayMs: BASE_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS,
      resolver: resolveCodex,
      transportFactory: (r) =>
        new AppServerTransport(r.path, { cwd: options.cwd }),
      ...options,
    };
  }

  get currentStatus(): BackendStatus {
    return this.status;
  }

  get serverInfo(): InitializeResponse | null {
    return this.initResult;
  }

  get codex(): CodexResolution | null {
    return this.resolution;
  }

  get initializeHandshakes(): number {
    return this.initializeCount;
  }

  /** 断连后的累计重试次数（ready 后归零），供上层展示 recovery 状态。 */
  get retryCount(): number {
    return this.reconnectAttempts;
  }

  get isReady(): boolean {
    return this.status === "ready";
  }

  async start(): Promise<void> {
    if (this.status !== "idle" && this.status !== "closed") return;
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.failAllPending(new RpcDisconnectedError());
    const t = this.transport;
    this.transport = null;
    if (t) await t.stop();
    this.setStatus("closed");
  }

  /** 用户手动重启（设置页/横幅按钮）。 */
  async restart(): Promise<void> {
    logger.info("rpc: 手动重启");
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const t = this.transport;
    this.transport = null;
    if (t) await t.stop();
    this.failAllPending(new RpcDisconnectedError());
    await this.connect();
  }

  private setStatus(next: BackendStatus, detail?: string, forceEmit = false): void {
    if (this.status === next && !forceEmit) return;
    if (this.status !== next) {
      logger.info("rpc: 状态变更", { from: this.status, to: next, detail });
    }
    this.status = next;
    // 即使状态不变（reconnecting 中重试次数增加）也要推送，
    // 否则上层无法展示累计重试次数/切换 recovery 视图。
    this.emit("status", next, detail);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setStatus(this.reconnectAttempts === 0 ? "resolving" : "reconnecting");

    if (!this.resolution) {
      const { resolution, failures } = await this.options.resolver(
        this.options.codexPathOverride,
      );
      if (!resolution) {
        logger.error("rpc: 未找到可用 codex", {
          failures: failures.map((f) => ({ path: f.candidate.path, reason: f.reason })),
        });
        // 首次启动就找不到 → fatal（引导用户去设置页配置）；
        // 曾经连通过则只是暂时不可见（被杀软隔离/重装/网络盘断开），继续退避自愈。
        if (this.initializeCount === 0) {
          this.setStatus("fatal", "未找到可用的 codex 可执行文件");
          this.failAllPending(new Error("未找到可用的 codex"));
          return;
        }
        this.handleUnexpectedExit();
        return;
      }
      this.resolution = resolution;
      logger.info("rpc: 已解析 codex", resolution);
    }

    this.setStatus(this.reconnectAttempts === 0 ? "connecting" : "reconnecting");
    const transport = this.options.transportFactory(this.resolution);
    this.transport = transport;

    transport.on("message", (obj) => this.onMessage(obj));
    transport.on("spawnError", (err) => {
      logger.error("rpc: spawn 错误", { error: err.message });
      if (/ENOENT|EACCES|EPERM/.test(err.message)) {
        // 路径失效（卸载/权限变化）：清空缓存，下次重连重新解析
        this.resolution = null;
      }
      // spawn 失败只触发 'close' 不触发 'exit'，必须自行调度重连，
      // 否则 codex 暂时不可用（升级/被杀软隔离）时会永久停摆。
      if (this.stopped || this.transport !== transport) return;
      tornDown = true;
      this.handleUnexpectedExit();
    });

    let tornDown = false;
    const onExit = () => {
      tornDown = true;
      if (this.stopped || this.transport !== transport) return;
      this.handleUnexpectedExit();
    };
    transport.on("exit", onExit);

    try {
      transport.start();
    } catch (err) {
      this.resolution = null;
      this.setStatus("fatal", (err as Error).message);
      this.failAllPending(err as Error);
      return;
    }

    try {
      const info = await this.request<InitializeResponse>(
        "initialize",
        {
          clientInfo: {
            name: "cgpt-desktop",
            title: "Cgpt Desktop",
            version: this.options.appVersion,
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
          },
        },
        { timeoutMs: 20_000, internal: true },
      );
      this.initResult = info;
      this.initializeCount += 1;
      this.reconnectAttempts = 0;
      this.setStatus("ready");
      this.emit("initialize", info);
      logger.info("rpc: initialize 完成", {
        codexHome: info.codexHome,
        platform: info.platformOs,
        userAgent: info.userAgent,
      });
    } catch (err) {
      logger.error("rpc: initialize 失败", { error: (err as Error).message });
      if (!tornDown) {
        // 进程仍在但握手失败/超时：先拆掉旧传输层，再进入退避重连
        this.transport = null;
        await transport.stop();
        this.handleUnexpectedExit();
      }
      // 若退出事件已处理（tornDown=true），exit 回调里已调度重连，避免重复。
    }
  }

  private handleUnexpectedExit(): void {
    this.failAllPending(new RpcDisconnectedError());
    if (this.stopped) return;
    this.reconnectAttempts += 1;
    const expo = Math.min(
      this.options.maxDelayMs,
      this.options.initialDelayMs * 2 ** Math.min(this.reconnectAttempts - 1, 8),
    );
    const jitter = Math.random() * this.options.initialDelayMs;
    const delay = Math.round(expo + jitter);
    this.setStatus("reconnecting", `第 ${this.reconnectAttempts} 次重试，${delay}ms 后连接`, true);
    logger.warn("rpc: 连接断开，计划重连", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onMessage(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as Record<string, unknown>;

    // JSON-RPC response（对我方请求的应答）
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const id = msg.id;
      if (typeof id === "number" && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        if (p.timer) clearTimeout(p.timer);
        if (msg.error && typeof msg.error === "object") {
          const e = msg.error as Record<string, unknown>;
          p.reject(
            new RpcError(
              typeof e.code === "number" ? e.code : -32000,
              typeof e.message === "string" ? e.message : "未知 JSON-RPC 错误",
              e.data,
            ),
          );
        } else {
          p.resolve(msg.result);
        }
      } else {
        logger.warn("rpc: 收到无法匹配 id 的响应", { id });
      }
      return;
    }

    if (msg.method !== undefined && typeof msg.method === "string") {
      if ("id" in msg && msg.id !== undefined && msg.id !== null) {
        // ServerRequest（审批 / elicitation / 用户输入等）
        this.emit("serverRequest", msg as unknown as ServerRequest);
      } else {
        // 服务端通知
        this.emit("notification", msg as unknown as ServerNotificationEnvelope);
        this.emit(`notification:${msg.method}`, msg.params);
      }
    }
  }

  request<T>(
    method: string,
    params?: unknown,
    opts: { timeoutMs?: number; internal?: boolean } = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? this.options.defaultTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      if (!this.transport) {
        reject(new RpcDisconnectedError());
        return;
      }
      const id = this.nextId++;
      const pending: PendingCall = {
        method,
        resolve: resolve as (v: unknown) => void,
        reject,
        timer:
          Number.isFinite(timeoutMs) && (timeoutMs as number) > 0
            ? setTimeout(() => {
                if (this.pending.delete(id)) {
                  reject(new RpcTimeoutError(method, timeoutMs as number));
                }
              }, timeoutMs as number)
            : null,
      };
      this.pending.set(id, pending);
      const ok = this.transport.sendJson({ jsonrpc: "2.0", id, method, params });
      if (!ok) {
        if (pending.timer) clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(new RpcDisconnectedError());
        return;
      }
      if (!opts.internal) {
        logger.debug("rpc →", { id, method });
      }
    });
  }

  /** 对服务端 ServerRequest 回送成功结果。返回是否已写入传输层。 */
  respondToServerRequest(id: ServerRequest["id"], result: unknown): boolean {
    const ok = this.transport?.sendJson({ jsonrpc: "2.0", id, result }) ?? false;
    if (!ok) logger.warn("rpc: ServerRequest 响应发送失败", { id });
    return ok;
  }

  /** 对服务端 ServerRequest 回送错误。返回是否已写入传输层。 */
  respondServerError(
    id: ServerRequest["id"],
    code: number,
    message: string,
    data?: unknown,
  ): boolean {
    const ok =
      this.transport?.sendJson({ jsonrpc: "2.0", id, error: { code, message, data } }) ?? false;
    if (!ok) logger.warn("rpc: ServerRequest 错误响应发送失败", { id, code });
    return ok;
  }
}
