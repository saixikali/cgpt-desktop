import { Minus, Square, X, TerminalSquare } from "lucide-react";
import { bridge } from "../lib/ipc.ts";
import { t } from "../i18n/zh.ts";
import { useBackendStore } from "../store/backend.ts";
import { cn } from "../lib/cn.ts";

const STATE_DOT: Record<string, string> = {
  idle: "bg-zinc-500",
  resolving: "bg-amber-400 animate-pulse",
  connecting: "bg-amber-400 animate-pulse",
  ready: "bg-emerald-400",
  reconnecting: "bg-amber-400 animate-pulse",
  closed: "bg-zinc-500",
  fatal: "bg-red-500",
};

export function TitleBar() {
  const status = useBackendStore((s) => s.status);
  const state = status?.state ?? "idle";

  return (
    <header className="titlebar flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
      <TerminalSquare className="h-4 w-4 text-accent" strokeWidth={1.8} />
      <span className="text-xs font-medium">{t.app.name}</span>
      <span className="ml-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className={cn("h-1.5 w-1.5 rounded-full", STATE_DOT[state])} />
        {t.status[state as keyof typeof t.status] ?? state}
      </span>
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
          className="flex h-7 w-9 items-center justify-center text-text-muted hover:bg-red-500/90 hover:text-white"
          onClick={() => void bridge().app.windowControl({ action: "close" })}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
