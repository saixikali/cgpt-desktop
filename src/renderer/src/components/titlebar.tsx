import { Minus, Square, X } from "lucide-react";
import { bridge } from "../lib/ipc.ts";
import { t } from "../i18n/zh.ts";
import { useBackendStore } from "../store/backend.ts";
import { cn } from "../lib/cn.ts";

const STATE_DOT: Record<string, string> = {
  idle: "bg-text-faint",
  resolving: "bg-warning animate-pulse",
  connecting: "bg-warning animate-pulse",
  ready: "bg-success",
  reconnecting: "bg-warning animate-pulse",
  closed: "bg-text-faint",
  fatal: "bg-danger",
};

export function TitleBar() {
  const status = useBackendStore((s) => s.status);
  const state = status?.state ?? "idle";
  const stateLabel = t.status[state as keyof typeof t.status] ?? state;

  return (
    <header className="titlebar relative flex h-9 shrink-0 items-center border-b border-border bg-panel px-3">
      {/* 左：后端状态小点 */}
      <div
        className="flex items-center gap-1.5"
        title={`${t.app.name} · ${stateLabel}`}
      >
        <span className={cn("h-2 w-2 rounded-full", STATE_DOT[state])} />
      </div>

      {/* 中：应用名 + 版本 + 徽标 */}
      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
        <span className="text-xs font-semibold text-text">{t.app.name}</span>
        <span className="text-[11px] tabular-nums text-text-faint">
          v{window.cgpt.versions.app}
        </span>
        <span className="rounded-full border border-accent/30 bg-accent-soft px-1.5 py-px text-[10px] font-medium text-accent">
          {t.app.badge}
        </span>
      </div>

      <div className="flex-1" />
      <div className="titlebar-actions flex items-center">
        <button
          className="flex h-7 w-9 items-center justify-center text-text-muted hover:bg-hover hover:text-text"
          onClick={() => void bridge().app.windowControl({ action: "minimize" })}
          aria-label="最小化"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-7 w-9 items-center justify-center text-text-muted hover:bg-hover hover:text-text"
          onClick={() => void bridge().app.windowControl({ action: "toggleMaximize" })}
          aria-label="最大化/还原"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          className="flex h-7 w-9 items-center justify-center text-text-muted hover:bg-danger hover:text-on-accent"
          onClick={() => void bridge().app.windowControl({ action: "close" })}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
