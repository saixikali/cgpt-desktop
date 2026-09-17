/**
 * 注册全部 ipcMain.handle：
 *  - 入参统一经 shared/contract 的 zod 校验（非法 → BAD_REQUEST 信封，不抛异常到渲染层）
 *  - 后端未就绪/方法不可用/越权路径/RPC 错误全部归一为 IpcErrorShape
 *  - fs 读取强制 roots 白名单；resume/start 成功后自动登记新 roots
 */
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { homedir, release } from "node:os";
import { app, dialog, ipcMain, shell, BrowserWindow } from "electron";
import { mkdir, readdir } from "node:fs/promises";
import { z } from "zod";
import {
  CHANNELS as C,
  INPUTS,
  type IpcErrorShape,
  type IpcResult,
  type LocalPrefs,
  type WizardState,
} from "../../shared/ipc/contract.ts";
import type { AppSettings } from "../app-settings.ts";
import {
  BackendNotReadyError,
  BackendService,
  MethodUnavailableError,
} from "../backend-service.ts";
import { RpcError } from "../codex/rpc-client.ts";
import { probeCodex } from "../codex/codex-resolver.ts";
import type { CliToolsService } from "../codex/cli-tools.ts";
import { logger } from "../logging.ts";
import type { TerminalService } from "../pty/terminal-service.ts";
import { assertWithinRoots } from "./path-guard.ts";

interface HandlerContext {
  backend: BackendService;
  settings: AppSettings;
  terminal: TerminalService;
  cliTools: CliToolsService;
  logsDir: string;
  getWindow: () => BrowserWindow | null;
}

type AnyHandler = (
  ctx: HandlerContext,
  input: any,
  appVersion?: string,
) => Promise<unknown> | unknown;

/* ---------------- 工作区去重 ---------------- */

interface ProjectLike {
  id: string;
  name?: string | null;
  roots?: Array<{ path?: string | null }> | null;
}

/** Windows 下归一化工作目录（反斜杠/小写/去尾部斜杠），用于同目录判定。 */
const normProjectRoot = (p: string): string =>
  p.replace(/\//g, "\\").trim().toLowerCase().replace(/\\+$/, "");

/**
 * 查找工作目录集合完全相同的已有项目：向导重复完成/重复新建同目录时直接复用，
 * 避免后端堆积同名同目录的重复项目记录。
 */
async function findProjectWithRoots(
  api: ReturnType<BackendService["api"]>,
  rootPaths: string[],
): Promise<ProjectLike | null> {
  const want = new Set(rootPaths.filter(Boolean).map(normProjectRoot));
  if (want.size === 0) return null;
  try {
    const page = (await api.listProjects({ limit: 100 })) as { data?: unknown };
    if (!Array.isArray(page.data)) return null;
    for (const raw of page.data) {
      const p = raw as ProjectLike;
      if (!p?.id || !Array.isArray(p.roots)) continue;
      const got = new Set(
        p.roots.map((r) => (r?.path ? normProjectRoot(r.path) : "")).filter(Boolean),
      );
      if (got.size === want.size && [...want].every((x) => got.has(x))) return p;
    }
  } catch (err) {
    logger.warn("查找同目录工作区失败，按新建处理", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

/* ---------------- 纯对话（日常聊天） ---------------- */

/**
 * 纯对话会话统一使用的托管工作目录（userData/chat-space）。
 * Codex thread 必须有 cwd，该目录仅作中性载体：只读沙箱 + 免审批，
 * 渲染层据此路径识别"纯对话"会话，与任务/工作区会话隔离展示。
 */
function chatSpaceDir(): string {
  return join(app.getPath("userData"), "chat-space");
}

async function ensureChatSpace(): Promise<string> {
  const dir = chatSpaceDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function errorShape(err: unknown): IpcErrorShape {
  if (err instanceof BackendNotReadyError) return { code: "BACKEND_NOT_READY", message: err.message };
  if (err instanceof MethodUnavailableError) return { code: "METHOD_UNAVAILABLE", message: err.message };
  if (err instanceof z.ZodError) {
    return { code: "BAD_REQUEST", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  if (err instanceof RpcError) return { code: `RPC_${err.code}`, message: err.message };
  if (err instanceof Error && err.name === "ForbiddenPathError") {
    return { code: "FORBIDDEN_PATH", message: err.message };
  }
  if (err instanceof Error) {
    logger.error("IPC 处理失败", { name: err.name, message: err.message });
    return { code: "INTERNAL", message: err.message };
  }
  return { code: "INTERNAL", message: String(err) };
}

/** 从 resume/start 响应中提取工作区 roots 并登记。 */
function collectRoots(res: unknown): string[] {
  if (!res || typeof res !== "object") return [];
  const r = res as Record<string, unknown>;
  const roots: string[] = [];
  if (typeof r.cwd === "string") roots.push(r.cwd);
  if (Array.isArray(r.runtimeWorkspaceRoots)) {
    for (const p of r.runtimeWorkspaceRoots) if (typeof p === "string") roots.push(p);
  }
  if (r.thread && typeof r.thread === "object") {
    const t = r.thread as Record<string, unknown>;
    if (typeof t.cwd === "string") roots.push(t.cwd);
  }
  return roots;
}

const HANDLERS: Record<string, AnyHandler> = {
  // ---------- app ----------
  [C.app.version]: async (_ctx, _i, appVersion) => appVersion as string,
  [C.app.windowControl]: async (ctx, input: { action: string }) => {
    const win = ctx.getWindow();
    if (!win) return null;
    if (input.action === "minimize") win.minimize();
    else if (input.action === "close") win.close();
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return null;
  },
  [C.app.pickDirectory]: async (_ctx, input) => {
    const r = await dialog.showOpenDialog({
      title: "选择工作目录",
      defaultPath: input?.defaultPath,
      properties: ["openDirectory", "treatPackageAsDirectory"],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  [C.app.pickFile]: async (_ctx, input) => {
    const r = await dialog.showOpenDialog({
      title: input?.title ?? "选择文件",
      defaultPath: input?.defaultPath,
      properties: ["openFile", "treatPackageAsDirectory"],
      // 未显式传 filters 时保留 codex.exe 过滤（向导手动指定场景）。
      filters: input?.filters ?? (process.platform === "win32" ? [{ name: "Codex CLI", extensions: ["exe"] }] : undefined),
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  [C.app.showItem]: async (_ctx, input: { path: string }) => {
    shell.showItemInFolder(input.path);
    return null;
  },
  [C.app.openExternal]: async (_ctx, input: { url: string }) => {
    // schema 已限制 http/https，这里再兜底校验一次。
    if (!/^https?:\/\//i.test(input.url)) throw new Error("仅允许 http/https 链接");
    await shell.openExternal(input.url);
    return null;
  },
  [C.app.openLogsDir]: async (ctx) => {
    const err = await shell.openPath(ctx.logsDir);
    if (err) throw new Error(err);
    return null;
  },
  [C.app.chatSpace]: async () => ensureChatSpace(),

  // ---------- backend / wizard ----------
  [C.backend.status]: async (ctx) => ctx.backend.getStatus(),
  [C.backend.restart]: async (ctx, input?: { reason?: string }) => {
    await ctx.backend.restart(input?.reason);
    return ctx.backend.getStatus();
  },
  [C.backend.wizardGet]: async (ctx): Promise<WizardState> => {
    const s = ctx.settings.get();
    return { completed: s.wizardCompleted, activeProjectId: s.activeProjectId, roots: s.roots };
  },
  [C.backend.wizardComplete]: async (ctx, input: { projectPath: string; title?: string }) => {
    ctx.settings.addRoots([input.projectPath]);
    let project: unknown = null;
    let degraded = false;
    try {
      const api = ctx.backend.api();
      // 同一目录重复完成向导时复用已有项目，不再产生重复记录。
      const existing = await findProjectWithRoots(api, [input.projectPath]);
      if (existing) {
        project = existing;
        ctx.settings.update({
          wizardCompleted: true,
          activeProjectId: existing.id,
        });
      } else {
        const res = await api.createProject({
          name: input.title?.trim() || basename(input.projectPath),
          roots: [{ path: input.projectPath }],
          idempotencyKey: randomUUID(),
        });
        project = res.project;
        ctx.settings.update({
          wizardCompleted: true,
          activeProjectId: (res.project as { id?: string })?.id ?? null,
        });
      }
    } catch (err) {
      // experimentalApi 缺失时降级为"最近目录模式"：不建 project，仅持久化 roots。
      if (err instanceof MethodUnavailableError) {
        degraded = true;
        ctx.settings.update({ wizardCompleted: true });
      } else {
        throw err;
      }
    }
    return { project, degraded };
  },

  [C.backend.setCodexOverride]: async (ctx, input: { path: string | null }) => {
    if (input.path === null) {
      ctx.settings.update({ codexPathOverride: null });
    } else {
      // 手动指定的文件必须先通过 --version 探活，避免写入无效路径。
      const version = await probeCodex(input.path);
      if (!version) {
        throw new Error("所选文件无法执行或不是有效的 Codex CLI（--version 校验失败）");
      }
      ctx.settings.update({ codexPathOverride: input.path });
    }
    await ctx.backend.reloadClient("手动指定 codex 路径");
    return ctx.backend.getStatus();
  },

  [C.backend.setActiveProject]: async (ctx, input: { projectId: string | null }) => {
    ctx.settings.update({ activeProjectId: input.projectId });
    return null;
  },

  // ---------- projects ----------
  [C.projects.list]: (ctx, i) => ctx.backend.api().listProjects(i ?? {}),
  [C.projects.read]: (ctx, i) => ctx.backend.api().readProject(i),
  [C.projects.create]: async (ctx, i) => {
    const rootPaths = (i.roots ?? []).map((r: { path: string }) => r.path).filter(Boolean);
    // 同目录集合的项目已存在时直接复用（侧栏新建工作区与向导共用去重规则）。
    if (rootPaths.length > 0) {
      const existing = await findProjectWithRoots(ctx.backend.api(), rootPaths);
      if (existing) return { project: existing };
    }
    return ctx.backend.api().createProject({ idempotencyKey: randomUUID(), roots: [], name: "", ...i });
  },
  [C.projects.update]: (ctx, i) => ctx.backend.api().updateProject(i),
  [C.projects.remove]: (ctx, i) => ctx.backend.api().deleteProject(i),
  [C.projects.import]: (ctx, i) => ctx.backend.api().importProject(i),
  [C.projects.move]: (ctx, i) => ctx.backend.api().moveProject(i),

  // ---------- threads ----------
  [C.threads.list]: (ctx, i) => ctx.backend.api().listThreads(i ?? {}),
  [C.threads.read]: (ctx, i) => ctx.backend.api().readThread(i),
  [C.threads.start]: async (ctx, i) => {
    const res = await ctx.backend.api().startThread(i);
    ctx.settings.addRoots(collectRoots(res));
    return res;
  },
  // 纯对话：托管中性目录 + 只读沙箱 + 免审批；不登记进用户工作区 roots。
  [C.threads.startChat]: async (ctx) => {
    const cwd = await ensureChatSpace();
    const res = await ctx.backend.api().startThread({
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    return res;
  },
  [C.threads.resume]: async (ctx, i) => {
    const res = await ctx.backend.api().resumeThread(i);
    // 纯对话会话的托管目录不出现在向导最近目录里。
    const roots = collectRoots(res).filter(
      (r) => normProjectRoot(r) !== normProjectRoot(chatSpaceDir()),
    );
    ctx.settings.addRoots(roots);
    return res;
  },
  [C.threads.fork]: (ctx, i) => ctx.backend.api().forkThread(i),
  [C.threads.archive]: (ctx, i) => ctx.backend.api().archiveThread(i),
  [C.threads.unarchive]: (ctx, i) => ctx.backend.api().unarchiveThread(i),
  [C.threads.remove]: (ctx, i) => ctx.backend.api().deleteThread(i),
  [C.threads.turns]: (ctx, i) => ctx.backend.api().listTurns(i),
  [C.threads.search]: (ctx, i) => ctx.backend.api().searchThreads(i),
  [C.threads.setName]: (ctx, i) => ctx.backend.api().setThreadName(i),
  [C.threads.updateSettings]: (ctx, i) => ctx.backend.api().updateThreadSettings(i),

  // ---------- turn ----------
  [C.turn.start]: (ctx, i) => ctx.backend.api().startTurn(i),
  [C.turn.steer]: (ctx, i) => ctx.backend.api().steerTurn(i),
  [C.turn.interrupt]: (ctx, i) => ctx.backend.api().interruptTurn(i),

  // ---------- approvals ----------
  [C.approvals.list]: (ctx) => ctx.backend.apiOrNull?.approvals.list() ?? [],
  // 决议必须真正送达 codex：后端不可用时抛错，渲染层保留卡片并提示重试，
  // 绝不能静默回 null 让用户误以为已决议（codex 会永久挂起等待）。
  [C.approvals.resolveCommand]: async (ctx, i) => {
    await Promise.resolve(ctx.backend.api().approvals.resolveCommand(i.localId, i.decision));
    return null;
  },
  [C.approvals.resolveFileChange]: async (ctx, i) => {
    await Promise.resolve(ctx.backend.api().approvals.resolveFileChange(i.localId, i.decision));
    return null;
  },
  [C.approvals.resolveElicitation]: async (ctx, i) => {
    await Promise.resolve(
      ctx.backend.api().approvals.resolveElicitation(i.localId, i.action, i.content ?? null),
    );
    return null;
  },
  [C.approvals.resolveUserInput]: async (ctx, i) => {
    await Promise.resolve(ctx.backend.api().approvals.resolveUserInput(i.localId, i.answers));
    return null;
  },
  [C.approvals.respondError]: async (ctx, i) => {
    await Promise.resolve(
      ctx.backend.api().approvals.respondError(i.localId, i.code, i.message, i.data),
    );
    return null;
  },

  // ---------- fs（roots 白名单） ----------
  [C.fs.readFile]: async (ctx, input: { path: string }) => {
    const target = assertWithinRoots(ctx.settings.get().roots, input.path);
    return ctx.backend.api().fsReadFile({ ...input, path: target }).catch(async (err) => {
      // codex fs 接口未启用时退回本地直读（仍受 roots 限制）；统一 base64 输出。
      if (err instanceof MethodUnavailableError) {
        const buf = await import("node:fs/promises").then((m) => m.readFile(target));
        return { dataBase64: buf.toString("base64"), source: "local" as const };
      }
      throw err;
    });
  },
  [C.fs.readDirectory]: async (ctx, input: { path: string }) => {
    const target = assertWithinRoots(ctx.settings.get().roots, input.path);
    return ctx.backend.api().fsReadDirectory({ ...input, path: target }).catch(async (err) => {
      if (err instanceof MethodUnavailableError) {
        const entries = await readdir(target, { withFileTypes: true });
        return { entries: entries.map((d) => ({ name: d.name, isDirectory: d.isDirectory() })), source: "local" as const };
      }
      throw err;
    });
  },

  // ---------- process（内置终端，ConPTY） ----------
  [C.process.spawn]: (ctx, i?: { cwd?: string; shell?: string; title?: string }) => {
    // 仅接受落在已授权 roots 内的 cwd；非法时回退默认工作区根。
    // shell 一律忽略：渲染端无权指定任意可执行文件，只允许主进程候选探测。
    const roots = ctx.settings.get().roots;
    const defaultCwd = roots[0] ?? homedir();
    let cwd = defaultCwd;
    if (i?.cwd) {
      try {
        cwd = assertWithinRoots(roots, i.cwd);
      } catch {
        logger.warn("终端请求的 cwd 不在授权 roots 内，已回退默认", { cwd: i.cwd });
      }
    }
    return ctx.terminal.spawn(i ? { title: i.title } : {}, cwd);
  },
  [C.process.writeStdin]: (ctx, i: { id: string; data: string }) => {
    ctx.terminal.write(i.id, i.data);
    return null;
  },
  [C.process.resizePty]: (ctx, i: { id: string; cols: number; rows: number }) => {
    ctx.terminal.resize(i.id, i.cols, i.rows);
    return null;
  },
  [C.process.kill]: (ctx, i: { id: string }) => {
    ctx.terminal.kill(i.id);
    return null;
  },

  // ---------- settings ----------
  [C.settings.authStatus]: (ctx, i) =>
    // 安全基线 AC-13：渲染端永远拿不到令牌原文。refreshToken 是"触发刷新"动作标志，
    // 与令牌值无关，允许透传；includeToken 强制 false。
    ctx.backend.api().getAuthStatus({
      includeToken: false,
      refreshToken: i?.refreshToken === true,
    }),
  [C.settings.account]: (ctx, i) => ctx.backend.api().getAccount(i ?? {}),
  [C.settings.models]: (ctx, i) => ctx.backend.api().listModels(i ?? {}),
  [C.settings.permissionProfiles]: (ctx, i) => ctx.backend.api().listPermissionProfiles(i ?? {}),
  [C.settings.configRead]: (ctx, i) => ctx.backend.api().readConfig(i),
  [C.settings.configWrite]: (ctx, i) => ctx.backend.api().writeConfigValue(i),
  [C.settings.configRequirements]: (ctx) => ctx.backend.api().configRequirements(),
  [C.settings.mcpList]: (ctx, i) => ctx.backend.api().listMcpStatus(i ?? {}),
  [C.settings.mcpReload]: (ctx) => ctx.backend.api().reloadMcpConfig(),
  [C.settings.diagnostics]: (ctx, i) => ctx.backend.api().diagnostics(i ?? {}),

  [C.settings.login]: async (ctx, input: { type: "chatgpt" | "chatgptDeviceCode" }) =>
    ctx.backend.api().loginAccount(input),
  [C.settings.logout]: async (ctx) => ctx.backend.api().logout(),

  [C.settings.cliUpdate]: async (ctx) => ctx.cliTools.startUpdate(),
  [C.settings.cliUpdateCancel]: (ctx) => {
    ctx.cliTools.cancelUpdate();
    return null;
  },
  [C.settings.doctor]: async (ctx) => ctx.cliTools.runDoctor(),
  [C.settings.exportLogs]: async (ctx, _i, appVersion) => {
    const win = ctx.getWindow();
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win ?? new BrowserWindow({ show: false }), {
      title: "导出诊断日志",
      defaultPath: `cgpt-diag-${stamp}.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const s = ctx.settings.get();
    const summary = ctx.cliTools.buildEnvSummary({
      app: { version: appVersion },
      runtime: { platform: process.platform, osRelease: release(), electron: process.versions.electron, node: process.versions.node },
      backend: ctx.backend.getStatus(),
      settings: {
        wizardCompleted: s.wizardCompleted,
        activeProjectId: s.activeProjectId,
        roots: s.roots,
        codexPathOverride: s.codexPathOverride,
        notifyTurnCompleted: s.notifyTurnCompleted,
        notifyApprovals: s.notifyApprovals,
        closeToTray: s.closeToTray,
      },
    });
    return ctx.cliTools.exportLogs(ctx.logsDir, summary, r.filePath);
  },

  [C.settings.prefsGet]: (ctx): LocalPrefs => {
    const s = ctx.settings.get();
    return {
      notifyTurnCompleted: s.notifyTurnCompleted,
      notifyApprovals: s.notifyApprovals,
      closeToTray: s.closeToTray,
      theme: s.theme,
    };
  },
  [C.settings.prefsSet]: (ctx, i: Partial<LocalPrefs>): LocalPrefs => {
    ctx.settings.update(i);
    const s = ctx.settings.get();
    return {
      notifyTurnCompleted: s.notifyTurnCompleted,
      notifyApprovals: s.notifyApprovals,
      closeToTray: s.closeToTray,
      theme: s.theme,
    };
  },
};

export function registerIpc(ctx: HandlerContext, appVersion: string): void {
  for (const [channel, schema] of Object.entries(INPUTS)) {
    const handler = HANDLERS[channel];
    if (!handler) {
      logger.error("IPC 通道缺少 handler", { channel });
      continue;
    }
    ipcMain.handle(channel, async (_event, raw): Promise<IpcResult<unknown>> => {
      const parsed = (schema as z.ZodType).safeParse(raw === undefined ? undefined : raw);
      if (!parsed.success) {
        return { ok: false, error: errorShape(parsed.error) };
      }
      try {
        const data = await handler(ctx, parsed.data as never, appVersion);
        return { ok: true, data: data ?? null };
      } catch (err) {
        return { ok: false, error: errorShape(err) };
      }
    });
  }
}
