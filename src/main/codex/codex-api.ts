/**
 * CodexApi：在 CodexRpcClient 之上的类型化高层封装。
 *  - 方法签名直接引用 protocol/generated 的 Params/Response 类型（协议为唯一事实源）
 *  - 统一错误归一：方法不存在/被禁用时标记 unavailable 并抛 MethodUnavailableError
 *  - 组合 ApprovalRegistry（审批登记中心）与 NotificationHub（通知订阅）
 */
import { logger } from "../logging.ts";
import { ApprovalRegistry } from "./approvals.ts";
import { NotificationHub } from "./notifications.ts";
import { RpcError, type CodexRpcClient } from "./rpc-client.ts";

import type { GetAuthStatusParams } from "@protocol/GetAuthStatusParams";
import type { GetAuthStatusResponse } from "@protocol/GetAuthStatusResponse";
import type {
  ConfigReadParams,
  ConfigReadResponse,
  ConfigRequirementsReadResponse,
  ConfigValueWriteParams,
  ConfigWriteResponse,
  ConfigBatchWriteParams,
  FsGetMetadataParams,
  FsGetMetadataResponse,
  FsReadDirectoryParams,
  FsReadDirectoryResponse,
  FsReadFileParams,
  FsReadFileResponse,
  ListMcpServerStatusParams,
  ListMcpServerStatusResponse,
  McpResourceReadParams,
  McpResourceReadResponse,
  McpServerToolCallParams,
  McpServerToolCallResponse,
  ModelListParams,
  ModelListResponse,
  PermissionProfileListParams,
  PermissionProfileListResponse,
  ProcessKillParams,
  ProcessKillResponse,
  ProcessResizePtyParams,
  ProcessResizePtyResponse,
  ProcessSpawnParams,
  ProcessSpawnResponse,
  ProcessWriteStdinParams,
  ProcessWriteStdinResponse,
  ProjectCreateParams,
  ProjectCreateResponse,
  ProjectDeleteParams,
  ProjectDeleteResponse,
  ProjectImportParams,
  ProjectImportResponse,
  ProjectListParams,
  ProjectListResponse,
  ProjectMoveParams,
  ProjectMoveResponse,
  ProjectReadParams,
  ProjectReadResponse,
  ProjectUpdateParams,
  ProjectUpdateResponse,
  ServerDiagnosticsParams,
  ServerDiagnosticsResponse,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadDeleteParams,
  ThreadDeleteResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadItemsListParams,
  ThreadItemsListResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadSearchParams,
  ThreadSearchResponse,
  ThreadSetNameParams,
  ThreadSettingsUpdateParams,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  ThreadTimelineListParams,
  ThreadTimelineListResponse,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  TurnInterruptParams,
  TurnSettingsUpdateParams,
  TurnSettingsUpdateResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
  GetAccountParams,
  GetAccountResponse,
  LoginAccountParams,
  LoginAccountResponse,
} from "@protocol/v2/index";

export class MethodUnavailableError extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`当前 codex 版本不支持该方法：${method}`);
    this.name = "MethodUnavailableError";
    this.method = method;
  }
}

const METHOD_MISSING_RE = /-32601|method\s+(?:not\s+found|unavailable|unknown)|unknown\s+method/i;

function isMethodMissing(err: unknown): boolean {
  return err instanceof RpcError && METHOD_MISSING_RE.test(`${err.code} ${err.message}`);
}

export class CodexApi {
  readonly approvals: ApprovalRegistry;
  readonly notifications: NotificationHub;
  readonly rpc: CodexRpcClient;
  private readonly unavailableMethods = new Set<string>();

  constructor(rpc: CodexRpcClient) {
    this.rpc = rpc;
    this.approvals = new ApprovalRegistry(rpc);
    this.notifications = new NotificationHub(rpc);
  }

  /** 释放审批登记与通知订阅（客户端重建前必须调用，防止旧监听器/TTL 定时器泄漏）。 */
  dispose(): void {
    this.approvals.dispose();
    this.notifications.dispose();
  }

  private async call<R>(
    method: string,
    params?: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<R> {
    if (this.unavailableMethods.has(method)) throw new MethodUnavailableError(method);
    try {
      return await this.rpc.request<R>(method, params, opts);
    } catch (err) {
      if (isMethodMissing(err)) {
        this.unavailableMethods.add(method);
        logger.warn("方法被标记为不可用", { method });
        throw new MethodUnavailableError(method);
      }
      throw err;
    }
  }

  isMethodAvailable(method: string): boolean {
    return !this.unavailableMethods.has(method);
  }

  get unavailable(): readonly string[] {
    return [...this.unavailableMethods];
  }

  // ---------- 鉴权 / 账号 ----------
  // 默认不取 token（安全基线 AC-13），需要账号展示时由调用方显式开启。
  getAuthStatus(
    params: GetAuthStatusParams = { includeToken: false, refreshToken: false },
  ): Promise<GetAuthStatusResponse> {
    return this.call("getAuthStatus", params);
  }
  getAccount(params: GetAccountParams): Promise<GetAccountResponse> {
    return this.call("account/read", params);
  }
  loginAccount(params: LoginAccountParams): Promise<LoginAccountResponse> {
    return this.call("account/login/start", params);
  }
  logout(): Promise<unknown> {
    return this.call("account/logout", undefined);
  }

  // ---------- 模型 / 权限 / 配置 ----------
  listModels(params: ModelListParams = {}): Promise<ModelListResponse> {
    return this.call("model/list", params);
  }
  listPermissionProfiles(
    params: PermissionProfileListParams = {},
  ): Promise<PermissionProfileListResponse> {
    return this.call("permissionProfile/list", params);
  }
  configRequirements(): Promise<ConfigRequirementsReadResponse> {
    return this.call("configRequirements/read", undefined);
  }
  readConfig(params: ConfigReadParams): Promise<ConfigReadResponse> {
    return this.call("config/read", params);
  }
  writeConfigValue(params: ConfigValueWriteParams): Promise<ConfigWriteResponse> {
    return this.call("config/value/write", params);
  }
  batchWriteConfig(params: ConfigBatchWriteParams): Promise<ConfigWriteResponse> {
    return this.call("config/batchWrite", params);
  }

  // ---------- MCP ----------
  listMcpStatus(
    params: ListMcpServerStatusParams = {},
  ): Promise<ListMcpServerStatusResponse> {
    return this.call("mcpServerStatus/list", params);
  }
  reloadMcpConfig(): Promise<unknown> {
    return this.call("config/mcpServer/reload", undefined);
  }
  readMcpResource(params: McpResourceReadParams): Promise<McpResourceReadResponse> {
    return this.call("mcpServer/resource/read", params);
  }
  callMcpTool(params: McpServerToolCallParams): Promise<McpServerToolCallResponse> {
    return this.call("mcpServer/tool/call", params);
  }

  // ---------- 项目 ----------
  listProjects(params: ProjectListParams = {}): Promise<ProjectListResponse> {
    return this.call("project/list", params);
  }
  readProject(params: ProjectReadParams): Promise<ProjectReadResponse> {
    return this.call("project/read", params);
  }
  createProject(params: ProjectCreateParams): Promise<ProjectCreateResponse> {
    return this.call("project/create", params);
  }
  updateProject(params: ProjectUpdateParams): Promise<ProjectUpdateResponse> {
    return this.call("project/update", params);
  }
  deleteProject(params: ProjectDeleteParams): Promise<ProjectDeleteResponse> {
    return this.call("project/delete", params);
  }
  importProject(params: ProjectImportParams): Promise<ProjectImportResponse> {
    return this.call("project/import", params);
  }
  moveProject(params: ProjectMoveParams): Promise<ProjectMoveResponse> {
    return this.call("project/move", params);
  }

  // ---------- 会话 ----------
  listThreads(params: ThreadListParams): Promise<ThreadListResponse> {
    return this.call("thread/list", params);
  }
  readThread(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return this.call("thread/read", params);
  }
  startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return this.call("thread/start", params);
  }
  resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.call("thread/resume", params);
  }
  forkThread(params: ThreadForkParams): Promise<ThreadForkResponse> {
    return this.call("thread/fork", params);
  }
  archiveThread(params: ThreadArchiveParams): Promise<ThreadArchiveResponse> {
    return this.call("thread/archive", params);
  }
  unarchiveThread(params: ThreadUnarchiveParams): Promise<ThreadUnarchiveResponse> {
    return this.call("thread/unarchive", params);
  }
  deleteThread(params: ThreadDeleteParams): Promise<ThreadDeleteResponse> {
    return this.call("thread/delete", params);
  }
  listTurns(params: ThreadTurnsListParams): Promise<ThreadTurnsListResponse> {
    return this.call("thread/turns/list", params);
  }
  listItems(params: ThreadItemsListParams): Promise<ThreadItemsListResponse> {
    return this.call("thread/items/list", params);
  }
  listTimeline(params: ThreadTimelineListParams): Promise<ThreadTimelineListResponse> {
    return this.call("thread/timeline/list", params);
  }
  searchThreads(params: ThreadSearchParams): Promise<ThreadSearchResponse> {
    return this.call("thread/search", params);
  }
  setThreadName(params: ThreadSetNameParams): Promise<unknown> {
    return this.call("thread/name/set", params);
  }
  updateThreadSettings(params: ThreadSettingsUpdateParams): Promise<unknown> {
    return this.call("thread/settings/update", params);
  }

  // ---------- turn ----------
  /** turn/start 随流式通知完成而返回，不设客户端超时。 */
  startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.call("turn/start", params, { timeoutMs: Infinity });
  }
  steerTurn(params: TurnSteerParams): Promise<TurnSteerResponse> {
    return this.call("turn/steer", params);
  }
  interruptTurn(params: TurnInterruptParams): Promise<unknown> {
    return this.call("turn/interrupt", params);
  }
  updateTurnSettings(params: TurnSettingsUpdateParams): Promise<TurnSettingsUpdateResponse> {
    return this.call("turn/settings/update", params);
  }

  // ---------- 文件（IPC 层须再做 roots 越权校验） ----------
  fsReadFile(params: FsReadFileParams): Promise<FsReadFileResponse> {
    return this.call("fs/readFile", params);
  }
  fsReadDirectory(params: FsReadDirectoryParams): Promise<FsReadDirectoryResponse> {
    return this.call("fs/readDirectory", params);
  }
  fsGetMetadata(params: FsGetMetadataParams): Promise<FsGetMetadataResponse> {
    return this.call("fs/getMetadata", params);
  }

  // ---------- PTY 子进程 ----------
  processSpawn(params: ProcessSpawnParams): Promise<ProcessSpawnResponse> {
    return this.call("process/spawn", params);
  }
  processWriteStdin(params: ProcessWriteStdinParams): Promise<ProcessWriteStdinResponse> {
    return this.call("process/writeStdin", params);
  }
  processResizePty(params: ProcessResizePtyParams): Promise<ProcessResizePtyResponse> {
    return this.call("process/resizePty", params);
  }
  processKill(params: ProcessKillParams): Promise<ProcessKillResponse> {
    return this.call("process/kill", params);
  }

  // ---------- 诊断 ----------
  diagnostics(params: ServerDiagnosticsParams = {}): Promise<ServerDiagnosticsResponse> {
    return this.call("server/diagnostics", params);
  }
}
