import { app, BrowserWindow, Menu } from "electron";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { AppSettings } from "./app-settings.ts";
import { CodexBackend } from "./backend/codex-backend.ts";
import { BackendService } from "./backend-service.ts";
import { ClaudeBackend } from "./claude-backend/claude-backend.ts";
import { CliToolsService } from "./codex/cli-tools.ts";
import { logger } from "./logging.ts";
import { registerIpc } from "./ipc/register-ipc.ts";
import { NotificationService } from "./notifications.ts";
import { TerminalService } from "./pty/terminal-service.ts";
import { TrayService } from "./tray.ts";
import { createMainWindow, installContentSecurityPolicy } from "./window.ts";
import { WindowStateStore } from "./window-state.ts";
import { EVENTS } from "../shared/ipc/contract.ts";

const SELFTEST = process.env["CGPT_SELFTEST"] === "1";

app.setName("Cgpt Desktop");
if (SELFTEST) {
  app.setPath("userData", join(tmpdir(), "cgpt-selftest-userdata"));
}
// Windows 通知归因（AppUserModelID）；打包后可用 appId 替换。
app.setAppUserModelId("com.cgpt.desktop");
// 打包后注册 cgpt-desktop:// 协议（开发环境不写注册表，避免关联 electron.exe）。
if (app.isPackaged && process.platform === "win32") {
  app.setAsDefaultProtocolClient("cgpt-desktop");
}

// 单实例：codex app-server 会独占 ~/.codex 的 sqlite 状态库，
// 两个 Electron 实例同时拉起 app-server 会互相抢锁、循环崩溃。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let backend: BackendService | null = null;
let claudeBackend: ClaudeBackend | null = null;
let tray: TrayService | null = null;
let windowState: WindowStateStore | null = null;
let isQuitting = false;
const terminal = new TerminalService((event, payload) => broadcast(event, payload));
let cliTools: CliToolsService | null = null;

/**
 * 从命令行参数解析要打开的目录：
 *  - cgpt-desktop://open?path=<dir>
 *  - 直接传入的目录路径
 * 最小处理：仅做存在性校验，后续新建会话交给渲染层。
 */
function parseOpenArg(argv: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("cgpt-desktop://")) {
      try {
        const url = new URL(arg);
        const p = url.searchParams.get("path");
        if (p && isAbsolute(p) && existsSync(p) && statSync(p).isDirectory()) return p;
      } catch {
        /* 非法 URL 忽略 */
      }
      continue;
    }
    if (arg.startsWith("-") || !isAbsolute(arg)) continue;
    try {
      if (existsSync(arg) && statSync(arg).isDirectory()) return arg;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

function broadcast(event: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("cgpt:event", { event, payload });
  }
}

function showWindow(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** 最大化/还原时通知渲染层切换标题栏按钮图标（单方框 ⇄ 双叠方框）。 */
function bindWindowStateEvents(win: BrowserWindow): void {
  const emit = (maximized: boolean) => {
    if (!win.isDestroyed()) {
      win.webContents.send("cgpt:event", {
        event: EVENTS.appWindowState,
        payload: { maximized },
      });
    }
  };
  win.on("maximize", () => emit(true));
  win.on("unmaximize", () => emit(false));
}

/**
 * 仅在 CGPT_SELFTEST=1 时运行的端内安全自检（TR-4.1/4.2/4.4 取证用），
 * 正常启动路径不会执行。结果经 stdout 打印后退出。
 */
async function runSelfTest(win: BrowserWindow, service: BackendService): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && service.getStatus().state !== "ready") await sleep(500);

  const probeRoot = join(tmpdir(), "cgpt-selftest-root");
  mkdirSync(probeRoot, { recursive: true });

  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = {};
    out.requireType = typeof require;
    out.processType = typeof process;
    out.cgptPresent = !!window.cgpt;
    out.bridgeKeys = window.cgpt ? Object.keys(window.cgpt) : [];
    try { (0, eval)("1+1"); out.evalBlocked = false; } catch { out.evalBlocked = true; }
    try {
      const r = await fetch(location.href);
      out.cspHeader = r.headers.get("content-security-policy");
    } catch (e) { out.cspHeader = "fetch-error:" + e.message; }
    try {
      await window.cgpt.backend.wizardComplete({ projectPath: ${JSON.stringify(probeRoot)} });
      out.wizard = "ok";
    } catch (e) { out.wizard = "err:" + (e.code || e.message); }
    try {
      await window.cgpt.fs.readFile({ path: ${JSON.stringify(probeRoot)} + "\\\\..\\\\..\\\\secret.txt" });
      out.traversal = "allowed(!)";
    } catch (e) { out.traversal = e.code || e.message; }
    try {
      await window.cgpt.threads.resume({});
      out.malformed = "accepted(!)";
    } catch (e) { out.malformed = e.code || e.message; }
    out.status = (await window.cgpt.backend.status()).state;
    return out;
  })()`);

  // eslint-disable-next-line no-console
  console.log("CGPT_SELFTEST_RESULT " + JSON.stringify(result));
  await service.stop();
  await sleep(300);
  app.exit(0);
}

if (gotLock) {
  app.on("second-instance", (_event, argv) => {
    showWindow();
    const openPath = parseOpenArg(argv);
    if (openPath) broadcast(EVENTS.appOpenPath, { path: openPath });
    else broadcast(EVENTS.appShow);
  });
}

// 正常关闭窗口即退出（Windows/Linux）；closeToTray 拦截时窗口仅 hide，
// 不会触发本事件，托盘常驻由此自然成立。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 退出前杀掉 app-server 进程树与内置终端进程，避免残留进程独占状态库/工作目录。
let quitting = false;
app.on("before-quit", (event) => {
  isQuitting = true;
  if (quitting) {
    if (!backend) return;
    event.preventDefault();
    Promise.race([backend.stop(), new Promise((r) => setTimeout(r, 3000))]).finally(() => {
      backend = null;
      app.exit(0);
    });
    return;
  }
  event.preventDefault();
  quitting = true;
  terminal.killAll();
  cliTools?.dispose();
  void claudeBackend?.dispose();
  tray?.destroy();
  Promise.race([
    backend?.stop() ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, 3000)),
  ]).finally(() => {
    backend = null;
    app.exit(0);
  });
});

if (gotLock) {
app
  .whenReady()
  .then(async () => {
    installContentSecurityPolicy();
    Menu.setApplicationMenu(null);

    const settings = new AppSettings(app);
    windowState = new WindowStateStore(app);
    backend = new BackendService(app, settings, app.getVersion());
    cliTools = new CliToolsService(broadcast, () => settings.get().codexPathOverride);
    backend.on("status", (snapshot) => {
      broadcast(EVENTS.backendStatus, snapshot);
      tray?.setStatus(snapshot);
    });
    backend.on("notification", (envelope) => broadcast(EVENTS.codexNotification, envelope));
    backend.on("approval", (approval) => broadcast(EVENTS.approvalChanged, approval));

    // 双会话后端：claude 承载 Claude Code 会话，codex 承载其余全部（owns 恒真兜底）。
    // codex 事件仍由上面的 BackendService 订阅广播，此处只接 claude 的，避免重复消费。
    const codexConv = new CodexBackend(backend);
    const claudeConv = new ClaudeBackend(app.getPath("userData"));
    claudeBackend = claudeConv;
    claudeConv.on("notification", (envelope) => broadcast(EVENTS.codexNotification, envelope));
    claudeConv.on("approval", (approval) => broadcast(EVENTS.approvalChanged, approval));

    const logsDir = join(app.getPath("userData"), "logs");
    registerIpc(
      {
        backend,
        settings,
        terminal,
        cliTools,
        logsDir,
        getWindow: () => mainWindow,
        conversation: {
          codex: codexConv,
          claude: claudeConv,
          forThread: (threadId) =>
            typeof threadId === "string" && claudeConv.owns(threadId) ? claudeConv : codexConv,
        },
      },
      app.getVersion(),
    );

    const notifications = new NotificationService(
      backend,
      () => mainWindow,
      () => settings.get(),
      broadcast,
    );
    notifications.bind();

    tray = new TrayService({
      getWindow: () => mainWindow,
      onNewThread: () => broadcast(EVENTS.appNewThread),
      onQuit: () => app.quit(),
    });

    mainWindow = await createMainWindow(windowState.get());
    windowState.track(mainWindow);
    bindWindowStateEvents(mainWindow);
    mainWindow.on("close", (event) => {
      // 关闭到托盘：拦截并隐藏；真正退出（托盘菜单/before-quit）时放行。
      if (!isQuitting && settings.get().closeToTray) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    // 首个实例启动携带的目录参数，等渲染层加载完再投递。
    const openPath = parseOpenArg(process.argv);
    if (openPath) {
      mainWindow.webContents.once("did-finish-load", () =>
        broadcast(EVENTS.appOpenPath, { path: openPath }),
      );
    }

    // 后端在窗口之外启动，失败不阻塞 UI（由横幅展示 fatal）。
    backend
      .init()
      .catch((err) => {
        logger.error("后端初始化失败", { message: err?.message ?? String(err) });
      })
      .finally(() => {
        if (SELFTEST && mainWindow && backend) void runSelfTest(mainWindow, backend);
      });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow(windowState?.get()).then((win) => {
          mainWindow = win;
          windowState?.track(win);
          bindWindowStateEvents(win);
        });
      } else {
        showWindow();
      }
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("应用启动失败", err);
  });
}
