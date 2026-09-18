/**
 * ConversationBackend：会话主轴的后端无关抽象。
 *  - 覆盖 threads / turns / approvals 与事件推送（notification / approval）
 *  - fs、PTY、项目、配置、MCP 等非对话能力不在此抽象，仍由 Codex 网关独占提供
 *  - 事件统一使用 Codex 通知信封形状（{ method, params }），渲染层零改动复用
 */
import { EventEmitter } from "node:events";
import type { PendingApproval } from "../codex/approvals.ts";

export type BackendId = "codex" | "claude";

export interface ConversationApprovals {
  list(): PendingApproval[];
  resolveCommand(localId: string, decision: unknown): Promise<void>;
  resolveFileChange(localId: string, decision: unknown): Promise<void>;
  resolveElicitation(localId: string, action: unknown, content: unknown): Promise<void>;
  resolveUserInput(localId: string, answers: unknown): Promise<void>;
  respondError(localId: string, code: number, message: string, data?: unknown): Promise<void>;
}

export declare interface ConversationBackend {
  /** 规范化后的通知信封（形状同 Codex ServerNotificationEnvelope 的相关子集）。 */
  on(event: "notification", listener: (envelope: Record<string, unknown>) => void): this;
  on(event: "approval", listener: (approval: PendingApproval) => void): this;
}

export interface ConversationBackend extends EventEmitter {
  readonly id: BackendId;
  /** 该 threadId 是否由此后端承载（路由判定）。 */
  owns(threadId: string): boolean;
  /** 该 localId 的待审批是否属于此后端。 */
  ownsApproval(localId: string): boolean;

  listThreads(params: unknown): Promise<unknown>;
  readThread(params: { threadId: string }): Promise<unknown>;
  startThread(params: Record<string, unknown>): Promise<unknown>;
  resumeThread(params: { threadId: string } & Record<string, unknown>): Promise<unknown>;
  archiveThread(params: { threadId: string }): Promise<unknown>;
  unarchiveThread(params: { threadId: string }): Promise<unknown>;
  deleteThread(params: { threadId: string }): Promise<unknown>;
  setThreadName(params: Record<string, unknown>): Promise<unknown>;
  listTurns(params: { threadId: string; limit?: number; cursor?: string | null }): Promise<unknown>;
  searchThreads(params: Record<string, unknown>): Promise<unknown>;

  startTurn(params: Record<string, unknown>): Promise<unknown>;
  steerTurn(params: Record<string, unknown>): Promise<unknown>;
  interruptTurn(params: { threadId: string }): Promise<unknown>;

  readonly approvals: ConversationApprovals;

  /** 停止全部会话进程并释放资源（应用退出前调用）。 */
  dispose(): void;
}
