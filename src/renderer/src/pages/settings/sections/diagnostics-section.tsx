/**
 * 设置-诊断：app-server 运行指标、`codex doctor` 自检输出、诊断日志 zip 导出。
 */
import { useEffect } from "react";
import { Download, Stethoscope } from "lucide-react";
import { t } from "../../../i18n/zh.ts";
import { useSettingsStore } from "../../../store/settings.ts";
import { useToastStore } from "../../../store/toast.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { Card, Field } from "./shared.tsx";

interface DiagnosticsShape {
  process?: Record<string, unknown> | null;
  gauges?: Array<{ name?: string; value?: unknown; description?: string }> | null;
}

export function DiagnosticsSection() {
  const diag = useSettingsStore((s) => s.diagnostics);
  const load = useSettingsStore((s) => s.load);
  const doctor = useSettingsStore((s) => s.doctor);
  const runDoctor = useSettingsStore((s) => s.runDoctor);
  const exporting = useSettingsStore((s) => s.exportingLogs);
  const exportLogs = useSettingsStore((s) => s.exportLogs);

  useEffect(() => {
    void load("diagnostics");
  }, [load]);

  const doExport = async () => {
    try {
      const path = await exportLogs();
      if (path) useToastStore.getState().success(t.settings.diagnostics.exportDone.replace("{path}", path));
    } catch (err) {
      useToastStore.getState().error(t.settings.diagnostics.exportFailed, (err as Error).message);
    }
  };

  if (diag.loading && !diag.data) return <Skeleton className="h-40 w-full" />;

  const data = diag.data as DiagnosticsShape | null;
  const gauges = data?.gauges ?? [];

  return (
    <div className="flex flex-col gap-3">
      {diag.error ? (
        <Card>
          <p className="text-xs text-text-faint">app-server 诊断不可用：{diag.error}</p>
        </Card>
      ) : (
        <Card>
          <Field label={t.settings.diagnostics.process}>
            <Button size="sm" variant="ghost" onClick={() => void load("diagnostics", true)}>
              {t.settings.diagnostics.refresh}
            </Button>
          </Field>
          {data?.process && (
            <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-border bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-text-muted select-text">
              {JSON.stringify(data.process, null, 2)}
            </pre>
          )}
          {gauges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {gauges.map((g, i) => (
                <Badge key={i} tone="neutral">
                  {g.name}: {String(g.value ?? "")}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card>
        <Field
          label={t.settings.diagnostics.doctor}
          hint={doctor.running ? t.settings.diagnostics.doctorRunning : doctor.result ? `${t.settings.diagnostics.doctorExit}: ${doctor.result.code}` : undefined}
        >
          <Button size="sm" variant="secondary" loading={doctor.running} icon={<Stethoscope className="h-3.5 w-3.5" />} onClick={() => void runDoctor()}>
            {t.settings.diagnostics.doctor}
          </Button>
        </Field>
        {doctor.result && (
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-text-muted select-text">
            {doctor.result.output || "（无输出）"}
          </pre>
        )}
      </Card>

      <Card>
        <Field label={t.settings.diagnostics.exportLogs} hint={exporting ? t.settings.diagnostics.exporting : undefined}>
          <Button size="sm" variant="secondary" loading={exporting} icon={<Download className="h-3.5 w-3.5" />} onClick={() => void doExport()}>
            {t.settings.diagnostics.exportLogs}
          </Button>
        </Field>
      </Card>
    </div>
  );
}
