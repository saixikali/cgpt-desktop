/**
 * IPC 通道与推送事件常量（零运行时依赖，供 sandbox preload 直接引用）。
 * zod schema 与业务类型见 contract.ts。
 */
export const CHANNELS = {
  app: {
    version: "app:version",
    windowControl: "app:window-control",
    pickDirectory: "app:pick-directory",
    pickFile: "app:pick-file",
    showItem: "app:show-item",
    openExternal: "app:open-external",
    openLogsDir: "app:open-logs-dir",
    chatSpace: "app:chat-space",
  },
  backend: {
    status: "backend:status",
    restart: "backend:restart",
    wizardGet: "backend:wizard-get",
    wizardComplete: "backend:wizard-complete",
    setCodexOverride: "backend:set-codex-override",
    setActiveProject: "backend:set-active-project",
  },
  projects: {
    list: "projects:list",
    read: "projects:read",
    create: "projects:create",
    update: "projects:update",
    remove: "projects:delete",
    import: "projects:import",
    move: "projects:move",
  },
  threads: {
    list: "threads:list",
    read: "threads:read",
    start: "threads:start",
    startChat: "threads:start-chat",
    resume: "threads:resume",
    fork: "threads:fork",
    archive: "threads:archive",
    unarchive: "threads:unarchive",
    remove: "threads:delete",
    turns: "threads:turns",
    search: "threads:search",
    setName: "threads:set-name",
    updateSettings: "threads:update-settings",
  },
  turn: {
    start: "turn:start",
    steer: "turn:steer",
    interrupt: "turn:interrupt",
  },
  approvals: {
    list: "approvals:list",
    resolveCommand: "approvals:resolve-command",
    resolveFileChange: "approvals:resolve-file-change",
    resolveElicitation: "approvals:resolve-elicitation",
    resolveUserInput: "approvals:resolve-user-input",
    respondError: "approvals:respond-error",
  },
  fs: {
    readFile: "fs:read-file",
    readDirectory: "fs:read-directory",
  },
  process: {
    spawn: "process:spawn",
    writeStdin: "process:write-stdin",
    resizePty: "process:resize-pty",
    kill: "process:kill",
  },
  settings: {
    authStatus: "settings:auth-status",
    account: "settings:account",
    login: "settings:login",
    logout: "settings:logout",
    models: "settings:models",
    permissionProfiles: "settings:permission-profiles",
    configRead: "settings:config-read",
    configWrite: "settings:config-write",
    configRequirements: "settings:config-requirements",
    mcpList: "settings:mcp-list",
    mcpReload: "settings:mcp-reload",
    diagnostics: "settings:diagnostics",
    cliUpdate: "settings:cli-update",
    cliUpdateCancel: "settings:cli-update-cancel",
    doctor: "settings:doctor",
    exportLogs: "settings:export-logs",
    prefsGet: "settings:prefs-get",
    prefsSet: "settings:prefs-set",
  },
} as const;

/** 主进程 → 渲染进程推送事件（统一走 cgpt:event 通道，event 字段取下列值）。 */
export const EVENTS = {
  backendStatus: "backend:status-changed",
  approvalChanged: "approval:changed",
  codexNotification: "codex:notification",
  processOutputDelta: "process:output-delta",
  processExited: "process:exited",
  cliUpdateOutput: "cli-update:output",
  cliUpdateExited: "cli-update:exited",
  /** 托盘/第二实例请求：显示并聚焦窗口。 */
  appShow: "app:show",
  /** 托盘菜单请求新建会话。 */
  appNewThread: "app:new-thread",
  /** 第二实例携带目录参数：载荷 { path }。 */
  appOpenPath: "app:open-path",
} as const;

export type PushEventName = (typeof EVENTS)[keyof typeof EVENTS];
