/**
 * 设置-Codex CLI：当前解析结果（路径/版本/来源）、手动指定或恢复自动检测
 * （主进程会先 --version 探活再重启后端），以及 `codex update` 实时输出。
 */
import { useState } from "react";
import { FolderOpen, RotateCcw, Undo2 } from "lucide-react";
import { t } from "../../../i18n/zh.ts";
import { bridge, call } from "../../../lib/ipc.ts";
import { useBackendStore } from "../../../store/backend.ts";
import { useSettingsStore } from "../../../store/settings.ts";
import { useToastStore } from "../../../store/toast.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Card, Field } from "./shared.tsx";

export function CodexCliSection() {
  const backendStatus = useBackendStore((s) => s.status);
  const cliUpdate = useSettingsStore((s) => s.cliUpdate);
  const startCliUpdate = useSettingsStore((s) => s.startCliUpdate);
  const [busy, setBusy] = useState(false);

  const codex = backendStatus?.codex ?? null;
  const updating = cliUpdate.running;

  const pickOverride = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const path = await call<string | null>(() => bridge().app.pickFile({ title: t.settings.codexCli.changePath }));
      if (!path) return;
      await call(() => bridge().backend.setCodexOverride({ path }));
      useToastStore.getState().success(t.settings.codexCli.restartHint);
    } catch (err) {
      useToastStore.getState().error(t.settings.codexCli.invalidPath, (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetOverride = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await call(() => bridge().backend.setCodexOverride({ path: null }));
      useToastStore.getState().success(t.settings.codexCli.restartHint);
    } catch (err) {
      useToastStore.getState().error(t.toast.actionFailed, (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restartBackend = async () => {
    try {
      await call(() => bridge().backend.restart({ reason: "设置页手动重启" }));
    } catch (err) {
      useToastStore.getState().error(t.toast.actionFailed, (err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <Field label={t.settings.codexCli.path}>
          <span className="max-w-72 truncate font-mono text-xs text-text-muted" title={codex?.path ?? ""}>
            {codex?.path ?? "-"}
          </span>
        </Field>
        <Field label={t.settings.codexCli.version}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-muted">{codex?.version ?? "-"}</span>
            {codex && (
              <Badge tone={codex.source === "override" ? "accent" : "neutral"}>
                {codex.source === "override" ? t.settings.codexCli.sourceOverride : `${t.settings.codexCli.sourceAuto} · ${codex.source}`}
              </Badge>
            )}
          </div>
        </Field>
        <p className="mt-1 text-xs leading-relaxed text-text-faint">{t.settings.codexCli.restartHint}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" disabled={busy} icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void pickOverride()}>
            {t.settings.codexCli.changePath}
          </Button>
          {codex?.source === "override" && (
            <Button size="sm" variant="ghost" disabled={busy} icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => void resetOverride()}>
              {t.settings.codexCli.resetPath}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void restartBackend()}>
            {t.settings.codexCli.restart}
          </Button>
        </div>
      </Card>

      <Card>
        <Field label={t.settings.codexCli.update} hint={updating ? t.settings.codexCli.updating : undefined}>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={updating} onClick={() => void startCliUpdate()}>
              {updating ? t.settings.codexCli.updating : t.settings.codexCli.update}
            </Button>
            {updating && (
              <Button
                size="sm"
                variant="dangerSoft"
                onClick={() => void call(() => bridge().settings.cliUpdateCancel(undefined))}
              >
                取消更新
              </Button>
            )}
          </div>
        </Field>
        {(updating || cliUpdate.output) && (
          <div className="mt-2">
            <p className="mb-1 text-[11px] text-text-faint">{t.settings.codexCli.updateOutput}</p>
            <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-text-muted select-text">
              {cliUpdate.output || "…"}
            </pre>
          </div>
        )}
        {!updating && cliUpdate.exitCode !== null && (
          <p className="mt-2 text-xs text-text-muted">
            {cliUpdate.exitCode === 0
              ? t.settings.codexCli.updateDone.replace("{code}", String(cliUpdate.exitCode))
              : t.settings.codexCli.updateDoneGeneric.replace("{code}", String(cliUpdate.exitCode))}
          </p>
        )}
      </Card>
    </div>
  );
}
