/**
 * 底部可折叠终端区（Task 14）：多标签、新建/关闭、字号调节。
 * 折叠时保留一条可点击的头部条；首次展开自动创建首个终端。
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, TerminalSquare, X } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { useToastStore } from "../../store/toast.ts";
import { bindTerminalEvents, useTerminalStore, type TerminalSession } from "../../store/terminal.ts";
import { TerminalView } from "./terminal-view.tsx";

function TabChip({
  session,
  active,
  onSelect,
  onClose,
}: {
  session: TerminalSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      title={session.cwd ?? session.title}
      className={cn(
        "group flex h-7 min-w-0 max-w-[180px] cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px]",
        active
          ? "border-border bg-surface text-text"
          : "border-transparent bg-transparent text-text-muted hover:bg-hover",
      )}
    >
      <TerminalSquare className={cn("h-3 w-3 shrink-0", session.exited ? "text-text-faint" : "text-accent")} />
      <span className={cn("truncate", session.exited && "line-through opacity-60")}>{session.title}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="关闭终端"
        className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-danger/20 hover:text-red-300"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function TerminalPane() {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const open = useTerminalStore((s) => s.open);
  const fontSize = useTerminalStore((s) => s.fontSize);
  const creating = useTerminalStore((s) => s.creating);
  const setOpen = useTerminalStore((s) => s.setOpen);
  const setActive = useTerminalStore((s) => s.setActive);
  const setFontSize = useTerminalStore((s) => s.setFontSize);
  const create = useTerminalStore((s) => s.create);
  const close = useTerminalStore((s) => s.close);
  const toastError = useToastStore((s) => s.error);
  const [spawning, setSpawning] = useState(false);

  useEffect(() => bindTerminalEvents(), []);

  const active = sessions.find((x) => x.id === activeId) ?? null;

  const spawn = async () => {
    setSpawning(true);
    try {
      await create();
    } catch (err) {
      toastError("终端启动失败", err instanceof Error ? err.message : String(err));
    } finally {
      setSpawning(false);
    }
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // 展开时没有可用终端则自动补一个，减少空面板状态。
    if (useTerminalStore.getState().sessions.length === 0) void spawn();
  };

  return (
    <section className={cn("shrink-0 border-t border-border bg-surface-2", open ? "h-[300px]" : "h-9")}>
      <header className="flex h-9 items-center gap-1 px-2">
        <button
          onClick={toggle}
          title={open ? "折叠终端" : "展开终端"}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-muted hover:bg-hover hover:text-text"
        >
          <TerminalSquare className="h-3.5 w-3.5" />
          <span>终端</span>
          {sessions.length > 0 && (
            <span className="rounded-full bg-surface-3 px-1.5 text-[10px] text-text-faint">{sessions.length}</span>
          )}
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>

        {open && (
          <>
            <div className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {sessions.map((s) => (
                <TabChip
                  key={s.id}
                  session={s}
                  active={s.id === activeId}
                  onSelect={() => setActive(s.id)}
                  onClose={() => void close(s.id)}
                />
              ))}
              <button
                onClick={() => void spawn()}
                disabled={creating || spawning}
                title="新建终端"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                onClick={() => setFontSize(Math.max(9, fontSize - 1))}
                title="减小字号"
                className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-6 text-center text-[10px] text-text-faint">{fontSize}</span>
              <button
                onClick={() => setFontSize(Math.min(20, fontSize + 1))}
                title="增大字号"
                className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </>
        )}
      </header>

      {open && (
        <div className="h-[calc(100%-2.25rem)] px-1.5 pb-1.5">
          {active ? (
            <TerminalView key={active.id} session={active} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <button
                onClick={() => void spawn()}
                disabled={creating || spawning}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-2.5 text-[12px] text-text-muted hover:border-accent/50 hover:text-text disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                新建终端
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
