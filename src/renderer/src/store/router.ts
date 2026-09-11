import { create } from "zustand";

export type ViewKey = "wizard" | "chat" | "settings";

export type SettingsSection =
  | "account"
  | "models"
  | "codex"
  | "config"
  | "mcp"
  | "general"
  | "diagnostics"
  | "about";

interface RouterStore {
  view: ViewKey;
  settingsSection: SettingsSection;
  setView: (view: ViewKey) => void;
  openSettings: (section?: SettingsSection) => void;
}

/** 轻量路由：Electron 单页无需 history 栈，状态即路由。 */
export const useRouterStore = create<RouterStore>((set) => ({
  view: "chat",
  settingsSection: "account",
  setView: (view) => set({ view }),
  openSettings: (section) => set({ view: "settings", settingsSection: section ?? "account" }),
}));
