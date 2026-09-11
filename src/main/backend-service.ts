/**
 * BackendService：主进程内唯一的 codex app-server 拥有者。
 *  - 初始化日志、创建 CodexRpcClient + CodexApi
 *  - 状态/通知/审批事件向 IPC 层转发
 *  - restart() 供横幅"重启后端"使用
 */
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { App } from "electron";
import { logger } from "./logging.ts";
import { CodexApi, MethodUnavailableError } from "./codex/codex-api.ts";
import { CodexRpcClient } from "./codex/rpc-client.ts";
import type { AppSettings } from "./app-settings.ts";
import type { PendingApproval } from "./codex/approvals.ts";
import type { ServerNotificationEnvelope } from "@protocol/ServerNotificationEnvelope";
import type { BackendStatusSnapshot } from "../shared/ipc/contract.ts";

export class BackendNotReadyError extends Error {
  constructor() {
    super("后端尚未就绪，请稍候或点击重启后端");
    this.name = "BackendNotReadyError";
  }
}

export { MethodUnavailableError };

export declare interface BackendService {
  on(event: "status", listener: (snapshot: BackendStatusSnapshot) => void): this;
  on(event: "notification", listener: (envelope: ServerNotificationEnvelope) => void): this;
  on(event: "approval", listener: (approval: PendingApproval) => void): this;
}

export class BackendService extends EventEmitter {
  private client: CodexRpcClient | null = null;
  private _api: CodexApi | null = null;
  private snapshot: BackendStatusSnapshot = {
    state: "idle",
    codex: null,
    serverInfo: null,
    fatalMessage: null,
  };

  constructor(
    private readonly app: App,
    private readonly settings: AppSettings,
    private readonly appVersion: string,
  ) {
    super();
  }

  async init(): Promise<void> {
    const level = process.env["CGPT_LOG_LEVEL"] === "debug" ? "debug" : "info";
    logger.init(join(this.app.getPath("userData"), "logs"), level);
    logger.info("Cgpt Desktop 启动", { version: this.appVersion });
    this.createClient();
    await this.client!.start();
  }

  private createClient(): void {
    const override = this.settings.get().codexPathOverride ?? undefined;
    const client = new CodexRpcClient({
      appVersion: this.appVersion,
      cwd: this.app.getPath("home"),
      codexPathOverride: override,
    });
    const api = new CodexApi(client);

    client.on("status", (state: BackendStatusSnapshot["state"], detail?: unknown) => {
      const codex = client.codex;
      this.snapshot = {
        state,
        codex: codex ? { path: codex.path, version: codex.version, source: codex.source } : null,
        serverInfo: client.serverInfo
          ? { userAgent: client.serverInfo.userAgent, platformOs: client.serverInfo.platformOs }
          : null,
        fatalMessage:
          state === "fatal"
            ? typeof detail === "string"
              ? detail
              : detail instanceof Error
                ? detail.message
                : null
            : null,
        reconnectAttempts: client.retryCount,
      };
      this.emit("status", this.getStatus());
    });

    api.notifications.onAny((envelope) => this.emit("notification", envelope));
    api.approvals.on("pending", (a) => this.emit("approval", a));
    api.approvals.on("resolved", (a) => this.emit("approval", a));

    this.client = client;
    this._api = api;
  }

  getStatus(): BackendStatusSnapshot {
    return { ...this.snapshot, codex: this.snapshot.codex ? { ...this.snapshot.codex } : null };
  }

  /** ready 时返回 API；否则抛 BackendNotReadyError。 */
  api(): CodexApi {
    if (!this._api || !this.client?.isReady) throw new BackendNotReadyError();
    return this._api;
  }

  get apiOrNull(): CodexApi | null {
    return this._api;
  }

  async stop(): Promise<void> {
    if (this.client) await this.client.stop();
  }

  async restart(reason?: string): Promise<void> {
    logger.warn("请求重启后端", { reason: reason ?? null });
    if (!this.client) {
      this.createClient();
      await this.client!.start();
      return;
    }
    await this.client.restart();
  }

  /** codex 路径覆盖变更后重建客户端（重新解析并连接）。 */
  async reloadClient(reason?: string): Promise<void> {
    logger.warn("重建后端客户端", { reason: reason ?? null });
    if (this.client) {
      // 先释放旧 API 挂载在旧 client 上的审批/通知监听与 TTL 定时器，
      // 否则每次重建都会泄漏一个 ApprovalRegistry（G-11）。
      this._api?.dispose();
      await this.client.stop();
    }
    this.createClient();
    await this.client!.start();
  }
}
