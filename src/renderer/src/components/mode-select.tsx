/**
 * 模式选择器（聊天主区顶部/欢迎页/Composer 复用）：
 * - WorkspacePill：工作区过滤（projects store）；
 * - PolicySelect / SandboxSelect：写 Codex 全局 config.toml，对新会话生效；
 *   approval_policy 为对象（granular 自定义）时显示“自定义”且不提供覆盖入口。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Briefcase,
  Check,
  ChevronDown,
  Folder,
  Loader2,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { t } from "../i18n/zh.ts";
import { bridge, call } from "../lib/ipc.ts";
import { useSettingsStore } from "../store/settings.ts";
import { useProjectsStore } from "../store/projects.ts";
import { useToastStore } from "../store/toast.ts";
import { cn } from "../lib/cn.ts";

type ApprovalChoice = "untrusted" | "on-request" | "never";
type SandboxChoice = "read-only" | "workspace-write" | "danger-full-access";

interface ConfigShape {
  config: {
    approval_policy?: string | Record<string, unknown> | null;
    sandbox_mode?: string | null;
  } | null;
}

const APPROVAL_OPTIONS: Array<{ value: ApprovalChoice; label: string }> = [
  { value: "untrusted", label: t.settings.models.approval.untrusted },
  { value: "on-request", label: t.settings.models.approval["on-request"] },
  { value: "never", label: t.settings.models.approval.never },
];

const SANDBOX_OPTIONS: Array<{ value: SandboxChoice; label: string }> = [
  { value: "read-only", label: t.settings.models.sandbox["read-only"] },
  { value: "workspace-write", label: t.settings.models.sandbox["workspace-write"] },
  { value: "danger-full-access", label: t.settings.models.sandbox["danger-full-access"] },
];

function useConfigSlice() {
  const data = useSettingsStore((s) => s.config.data);
  const load = useSettingsStore((s) => s.load);
  useEffect(() => {
    void load("config");
  }, [load]);
  return (data as ConfigShape | null)?.config ?? null;
}

async function writeConfig(keyPath: string, value: unknown): Promise<void> {
  await call(() => bridge().settings.configWrite({ keyPath, value, mergeStrategy: "replace" }));
  await useSettingsStore.getState().load("config", true);
}

/* ---------------- 弹层原语 ---------------- */

function PopoverButton({
  icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  saving = false,
  children,
  title,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  saving?: boolean;
  children: ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:opacity-50",
          open || active
            ? "border-accent/40 bg-accent-soft text-accent"
            : danger
              ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
              : "border-border bg-surface-2 text-text-muted hover:bg-hover hover:text-text",
        )}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
        <span className="max-w-[180px] truncate font-medium">{label}</span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 opacity-70 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 w-56 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-lg shadow-shadow">
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  selected,
  onClick,
  children,
  danger = false,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
        danger
          ? "text-danger hover:bg-danger/10"
          : selected
            ? "bg-accent-soft text-accent"
            : "text-text-muted hover:bg-hover hover:text-text",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

function MenuHint({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1.5 pt-1 text-[10px] leading-relaxed text-text-faint">{children}</p>;
}

/* ---------------- 工作区 ---------------- */

export function WorkspacePill() {
  const items = useProjectsStore((s) => s.items);
  const activeId = useProjectsStore((s) => s.activeId);
  const setActive = useProjectsStore((s) => s.setActive);
  const active = items.find((p) => p.id === activeId) ?? null;

  return (
    <PopoverButton
      icon={<Briefcase className="h-3.5 w-3.5" strokeWidth={1.8} />}
      label={active ? active.name : t.modes.allWorkspaces}
      active={active !== null}
    >
      <MenuItem selected={activeId === null} onClick={() => void setActive(null)}>
        {t.modes.allWorkspaces}
      </MenuItem>
      {items.length > 0 && <div className="my-1 border-t border-border" />}
      {items.map((p) => (
        <MenuItem key={p.id} selected={activeId === p.id} onClick={() => void setActive(p.id)}>
          <Folder className="h-3 w-3 shrink-0 text-text-faint" />
          <span className="truncate">{p.name}</span>
        </MenuItem>
      ))}
    </PopoverButton>
  );
}

/* ---------------- 审批策略 ---------------- */

export function PolicySelect() {
  const cfg = useConfigSlice();
  const toastError = useToastStore((s) => s.error);
  const [saving, setSaving] = useState(false);
  const raw = cfg?.approval_policy;
  const custom = typeof raw === "object" && raw !== null;
  const current = typeof raw === "string" ? (raw as ApprovalChoice) : null;
  const currentLabel = custom
    ? t.modes.policyCustom
    : APPROVAL_OPTIONS.find((o) => o.value === current)?.label ?? t.settings.models.approval["on-request"];

  const choose = async (value: ApprovalChoice) => {
    if (value === current || saving) return;
    setSaving(true);
    try {
      await writeConfig("approval_policy", value);
    } catch (err) {
      toastError(t.settings.models.saveFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PopoverButton
      icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />}
      label={currentLabel}
      saving={saving}
      title={t.modes.policy}
    >
      {APPROVAL_OPTIONS.map((o) => (
        <MenuItem key={o.value} selected={!custom && current === o.value} onClick={() => void choose(o.value)}>
          {o.label}
        </MenuItem>
      ))}
      {custom && (
        <>
          <div className="my-1 border-t border-border" />
          <MenuItem selected onClick={() => undefined}>
            {t.modes.policyCustom}（granular）
          </MenuItem>
        </>
      )}
      <div className="my-1 border-t border-border" />
      <MenuHint>{t.modes.globalHint}</MenuHint>
    </PopoverButton>
  );
}

/* ---------------- 沙箱模式 ---------------- */

export function SandboxSelect({ compact = false }: { compact?: boolean }) {
  const cfg = useConfigSlice();
  const toastError = useToastStore((s) => s.error);
  const [saving, setSaving] = useState(false);
  const current = (cfg?.sandbox_mode as SandboxChoice | null) ?? null;
  const currentLabel =
    SANDBOX_OPTIONS.find((o) => o.value === current)?.label ??
    t.settings.models.sandbox["workspace-write"];
  const danger = current === "danger-full-access";

  const choose = async (value: SandboxChoice) => {
    if (value === current || saving) return;
    setSaving(true);
    try {
      await writeConfig("sandbox_mode", value);
    } catch (err) {
      toastError(t.settings.models.saveFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PopoverButton
      icon={<TerminalSquare className="h-3.5 w-3.5" strokeWidth={1.8} />}
      label={compact ? currentLabel.split(" ")[0] ?? currentLabel : currentLabel}
      saving={saving}
      danger={danger}
      title={t.modes.sandbox}
    >
      {SANDBOX_OPTIONS.map((o) => (
        <MenuItem
          key={o.value}
          selected={current === o.value}
          danger={o.value === "danger-full-access"}
          onClick={() => void choose(o.value)}
        >
          {o.label}
        </MenuItem>
      ))}
      <div className="my-1 border-t border-border" />
      <MenuHint>{t.modes.globalHint}</MenuHint>
    </PopoverButton>
  );
}
