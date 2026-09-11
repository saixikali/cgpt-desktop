/**
 * 设置-配置文件：config/read 的只读视图（生效值 + 配置层来源）。
 */
import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { t } from "../../../i18n/zh.ts";
import { useSettingsStore } from "../../../store/settings.ts";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Card } from "./shared.tsx";

interface ConfigReadShape {
  config: Record<string, unknown> | null;
  layers: Array<{ name?: string; version?: string; disabledReason?: string | null }> | null;
}

function pretty(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function ConfigSection() {
  const config = useSettingsStore((s) => s.config);
  const load = useSettingsStore((s) => s.load);

  useEffect(() => {
    void load("config");
  }, [load]);

  if (config.loading && !config.data) return <Skeleton className="h-64 w-full" />;
  if (config.error) {
    return (
      <Card>
        <p className="text-xs text-danger">{config.error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load("config", true)}>
          {t.settings.config.refresh}
        </Button>
      </Card>
    );
  }

  const data = config.data as ConfigReadShape | null;
  const cfg = data?.config ?? null;
  const entries = cfg ? Object.entries(cfg).filter(([, v]) => v !== null && v !== undefined) : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-xs leading-relaxed text-text-faint">{t.settings.config.hint}</p>

      <Card>
        {entries.length === 0 ? (
          <p className="text-xs text-text-faint">{t.common.empty}</p>
        ) : (
          <dl className="grid grid-cols-[190px_1fr] gap-x-4 gap-y-1.5 text-xs">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="select-text py-0.5 font-mono text-text-faint">{k}</dt>
                <dd className="select-text break-all py-0.5 font-mono text-text-muted">{pretty(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      {data?.layers && data.layers.length > 0 && (
        <Card>
          <p className="mb-2 text-[13px] font-medium text-text">{t.settings.config.layers}</p>
          <div className="flex flex-col gap-1">
            {data.layers.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                <span className="truncate font-mono text-[11px] text-text-muted">{l.name ?? "—"}</span>
                <span className="shrink-0 text-[11px] text-text-faint">{l.version ?? ""}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="px-1">
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load("config", true)}>
          {t.settings.config.refresh}
        </Button>
      </div>
    </div>
  );
}
