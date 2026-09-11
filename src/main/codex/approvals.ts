/**
 * ServerRequest（审批/elicitation/用户输入）登记中心：
 *  - 订阅 rpc 的 'serverRequest'，生成带本地 id 的 PendingApproval
 *  - 监听 'serverRequest/resolved' 通知自动核销
 *  - TTL 过期标记（仅客户端状态，不代表服务端决定）
 *  - 类型化决议方法，按协议响应结构构造 result 并回送同 id JSON-RPC response
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { logger } from "../logging.ts";
import type { CodexRpcClient } from "./rpc-client.ts";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { ServerNotificationEnvelope } from "@protocol/ServerNotificationEnvelope";
import type { CommandExecutionApprovalDecision } from "@protocol/v2/CommandExecutionApprovalDecision";
import type { FileChangeApprovalDecision } from "@protocol/v2/FileChangeApprovalDecision";
import type { McpServerElicitationAction } from "@protocol/v2/McpServerElicitationAction";
import type { ToolRequestUserInputAnswer } from "@protocol/v2/ToolRequestUserInputAnswer";

export type ApprovalStatus = "pending" | "resolved" | "expired";

export interface PendingApproval {
  localId: string;
  serverId: ServerRequest["id"];
  method: ServerRequest["method"];
  params: unknown;
  threadId?: string;
  receivedAt: number;
  status: ApprovalStatus;
}

export declare interface ApprovalRegistry {
  on(event: "pending", listener: (approval: PendingApproval) => void): this;
  on(event: "resolved", listener: (approval: PendingApproval) => void): this;
}

const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * 无需用户交互的 serverRequest 在登记处直接自动应答，
 * 避免 codex 等待超时（这些都依赖桌面端不存在的托管能力）。
 */
const AUTO_METHODS: Record<string, () => { ok: true; result: unknown } | { ok: false; code: number; message: string }> = {
  "currentTime/read": () => ({ ok: true, result: { currentTimeAt: Math.floor(Date.now() / 1000) } }),
  "attestation/generate": () => ({ ok: false, code: -32601, message: "桌面端不支持 attestation 生成" }),
  "account/chatgptAuthTokens/refresh": () => ({
    ok: false,
    code: -32000,
    message: "桌面端不托管 ChatGPT 令牌刷新，请使用 codex CLI 重新登录",
  }),
  "item/tool/call": () => ({ ok: false, code: -32601, message: "动态工具未在桌面端注册" }),
};

export class ApprovalRegistry extends EventEmitter {
  private readonly byLocal = new Map<string, PendingApproval>();
  private readonly localByServer = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;
  private readonly rpc: CodexRpcClient;
  private readonly ttlMs: number;
  private readonly onServerRequest: (req: ServerRequest) => void;
  private readonly onNotification: (n: ServerNotificationEnvelope) => void;

  constructor(rpc: CodexRpcClient, ttlMs: number = DEFAULT_TTL_MS) {
    super();
    this.rpc = rpc;
    this.ttlMs = ttlMs;
    this.onServerRequest = (req) => this.register(req);
    this.onNotification = (n) => {
      if (n.method === "serverRequest/resolved") {
        const p = n.params as { requestId?: ServerRequest["id"] };
        if (p.requestId !== undefined) this.markServerResolved(p.requestId);
      }
    };
    rpc.on("serverRequest", this.onServerRequest);
    rpc.on("notification", this.onNotification);
  }

  private static serverKey(id: ServerRequest["id"]): string {
    return `${typeof id}:${String(id)}`;
  }

  private register(req: ServerRequest): void {
    // 非交互请求直接自动应答，不进入待办队列。
    const auto = AUTO_METHODS[req.method];
    if (auto) {
      const r = auto();
      if (r.ok) this.rpc.respondToServerRequest(req.id, r.result);
      else this.rpc.respondServerError(req.id, r.code, r.message);
      logger.debug("serverRequest 自动应答", { method: req.method, ok: r.ok });
      return;
    }
    const params = (req as { params?: unknown }).params;
    const threadId =
      params && typeof params === "object" && "threadId" in params
        ? ((params as { threadId?: unknown }).threadId as string | undefined)
        : undefined;
    const approval: PendingApproval = {
      localId: randomUUID(),
      serverId: req.id,
      method: req.method,
      params,
      threadId,
      receivedAt: Date.now(),
      status: "pending",
    };
    this.byLocal.set(approval.localId, approval);
    this.localByServer.set(ApprovalRegistry.serverKey(req.id), approval.localId);
    const timer = setTimeout(() => this.expire(approval.localId), this.ttlMs);
    timer.unref?.();
    this.timers.set(approval.localId, timer);
    logger.info("审批请求登记", {
      localId: approval.localId,
      method: approval.method,
      threadId,
    });
    this.emit("pending", approval);
  }

  private settle(localId: string): PendingApproval | null {
    const approval = this.byLocal.get(localId);
    if (!approval) return null;
    const timer = this.timers.get(localId);
    if (timer) clearTimeout(timer);
    this.timers.delete(localId);
    return approval;
  }

  private markServerResolved(serverId: ServerRequest["id"]): void {
    const localId = this.localByServer.get(ApprovalRegistry.serverKey(serverId));
    if (!localId) return;
    const approval = this.settle(localId);
    if (!approval || approval.status !== "pending") return;
    approval.status = "resolved";
    this.cleanup(localId, serverId);
    logger.info("审批由服务端通知核销", { localId });
    this.emit("resolved", approval);
  }

  private expire(localId: string): void {
    const approval = this.byLocal.get(localId);
    if (!approval || approval.status !== "pending") return;
    approval.status = "expired";
    this.cleanup(localId, approval.serverId);
    logger.warn("审批请求超时未决", { localId, method: approval.method });
    this.emit("resolved", approval);
  }

  private cleanup(localId: string, serverId: ServerRequest["id"]): void {
    this.localByServer.delete(ApprovalRegistry.serverKey(serverId));
    this.byLocal.delete(localId);
    this.timers.delete(localId);
  }

  list(): PendingApproval[] {
    return [...this.byLocal.values()].filter((a) => a.status === "pending");
  }

  get(localId: string): PendingApproval | undefined {
    return this.byLocal.get(localId);
  }

  /**
   * 通用决议：先发送，确认写入传输层后再核销。
   * localId 不存在/已结案则抛错；连接不可写时保留挂起态（TTL 继续计时），
   * 卡片不消失，用户可重试，杜绝"点了但响应丢失"。
   */
  respond(localId: string, result: unknown): void {
    const approval = this.byLocal.get(localId);
    if (!approval) throw new Error(`审批不存在或已结案：${localId}`);
    const ok = this.rpc.respondToServerRequest(approval.serverId, result);
    if (!ok) {
      logger.warn("审批决议发送失败，保留挂起态", { localId, method: approval.method });
      throw new Error("后端连接不可写，决议未送达，请重试");
    }
    this.settle(localId);
    approval.status = "resolved";
    this.cleanup(localId, approval.serverId);
    logger.info("审批决议已发送", { localId, method: approval.method });
    this.emit("resolved", approval);
  }

  respondError(localId: string, code: number, message: string, data?: unknown): void {
    const approval = this.byLocal.get(localId);
    if (!approval) throw new Error(`审批不存在或已结案：${localId}`);
    const ok = this.rpc.respondServerError(approval.serverId, code, message, data);
    if (!ok) {
      logger.warn("审批错误决议发送失败，保留挂起态", { localId, code });
      throw new Error("后端连接不可写，决议未送达，请重试");
    }
    this.settle(localId);
    approval.status = "resolved";
    this.cleanup(localId, approval.serverId);
    this.emit("resolved", approval);
  }

  /** item/commandExecution/requestApproval → { decision }，可携带 amendment 对象。 */
  resolveCommand(
    localId: string,
    decision: CommandExecutionApprovalDecision,
  ): void {
    this.respond(localId, { decision });
  }

  /** item/fileChange/requestApproval → { decision } */
  resolveFileChange(localId: string, decision: FileChangeApprovalDecision): void {
    this.respond(localId, { decision });
  }

  /** mcpServer/elicitation/request → { action, content, _meta } */
  resolveElicitation(
    localId: string,
    action: McpServerElicitationAction,
    content: unknown = null,
  ): void {
    this.respond(localId, { action, content, _meta: null });
  }

  /** item/tool/requestUserInput → { answers: {questionId: answer} } */
  resolveUserInput(
    localId: string,
    answers: Record<string, ToolRequestUserInputAnswer>,
  ): void {
    this.respond(localId, { answers });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rpc.off("serverRequest", this.onServerRequest);
    this.rpc.off("notification", this.onNotification);
    for (const [, t] of this.timers) clearTimeout(t);
    this.timers.clear();
    this.byLocal.clear();
    this.localByServer.clear();
    this.removeAllListeners();
  }
}
