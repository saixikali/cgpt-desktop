import { FolderOpen, RotateCw, TriangleAlert, Unplug, Wrench } from "lucide-react";
import { t } from "../i18n/zh.ts";
import { bridge, call } from "../lib/ipc.ts";
import { useBackendStore } from "../store/backend.ts";
import { useRouterStore } from "../store/router.ts";
import { useToastStore } from "../store/toast.ts";
import { Button } from "./ui/button.tsx";

/** 连续重连超过该次数后，横幅展开为 recovery 操作区。 */
const RECOVERY_ATTEMPTS = 5;

export function BackendBanner() {
  const status = useBackendStore((s) => s.status);
  const restarting = useBackendStore((s) => s.restarting);
  const restart = useBackendStore((s) => s.restart);
  const openSettings = useRouterStore((s) => s.openSettings);
  const state = status?.state;

  if (state !== "reconnecting" && state !== "fatal" && state !== "closed") return null;

  const fatal = state === "fatal";
  const attempts = status?.reconnectAttempts ?? 0;
  const recovery = fatal || attempts >= RECOVERY_ATTEMPTS;

  const openLogs = () => {
    void call(() => bridge().app.openLogsDir()).catch((err) =>
      useToastStore.getState().error(t.banner.openLogsFailed, (err as Error).message),
    );
  };

  return (
    <div
      className={`flex shrink-0 items-center gap-2.5 border-b px-4 py-2 text-xs ${
        recovery || fatal
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-warning/25 bg-warning/10 text-warning"
      }`}
    >
      {fatal ? (
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Unplug className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="selectable truncate">
        {fatal
          ? `${t.banner.fatal}${status?.fatalMessage ? `：${status.fatalMessage}` : ""}`
          : state === "closed"
            ? t.banner.closed
            : recovery
              ? t.banner.retryCount.replace("{count}", String(attempts))
              : t.banner.reconnecting}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {recovery && (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<FolderOpen className="h-3 w-3" />}
              onClick={openLogs}
            >
              {t.banner.openLogs}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Wrench className="h-3 w-3" />}
              onClick={() => openSettings("codex")}
            >
              {t.banner.specifyCodex}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant={fatal ? "dangerSoft" : "secondary"}
          loading={restarting}
          icon={!restarting ? <RotateCw className="h-3 w-3" /> : undefined}
          onClick={() => void restart("用户点击横幅按钮")}
        >
          {t.banner.restart}
        </Button>
      </div>
    </div>
  );
}
