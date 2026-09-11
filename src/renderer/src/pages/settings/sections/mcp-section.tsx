/**
 * 设置-MCP 服务：mcpServerStatus/list 展示各服务器连接状态与工具数，支持重载配置。
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { t } from "../../../i18n/zh.ts";
import { bridge, call } from "../../../lib/ipc.ts";
import { useSettingsStore } from "../../../store/settings.ts";
import { useToastStore } from "../../../store/toast.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { Card } from "./shared.tsx";

interface McpStatusRow {
  name: string;
  runtimeStatus: string | null;
  authStatus: string | null;
  tools: Record<string, unknown> | null;
  serverInfo: { name?: string; version?: string } | null;
}

export function McpSection() {
  const mcp = useSettingsStore((s) => s.mcp);
  const load = useSettingsStore((s) => s.load);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    void load("mcp");
  }, [load]);

  const reload = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await call(() => bridge().settings.mcpReload());
      await load("mcp", true);
    } catch (err) {
      useToastStore.getState().error(t.settings.mcp.reloadFailed, (err as Error).message);
    } finally {
      setReloading(false);
    }
  };

  if (mcp.loading && !mcp.data) return <Skeleton className="h-40 w-full" />;
  if (mcp.error) {
    return (
      <Card>
        <p className="text-xs text-danger">{mcp.error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load("mcp", true)}>
          {t.common.retry}
        </Button>
      </Card>
    );
  }

  const rows = (mcp.data as { data?: McpStatusRow[] } | null)?.data ?? [];

  const statusBadge = (r: McpStatusRow) => {
    // runtimeStatus: notStarted|starting|connected|authenticationRequired|failed|cancelled|disabled
    const s = r.runtimeStatus;
    if (s === "connected") return <Badge tone="success">{t.settings.mcp.connected}</Badge>;
    if (s === "starting") return <Badge tone="neutral">{t.settings.mcp.starting}</Badge>;
    if (s === "authenticationRequired") return <Badge tone="warning">{t.settings.mcp.needsAuth}</Badge>;
    if (s === "failed") return <Badge tone="danger">{t.settings.mcp.failed}</Badge>;
    if (s === null) return <Badge tone="neutral">—</Badge>;
    // authStatus: unknown|unsupported|notLoggedIn|bearerToken|oAuth
    if (r.authStatus === "notLoggedIn") return <Badge tone="warning">{t.settings.mcp.needsAuth}</Badge>;
    return <Badge tone="neutral">{s}</Badge>;
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-xs leading-relaxed text-text-faint">{t.settings.mcp.hint}</p>

      {rows.length === 0 ? (
        <Card>
          <p className="text-[13px] font-medium text-text-muted">{t.settings.mcp.noServers}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-faint">{t.settings.mcp.noServersHint}</p>
        </Card>
      ) : (
        rows.map((r) => (
          <Card key={r.name}>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate font-mono text-[13px] font-medium text-text">{r.name}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                {statusBadge(r)}
                <Badge tone="neutral">{t.settings.mcp.tools.replace("{count}", String(Object.keys(r.tools ?? {}).length))}</Badge>
              </div>
            </div>
            {r.serverInfo && (r.serverInfo.name || r.serverInfo.version) && (
              <p className="mt-1 font-mono text-[11px] text-text-faint">
                {[r.serverInfo.name, r.serverInfo.version].filter(Boolean).join(" · ")}
              </p>
            )}
          </Card>
        ))
      )}

      <div className="px-1">
        <Button size="sm" variant="ghost" loading={reloading} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void reload()}>
          {t.settings.mcp.reload}
        </Button>
      </div>
    </div>
  );
}
