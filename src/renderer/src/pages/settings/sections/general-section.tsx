/**
 * 设置-通用：本机偏好（通知开关、关闭行为），即时保存。
 */
import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { t } from "../../../i18n/zh.ts";
import { useSettingsStore } from "../../../store/settings.ts";
import { useToastStore } from "../../../store/toast.ts";
import { Card, Field, Toggle } from "./shared.tsx";
import { cn } from "../../../lib/cn.ts";
import type { LocalPrefs } from "@shared/ipc/contract.ts";

function ThemeSwitch({ value, onChange }: { value: "light" | "dark"; onChange: (v: "light" | "dark") => void }) {
  return (
    <div className="flex rounded-lg border border-border bg-surface-3 p-0.5">
      {(
        [
          { key: "light", label: t.settings.general.themeLight, icon: Sun },
          { key: "dark", label: t.settings.general.themeDark, icon: Moon },
        ] as const
      ).map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors",
            value === key
              ? "bg-surface-2 text-text shadow-sm"
              : "text-text-faint hover:text-text-muted",
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
          {label}
        </button>
      ))}
    </div>
  );
}

export function GeneralSection() {
  const prefs = useSettingsStore((s) => s.prefs);
  const loadPrefs = useSettingsStore((s) => s.loadPrefs);
  const setPrefs = useSettingsStore((s) => s.setPrefs);

  useEffect(() => {
    void loadPrefs().catch(() => undefined);
  }, [loadPrefs]);

  const change = (p: Partial<LocalPrefs>) => {
    void setPrefs(p).catch((err) =>
      useToastStore.getState().error(t.settings.general.saveFailed, (err as Error).message),
    );
  };

  if (!prefs) return null;

  return (
    <Card>
      <Field label={t.settings.general.theme} hint={t.settings.general.themeHint}>
        <ThemeSwitch value={prefs.theme} onChange={(v) => change({ theme: v })} />
      </Field>
      <div className="border-t border-border" />
      <Field label={t.settings.general.notifyTurnCompleted} hint={t.settings.general.notifyTurnCompletedHint}>
        <Toggle checked={prefs.notifyTurnCompleted} onChange={(v) => change({ notifyTurnCompleted: v })} />
      </Field>
      <div className="border-t border-border" />
      <Field label={t.settings.general.notifyApprovals} hint={t.settings.general.notifyApprovalsHint}>
        <Toggle checked={prefs.notifyApprovals} onChange={(v) => change({ notifyApprovals: v })} />
      </Field>
      <div className="border-t border-border" />
      <Field label={t.settings.general.closeToTray} hint={t.settings.general.closeToTrayHint}>
        <Toggle checked={prefs.closeToTray} onChange={(v) => change({ closeToTray: v })} />
      </Field>
    </Card>
  );
}
