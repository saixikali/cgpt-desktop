/**
 * 设置页：左侧分区导航 + 右侧内容。
 * 分区组件懒加载各自数据；登录/CLI 更新等跨页状态在 settings store 中保持。
 */
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Cpu,
  FileCode2,
  Info,
  Plug,
  Settings2,
  SquareTerminal,
  TerminalSquare,
  UserRound,
} from "lucide-react";
import { t } from "../../i18n/zh.ts";
import { useBackendStore } from "../../store/backend.ts";
import { bindSettingsEvents } from "../../store/settings.ts";
import { useRouterStore } from "../../store/router.ts";
import { Badge } from "../../components/ui/badge.tsx";
import { cn } from "../../lib/cn.ts";
import { AccountSection } from "./sections/account-section.tsx";
import { ModelsSection } from "./sections/models-section.tsx";
import { CodexCliSection } from "./sections/codex-section.tsx";
import { ConfigSection } from "./sections/config-section.tsx";
import { McpSection } from "./sections/mcp-section.tsx";
import { GeneralSection } from "./sections/general-section.tsx";
import { DiagnosticsSection } from "./sections/diagnostics-section.tsx";

type SectionKey = "account" | "models" | "codex" | "config" | "mcp" | "general" | "diagnostics" | "about";

const SECTIONS: Array<{ key: SectionKey; icon: typeof Info; label: string }> = [
  { key: "account", icon: UserRound, label: t.settings.sections.account },
  { key: "models", icon: Cpu, label: t.settings.sections.models },
  { key: "codex", icon: TerminalSquare, label: t.settings.sections.codexCli },
  { key: "config", icon: FileCode2, label: t.settings.sections.config },
  { key: "mcp", icon: Plug, label: t.settings.sections.mcp },
  { key: "general", icon: Settings2, label: t.settings.sections.general },
  { key: "diagnostics", icon: SquareTerminal, label: t.settings.sections.diagnostics },
  { key: "about", icon: Info, label: t.settings.sections.about },
];

function AboutPane() {
  const v = window.cgpt.versions;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
          <Settings2 className="h-5 w-5 text-accent" strokeWidth={1.7} />
        </div>
        <div>
          <p className="text-sm font-semibold">{t.app.name}</p>
          <p className="text-xs text-text-faint">{t.app.tagline}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-xs">
        <dt className="text-text-faint">{t.settings.about.version}</dt>
        <dd className="font-mono text-text-muted">{v.app}</dd>
        <dt className="text-text-faint">{t.settings.about.electron}</dt>
        <dd className="font-mono text-text-muted">{v.electron}</dd>
        <dt className="text-text-faint">{t.settings.about.chrome}</dt>
        <dd className="font-mono text-text-muted">{v.chrome}</dd>
        <dt className="text-text-faint">{t.settings.about.node}</dt>
        <dd className="font-mono text-text-muted">{v.node}</dd>
        <dt className="text-text-faint">{t.settings.about.platform}</dt>
        <dd className="font-mono text-text-muted">{window.cgpt.platform}</dd>
      </dl>
    </div>
  );
}

function SectionPane({ section }: { section: SectionKey }) {
  switch (section) {
    case "account":
      return <AccountSection />;
    case "models":
      return <ModelsSection />;
    case "codex":
      return <CodexCliSection />;
    case "config":
      return <ConfigSection />;
    case "mcp":
      return <McpSection />;
    case "general":
      return <GeneralSection />;
    case "diagnostics":
      return <DiagnosticsSection />;
    case "about":
      return <AboutPane />;
  }
}

export function SettingsPage() {
  const [active, setActive] = useState<SectionKey>("account");
  const routedSection = useRouterStore((s) => s.settingsSection);
  const openSettings = useRouterStore((s) => s.openSettings);
  const setView = useRouterStore((s) => s.setView);
  const codex = useBackendStore((s) => s.status?.codex);
  const backendState = useBackendStore((s) => s.status?.state ?? "idle");

  // 外部（recovery 横幅/托盘）请求定位到指定分区时跟随。
  useEffect(() => {
    setActive(routedSection);
  }, [routedSection]);

  // 设置相关推送事件（CLI 更新输出、登录完成）绑定一次。
  useEffect(() => bindSettingsEvents(), []);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border bg-surface p-2">
        <button
          onClick={() => setView("chat")}
          title={t.nav.chat}
          className="mb-1 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-text-muted transition-colors hover:bg-hover hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          {t.nav.chat}
        </button>
        {SECTIONS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => openSettings(key)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
              active === key
                ? "bg-accent-soft font-medium text-accent"
                : "text-text-muted hover:bg-hover hover:text-text",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.7} />
            {label}
          </button>
        ))}
        {codex && (
          <div className="mt-auto rounded-lg border border-border bg-surface-2 p-2.5">
            <p className="text-[10px] text-text-faint">{t.settings.codexVersion}</p>
            <p className="truncate font-mono text-[11px] text-text-muted">{codex.version}</p>
            <Badge tone={backendState === "ready" ? "success" : backendState === "fatal" ? "danger" : "warning"} className="mt-1.5">
              {t.status[backendState]}
            </Badge>
          </div>
        )}
      </aside>
      <section className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <h1 className="mb-4 text-base font-semibold">
            {SECTIONS.find((s) => s.key === active)?.label}
          </h1>
          <SectionPane section={active} />
        </div>
      </section>
    </div>
  );
}
