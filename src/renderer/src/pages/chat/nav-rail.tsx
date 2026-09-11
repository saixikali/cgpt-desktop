import { MessagesSquare, Settings as SettingsIcon, WandSparkles } from "lucide-react";
import { t } from "../../i18n/zh.ts";
import { useApprovalsStore } from "../../store/approvals.ts";
import { useRouterStore, type ViewKey } from "../../store/router.ts";
import { cn } from "../../lib/cn.ts";

const ITEMS: Array<{ key: ViewKey; icon: typeof MessagesSquare; label: string }> = [
  { key: "chat", icon: MessagesSquare, label: t.nav.chat },
  { key: "wizard", icon: WandSparkles, label: t.nav.wizard },
  { key: "settings", icon: SettingsIcon, label: t.nav.settings },
];

export function NavRail() {
  const view = useRouterStore((s) => s.view);
  const setView = useRouterStore((s) => s.setView);
  const pendingCount = useApprovalsStore((s) => s.pending.length);

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2">
      {ITEMS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          title={label}
          onClick={() => setView(key)}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
            view === key
              ? "bg-accent-soft text-accent"
              : "text-text-faint hover:bg-hover hover:text-text-muted",
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
          {key === "chat" && pendingCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-warning" />
          )}
        </button>
      ))}
    </nav>
  );
}
