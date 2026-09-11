/**
 * 设置页状态：各分区数据切片（懒加载、可强刷）+ 跨分区持久状态
 * （登录流程、本机偏好、CLI 更新、doctor——切走再切回不丢进度）。
 */
import { create } from "zustand";
import {
  EVENTS,
  type CliToolResult,
  type LocalPrefs,
} from "@shared/ipc/contract.ts";
import { bridge, call, onEvent } from "../lib/ipc.ts";

export type SettingsKey = "auth" | "models" | "config" | "mcp" | "diagnostics";

export interface SettingsSlice<T = unknown> {
  data: T | null;
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
}

export interface LoginState {
  /** 登录流程进行中（等待浏览器回调或设备码确认）。 */
  pending: boolean;
  loginId: string | null;
  type: "chatgpt" | "chatgptDeviceCode" | null;
  authUrl: string | null;
  verificationUrl: string | null;
  userCode: string | null;
  error: string | null;
}

export interface CliUpdateState {
  running: boolean;
  output: string;
  exitCode: number | null;
}

export interface DoctorState {
  running: boolean;
  result: CliToolResult | null;
}

const LOGIN_IDLE: LoginState = {
  pending: false,
  loginId: null,
  type: null,
  authUrl: null,
  verificationUrl: null,
  userCode: null,
  error: null,
};

const OUTPUT_CAP = 200_000;

type SettingsState = Record<SettingsKey, SettingsSlice> & {
  login: LoginState;
  prefs: LocalPrefs | null;
  cliUpdate: CliUpdateState;
  doctor: DoctorState;
  exportingLogs: boolean;

  load: (key: SettingsKey, force?: boolean) => Promise<void>;
  refreshAuth: () => Promise<void>;
  startLogin: (type: "chatgpt" | "chatgptDeviceCode") => Promise<void>;
  logout: () => Promise<void>;
  clearLogin: () => void;
  loadPrefs: () => Promise<void>;
  setPrefs: (p: Partial<LocalPrefs>) => Promise<void>;
  startCliUpdate: () => Promise<void>;
  runDoctor: () => Promise<void>;
  exportLogs: () => Promise<string | null>;
  reset: () => void;
};

function emptySlice(): SettingsSlice {
  return { data: null, loading: false, error: null, loadedAt: null };
}

function patch(key: SettingsKey, p: Partial<SettingsSlice>) {
  return (s: SettingsState) => ({ [key]: { ...s[key], ...p } }) as Partial<SettingsState>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  auth: emptySlice(),
  models: emptySlice(),
  config: emptySlice(),
  mcp: emptySlice(),
  diagnostics: emptySlice(),

  login: LOGIN_IDLE,
  prefs: null,
  cliUpdate: { running: false, output: "", exitCode: null },
  doctor: { running: false, result: null },
  exportingLogs: false,

  load: async (key, force = false) => {
    const slice = get()[key];
    if (slice.loading || (slice.loadedAt && !force)) return;
    set(patch(key, { loading: true, error: null }));
    try {
      const data = await fetchSlice(key);
      set(patch(key, { data, loading: false, loadedAt: Date.now() }));
    } catch (err) {
      set(patch(key, { loading: false, error: (err as Error).message }));
    }
  },

  refreshAuth: async () => {
    set(patch("auth", { loading: true, error: null }));
    try {
      const data = await call(() => bridge().settings.authStatus({ refreshToken: true }));
      set(patch("auth", { data, loading: false, loadedAt: Date.now() }));
    } catch (err) {
      set(patch("auth", { loading: false, error: (err as Error).message }));
    }
  },

  startLogin: async (type) => {
    set({ login: { ...LOGIN_IDLE, pending: true, type } });
    try {
      const res = (await call<Record<string, unknown>>(() => bridge().settings.login({ type }))) as
        | { type: "chatgpt"; loginId?: string; authUrl?: string }
        | { type: "chatgptDeviceCode"; loginId?: string; verificationUrl?: string; userCode?: string };
      if (res?.type === "chatgpt") {
        const authUrl = res.authUrl ?? null;
        set({ login: { pending: true, loginId: res.loginId ?? null, type, authUrl, verificationUrl: null, userCode: null, error: null } });
        if (authUrl) void call(() => bridge().app.openExternal({ url: authUrl })).catch(() => {});
      } else if (res?.type === "chatgptDeviceCode") {
        const verificationUrl = res.verificationUrl ?? null;
        set({ login: { pending: true, loginId: res.loginId ?? null, type, authUrl: null, verificationUrl, userCode: res.userCode ?? null, error: null } });
        if (verificationUrl) void call(() => bridge().app.openExternal({ url: verificationUrl })).catch(() => {});
      } else {
        set({ login: { ...LOGIN_IDLE, error: "登录返回格式异常" } });
      }
    } catch (err) {
      set({ login: { ...LOGIN_IDLE, error: (err as Error).message } });
    }
  },

  logout: async () => {
    await call(() => bridge().settings.logout());
    set({ login: LOGIN_IDLE });
    await get().refreshAuth();
  },

  clearLogin: () => set({ login: LOGIN_IDLE }),

  loadPrefs: async () => {
    if (get().prefs) return;
    const prefs = await call<LocalPrefs>(() => bridge().settings.prefsGet());
    set({ prefs });
  },

  setPrefs: async (p) => {
    // 乐观更新，失败回滚由重读兜底。
    const prev = get().prefs;
    if (prev) set({ prefs: { ...prev, ...p } });
    try {
      const next = await call<LocalPrefs>(() => bridge().settings.prefsSet(p));
      set({ prefs: next });
    } catch (err) {
      set({ prefs: prev });
      throw err;
    }
  },

  startCliUpdate: async () => {
    if (get().cliUpdate.running) return;
    set({ cliUpdate: { running: true, output: "", exitCode: null } });
    try {
      const res = await call<{ started: boolean; message?: string }>(() => bridge().settings.cliUpdate());
      if (!res.started) {
        set({ cliUpdate: { running: false, output: res.message ?? "未能启动更新", exitCode: null } });
      }
    } catch (err) {
      set({ cliUpdate: { running: false, output: `启动失败：${(err as Error).message}`, exitCode: -1 } });
    }
  },

  runDoctor: async () => {
    if (get().doctor.running) return;
    set({ doctor: { running: true, result: null } });
    try {
      const result = await call<CliToolResult>(() => bridge().settings.doctor());
      set({ doctor: { running: false, result } });
    } catch (err) {
      set({ doctor: { running: false, result: { code: -1, output: (err as Error).message } } });
    }
  },

  exportLogs: async () => {
    if (get().exportingLogs) return null;
    set({ exportingLogs: true });
    try {
      return await call<string | null>(() => bridge().settings.exportLogs());
    } finally {
      set({ exportingLogs: false });
    }
  },

  reset: () =>
    set({
      auth: emptySlice(),
      models: emptySlice(),
      config: emptySlice(),
      mcp: emptySlice(),
      diagnostics: emptySlice(),
      login: LOGIN_IDLE,
      cliUpdate: { running: false, output: "", exitCode: null },
      doctor: { running: false, result: null },
    }),
}));

async function fetchSlice(key: SettingsKey): Promise<unknown> {
  const b = bridge();
  switch (key) {
    case "auth":
      return call(() => b.settings.authStatus({ refreshToken: false }));
    case "models":
      return call(() => b.settings.models({ limit: 100 }));
    case "config":
      return call(() => b.settings.configRead({}));
    case "mcp":
      return call(() => b.settings.mcpList({ limit: 100 }));
    case "diagnostics":
      return call(() => b.settings.diagnostics({}));
  }
  return null;
}

/**
 * 绑定与设置相关的推送事件（设置页挂载时调用一次）：
 *  - cli-update:output / cli-update:exited → 更新输出与结束态
 *  - account/login/completed → 登录成功/失败收尾
 */
export function bindSettingsEvents(): () => void {
  const unsubs = [
    onEvent(EVENTS.cliUpdateOutput, (payload) => {
      const p = payload as { data?: unknown } | null;
      if (!p || typeof p.data !== "string") return;
      useSettingsStore.setState((s) => ({
        cliUpdate: { ...s.cliUpdate, output: (s.cliUpdate.output + p.data).slice(-OUTPUT_CAP) },
      }));
    }),
    onEvent(EVENTS.cliUpdateExited, (payload) => {
      const p = payload as { exitCode?: unknown } | null;
      const exitCode = typeof p?.exitCode === "number" ? p.exitCode : -1;
      useSettingsStore.setState((s) => ({ cliUpdate: { ...s.cliUpdate, running: false, exitCode } }));
    }),
    onEvent(EVENTS.codexNotification, (payload) => {
      const env = payload as { method?: unknown; params?: unknown } | null;
      if (env?.method !== "account/login/completed") return;
      const p = (env.params ?? {}) as { success?: unknown; error?: unknown };
      const s = useSettingsStore.getState();
      if (!s.login.pending) return;
      if (p.success === true) {
        s.clearLogin();
        void s.refreshAuth();
      } else {
        useSettingsStore.setState({
          login: { ...s.login, pending: false, error: typeof p.error === "string" && p.error ? p.error : "登录未完成" },
        });
      }
    }),
  ];
  return () => unsubs.forEach((u) => u());
}
