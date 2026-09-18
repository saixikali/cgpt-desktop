/**
 * CodexBackend：现有 codex app-server 网关（CodexApi）的 ConversationBackend 委托实现。
 *  - 纯转发，零行为变化；审批仍由 CodexApi.approvals（ApprovalRegistry）闭合
 *  - 事件不在此重发：BackendService → index.ts 的既有订阅继续负责广播，
 *    避免与 ClaudeBackend 的接线叠加造成渲染层重复消费
 *  - owns() 恒真：路由时先问 ClaudeBackend，其余线程都落回这里
 */
import { EventEmitter } from "node:events";
import type { BackendService } from "../backend-service.ts";
import type { PendingApproval } from "../codex/approvals.ts";
import type { ConversationApprovals, ConversationBackend } from "./conversation-backend.ts";

export class CodexBackend extends EventEmitter implements ConversationBackend {
  readonly id = "codex" as const;

  constructor(private readonly backend: BackendService) {
    super();
  }

  private api() {
    return this.backend.api();
  }

  owns(_threadId: string): boolean {
    return true;
  }

  ownsApproval(localId: string): boolean {
    try {
      return this.api().approvals.list().some((a) => a.localId === localId);
    } catch {
      return false;
    }
  }

  listThreads(params: unknown): Promise<unknown> {
    return this.api().listThreads((params ?? {}) as never);
  }
  readThread(params: { threadId: string }): Promise<unknown> {
    return this.api().readThread(params as never);
  }
  startThread(params: Record<string, unknown>): Promise<unknown> {
    return this.api().startThread(params as never);
  }
  resumeThread(params: { threadId: string } & Record<string, unknown>): Promise<unknown> {
    return this.api().resumeThread(params as never);
  }
  archiveThread(params: { threadId: string }): Promise<unknown> {
    return this.api().archiveThread(params as never);
  }
  unarchiveThread(params: { threadId: string }): Promise<unknown> {
    return this.api().unarchiveThread(params as never);
  }
  deleteThread(params: { threadId: string }): Promise<unknown> {
    return this.api().deleteThread(params as never);
  }
  setThreadName(params: Record<string, unknown>): Promise<unknown> {
    return this.api().setThreadName(params as never);
  }
  listTurns(params: { threadId: string; limit?: number; cursor?: string | null }): Promise<unknown> {
    return this.api().listTurns(params as never);
  }
  searchThreads(params: Record<string, unknown>): Promise<unknown> {
    return this.api().searchThreads(params as never);
  }
  startTurn(params: Record<string, unknown>): Promise<unknown> {
    return this.api().startTurn(params as never);
  }
  steerTurn(params: Record<string, unknown>): Promise<unknown> {
    return this.api().steerTurn(params as never);
  }
  interruptTurn(params: { threadId: string }): Promise<unknown> {
    return this.api().interruptTurn(params as never);
  }

  get approvals(): ConversationApprovals {
    const reg = this.api().approvals;
    return {
      list: () => reg.list(),
      // ApprovalRegistry 的 resolve 为同步接口，这里统一归一为 Promise。
      resolveCommand: async (localId, decision) => reg.resolveCommand(localId, decision as never),
      resolveFileChange: async (localId, decision) =>
        reg.resolveFileChange(localId, decision as never),
      resolveElicitation: async (localId, action, content) =>
        reg.resolveElicitation(localId, action as never, content as never),
      resolveUserInput: async (localId, answers) => reg.resolveUserInput(localId, answers as never),
      respondError: async (localId, code, message, data) =>
        reg.respondError(localId, code, message, data),
    };
  }

  dispose(): void {
    /* codex 生命周期由 BackendService 管理（restart/reloadClient），此处无资源。 */
  }
}

export type { PendingApproval };
