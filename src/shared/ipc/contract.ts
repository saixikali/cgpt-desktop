/**
 * IPC 单一事实契约：
 *  - CHANNELS：所有 invoke 通道与推送事件名（主/渲染/preload 共用，禁止散落字符串）
 *  - INPUTS：每个 invoke 通道的 zod 入参 schema（已知键强校验，未知键透传给 codex）
 * 渲染端 window.cgpt 的类型见本文件末尾 CgptBridge。
 */
import { z } from "zod";

export { CHANNELS, EVENTS, type PushEventName } from "./channels.ts";
import { CHANNELS } from "./channels.ts";

const voidInput = z.object({}).strict().optional();
const cursorPage = z
  .object({
    limit: z.number().int().positive().max(200).optional(),
    cursor: z.string().min(1).nullable().optional(),
  })
  .passthrough();

const threadId = z
  .object({ threadId: z.string().min(1) })
  .passthrough();

export const INPUTS = {
  [CHANNELS.app.version]: voidInput,
  [CHANNELS.app.windowControl]: z
    .object({ action: z.enum(["minimize", "toggleMaximize", "close"]) })
    .strict(),
  [CHANNELS.app.pickDirectory]: z
    .object({ defaultPath: z.string().min(1).optional() })
    .strict()
    .optional(),
  [CHANNELS.app.pickFile]: z
    .object({
      defaultPath: z.string().min(1).optional(),
      title: z.string().max(100).optional(),
      filters: z
        .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
        .optional(),
    })
    .strict()
    .optional(),
  [CHANNELS.app.showItem]: z.object({ path: z.string().min(1) }).strict(),
  [CHANNELS.app.openExternal]: z
    .object({ url: z.string().url().refine((u) => /^https?:\/\//i.test(u), "仅允许 http/https 链接") })
    .strict(),
  [CHANNELS.app.openLogsDir]: voidInput,

  [CHANNELS.backend.status]: voidInput,
  [CHANNELS.backend.restart]: z.object({ reason: z.string().max(200).optional() }).strict().optional(),
  [CHANNELS.backend.wizardGet]: voidInput,
  [CHANNELS.backend.wizardComplete]: z
    .object({ projectPath: z.string().min(1), title: z.string().max(200).optional() })
    .strict(),
  [CHANNELS.backend.setCodexOverride]: z
    .object({ path: z.string().min(1).nullable() })
    .strict(),
  [CHANNELS.backend.setActiveProject]: z
    .object({ projectId: z.string().min(1).nullable() })
    .strict(),

  [CHANNELS.projects.list]: cursorPage.optional(),
  [CHANNELS.projects.read]: z.object({ projectId: z.string().min(1) }).passthrough(),
  [CHANNELS.projects.create]: z
    .object({
      name: z.string().max(200).optional(),
      roots: z.array(z.object({ path: z.string().min(1) }).passthrough()).optional(),
    })
    .passthrough(),
  [CHANNELS.projects.update]: z.object({ projectId: z.string().min(1) }).passthrough(),
  [CHANNELS.projects.remove]: z.object({ projectId: z.string().min(1) }).passthrough(),
  [CHANNELS.projects.import]: z.object({ path: z.string().min(1) }).passthrough(),
  [CHANNELS.projects.move]: z
    .object({ projectId: z.string().min(1), toProjectId: z.string().min(1).optional() })
    .passthrough(),

  [CHANNELS.threads.list]: cursorPage.optional(),
  [CHANNELS.threads.read]: threadId,
  [CHANNELS.threads.start]: z.object({ cwd: z.string().min(1) }).passthrough(),
  [CHANNELS.threads.resume]: threadId,
  [CHANNELS.threads.fork]: threadId,
  [CHANNELS.threads.archive]: threadId,
  [CHANNELS.threads.unarchive]: threadId,
  [CHANNELS.threads.remove]: threadId,
  [CHANNELS.threads.turns]: z
    .object({
      threadId: z.string().min(1),
      limit: z.number().int().positive().max(200).optional(),
      cursor: z.string().min(1).nullable().optional(),
    })
    .passthrough(),
  [CHANNELS.threads.search]: z.object({ query: z.string().max(500) }).passthrough(),
  [CHANNELS.threads.setName]: z
    .object({ threadId: z.string().min(1), name: z.string().max(200) })
    .passthrough(),
  [CHANNELS.threads.updateSettings]: threadId,

  [CHANNELS.turn.start]: z
    .object({ threadId: z.string().min(1), input: z.array(z.unknown()).min(1) })
    .passthrough(),
  [CHANNELS.turn.steer]: z
    .object({
      threadId: z.string().min(1),
      expectedTurnId: z.string().min(1),
      input: z.array(z.unknown()).min(1),
    })
    .passthrough(),
  [CHANNELS.turn.interrupt]: threadId,

  [CHANNELS.approvals.list]: voidInput,
  [CHANNELS.approvals.resolveCommand]: z
    .object({
      localId: z.string().min(1),
      decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
    })
    .passthrough(),
  [CHANNELS.approvals.resolveFileChange]: z
    .object({
      localId: z.string().min(1),
      decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
    })
    .strict(),
  [CHANNELS.approvals.resolveElicitation]: z
    .object({
      localId: z.string().min(1),
      action: z.enum(["accept", "decline", "cancel"]),
      content: z.unknown().nullable().optional(),
    })
    .strict(),
  [CHANNELS.approvals.resolveUserInput]: z
    .object({
      localId: z.string().min(1),
      answers: z.record(
        z.string(),
        z.object({ answers: z.array(z.string()) }).passthrough(),
      ),
    })
    .strict(),
  [CHANNELS.approvals.respondError]: z
    .object({
      localId: z.string().min(1),
      code: z.number().int(),
      message: z.string().max(500),
      data: z.unknown().optional(),
    })
    .strict(),

  [CHANNELS.fs.readFile]: z.object({ path: z.string().min(1) }).strict(),
  [CHANNELS.fs.readDirectory]: z.object({ path: z.string().min(1) }).strict(),

  [CHANNELS.process.spawn]: z
    .object({
      cwd: z.string().min(1).optional(),
      shell: z.string().min(1).max(300).optional(),
      title: z.string().max(100).optional(),
    })
    .strict()
    .optional(),
  [CHANNELS.process.writeStdin]: z
    .object({ id: z.string().min(1), data: z.string().max(64 * 1024) })
    .strict(),
  [CHANNELS.process.resizePty]: z
    .object({
      id: z.string().min(1),
      cols: z.number().int().min(2).max(1000),
      rows: z.number().int().min(2).max(500),
    })
    .strict(),
  [CHANNELS.process.kill]: z.object({ id: z.string().min(1) }).strict(),

  [CHANNELS.settings.authStatus]: z
    // includeToken 不接受渲染端输入：主进程恒以 includeToken:false 调用（AC-13）。
    .object({ refreshToken: z.boolean().optional() })
    .strict()
    .optional(),
  [CHANNELS.settings.account]: z.object({}).passthrough().optional(),
  [CHANNELS.settings.login]: z
    .object({ type: z.enum(["chatgpt", "chatgptDeviceCode"]) })
    .strict(),
  [CHANNELS.settings.logout]: voidInput,
  [CHANNELS.settings.models]: cursorPage.optional(),
  [CHANNELS.settings.permissionProfiles]: cursorPage.optional(),
  [CHANNELS.settings.configRead]: z.object({}).passthrough(),
  [CHANNELS.settings.configWrite]: z
    .object({
      keyPath: z.string().min(1),
      value: z.unknown(),
      mergeStrategy: z.enum(["replace", "upsert"]),
      filePath: z.string().min(1).nullable().optional(),
      expectedVersion: z.string().min(1).nullable().optional(),
    })
    .passthrough(),
  [CHANNELS.settings.configRequirements]: voidInput,
  [CHANNELS.settings.mcpList]: cursorPage.optional(),
  [CHANNELS.settings.mcpReload]: voidInput,
  [CHANNELS.settings.diagnostics]: z.object({}).passthrough().optional(),
  [CHANNELS.settings.cliUpdate]: voidInput,
  [CHANNELS.settings.cliUpdateCancel]: voidInput,
  [CHANNELS.settings.doctor]: voidInput,
  [CHANNELS.settings.exportLogs]: voidInput,
  [CHANNELS.settings.prefsGet]: voidInput,
  [CHANNELS.settings.prefsSet]: z
    .object({
      notifyTurnCompleted: z.boolean().optional(),
      notifyApprovals: z.boolean().optional(),
      closeToTray: z.boolean().optional(),
    })
    .strict(),
} satisfies Record<string, z.ZodType>;

export type InputOf<C extends keyof typeof INPUTS> = z.infer<(typeof INPUTS)[C]>;

export interface BackendStatusSnapshot {
  state: "idle" | "resolving" | "connecting" | "ready" | "reconnecting" | "closed" | "fatal";
  codex: { path: string; version: string; source: string } | null;
  serverInfo: { userAgent?: string; platformOs?: string } | null;
  fatalMessage: string | null;
  /** 连接断开后的累计重试次数（ready 后归零），供渲染层判断是否进入 recovery。 */
  reconnectAttempts?: number;
}

export interface WizardState {
  completed: boolean;
  activeProjectId: string | null;
  roots: string[];
}

/** process/spawn 返回：终端标签据此建立 xterm 会话。 */
export interface ProcessSpawnResult {
  id: string;
  /** 实际使用的 shell 可执行文件路径。 */
  shell: string;
  title: string;
  cwd: string;
}

/** process:output-delta 推送载荷。 */
export interface ProcessOutputPayload {
  id: string;
  data: string;
}

/** process:exited 推送载荷。 */
export interface ProcessExitPayload {
  id: string;
  exitCode: number;
}

/** 本机偏好（通知/关闭行为），Task 16 托盘与通知据此生效。 */
export interface LocalPrefs {
  notifyTurnCompleted: boolean;
  notifyApprovals: boolean;
  closeToTray: boolean;
}

/** codex doctor / codex update 的结果。 */
export interface CliToolResult {
  code: number;
  output: string;
}

/** 统一错误信封：校验失败/方法不可用/后端错误均走此结构，渲染端收到的是可展示消息。 */
export interface IpcErrorShape {
  code: "BAD_REQUEST" | "BACKEND_NOT_READY" | "METHOD_UNAVAILABLE" | "FORBIDDEN_PATH" | "INTERNAL" | string;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorShape };
