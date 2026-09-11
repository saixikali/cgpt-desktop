/**
 * 设置-模型：从 config 读当前值、model/list 取可用模型，
 * 变更经 config/value/write 写入 config.toml（新会话生效）。
 */
import { useEffect, useState } from "react";
import { useSettingsStore } from "../../../store/settings.ts";
import { bridge, call } from "../../../lib/ipc.ts";
import { useToastStore } from "../../../store/toast.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { t } from "../../../i18n/zh.ts";
import { Card, Field, Select } from "./shared.tsx";

interface ModelRow {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
}

interface ConfigShape {
  config: {
    model?: string | null;
    model_reasoning_effort?: string | null;
    approval_policy?: string | Record<string, unknown> | null;
    sandbox_mode?: string | null;
  } | null;
}

type ApprovalChoice = "untrusted" | "on-request" | "never";
type SandboxChoice = "read-only" | "workspace-write" | "danger-full-access";

async function writeConfig(keyPath: string, value: unknown): Promise<void> {
  await call(() =>
    bridge().settings.configWrite({ keyPath, value, mergeStrategy: "replace" }),
  );
}

export function ModelsSection() {
  const models = useSettingsStore((s) => s.models);
  const config = useSettingsStore((s) => s.config);
  const load = useSettingsStore((s) => s.load);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    void load("models");
    void load("config");
  }, [load]);

  if (models.loading && !models.data) return <Skeleton className="h-48 w-full" />;
  if (models.error) {
    return (
      <Card>
        <p className="text-xs text-danger">{models.error}</p>
      </Card>
    );
  }

  // 兼容两种 model/list 返回形状：裸数组 或 { data: ModelRow[] }。
  const modelsPayload = models.data as { data?: ModelRow[] } | ModelRow[] | null;
  const allRows = Array.isArray(modelsPayload)
    ? modelsPayload
    : Array.isArray(modelsPayload?.data)
      ? modelsPayload!.data
      : [];
  const modelRows = allRows.filter((m) => !m.hidden);
  const cfg = (config.data as ConfigShape | null)?.config ?? null;
  const currentModel = cfg?.model ?? null;
  const currentEffort = cfg?.model_reasoning_effort ?? null;
  const approvalRaw = cfg?.approval_policy;
  const currentApproval = typeof approvalRaw === "string" ? (approvalRaw as ApprovalChoice) : null;
  const currentSandbox = (cfg?.sandbox_mode as SandboxChoice | null) ?? null;

  // 推理力度选项跟随所选模型的 supportedReasoningEfforts；无匹配时给通用档位。
  const selected = modelRows.find((m) => m.model === currentModel || m.id === currentModel);
  const effortOptions: Array<{ value: string; label: string }> = (
    selected?.supportedReasoningEfforts ?? [
      { reasoningEffort: "minimal", description: "" },
      { reasoningEffort: "low", description: "" },
      { reasoningEffort: "medium", description: "" },
      { reasoningEffort: "high", description: "" },
    ]
  ).map((e) => ({ value: e.reasoningEffort, label: e.reasoningEffort }));

  const save = async (keyPath: string, value: unknown) => {
    setSaving(keyPath);
    try {
      await writeConfig(keyPath, value);
      useToastStore.getState().success(t.settings.models.saved);
      await load("config", true);
    } catch (err) {
      useToastStore.getState().error(t.settings.models.saveFailed, (err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const configError = config.error;

  return (
    <div className="flex flex-col gap-3">
      {configError && (
        <Card className="border-warning/40">
          <p className="text-xs text-warning">{t.settings.models.configUnavailable}：{configError}</p>
        </Card>
      )}

      <Card>
        <Field label={t.settings.models.defaultModel} hint={t.settings.models.defaultModelHint}>
          <Select
            value={currentModel ?? ""}
            disabled={saving === "model" || modelRows.length === 0}
            onChange={(v) => void save("model", v)}
            options={[
              { value: "", label: modelRows.length === 0 ? "加载中…" : "跟随默认", disabled: true },
              ...modelRows.map((m) => ({
                value: m.model,
                label: `${m.displayName}${m.isDefault ? `（${t.settings.models.current}）` : ""}`,
              })),
            ]}
          />
        </Field>
        {selected?.description && (
          <p className="-mt-1 text-xs leading-relaxed text-text-faint">{selected.description}</p>
        )}
      </Card>

      <Card>
        <Field label={t.settings.models.reasoningEffort} hint={t.settings.models.reasoningEffortHint}>
          <Select
            value={currentEffort ?? ""}
            disabled={saving === "model_reasoning_effort" || effortOptions.length === 0}
            onChange={(v) => void save("model_reasoning_effort", v)}
            options={[
              { value: "", label: "跟随默认", disabled: true },
              ...effortOptions,
            ]}
          />
        </Field>
      </Card>

      <Card>
        <Field label={t.settings.models.approvalPolicy} hint={t.settings.models.approvalPolicyHint}>
          <Select
            value={currentApproval ?? ""}
            disabled={saving === "approval_policy"}
            onChange={(v) => void save("approval_policy", v)}
            options={[
              { value: "", label: "跟随默认", disabled: true },
              { value: "untrusted", label: t.settings.models.approval.untrusted },
              { value: "on-request", label: t.settings.models.approval["on-request"] },
              { value: "never", label: t.settings.models.approval.never },
            ]}
          />
        </Field>
      </Card>

      <Card>
        <Field label={t.settings.models.sandboxMode} hint={t.settings.models.sandboxModeHint}>
          <Select
            value={currentSandbox ?? ""}
            disabled={saving === "sandbox_mode"}
            onChange={(v) => void save("sandbox_mode", v)}
            options={[
              { value: "", label: "跟随默认", disabled: true },
              { value: "read-only", label: t.settings.models.sandbox["read-only"] },
              { value: "workspace-write", label: t.settings.models.sandbox["workspace-write"] },
              { value: "danger-full-access", label: t.settings.models.sandbox["danger-full-access"] },
            ]}
          />
        </Field>
        {currentSandbox === "danger-full-access" && (
          <p className="-mt-1">
            <Badge tone="danger">{t.settings.models.sandbox["danger-full-access"]}</Badge>
          </p>
        )}
      </Card>

      {modelRows.length > 0 && (
        <Card>
          <p className="mb-2 text-[13px] font-medium text-text">{t.settings.models.available}</p>
          <div className="flex flex-col gap-1.5">
            {modelRows.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-text">{m.displayName}</p>
                  <p className="truncate font-mono text-[11px] text-text-faint">{m.model}</p>
                </div>
                {m.isDefault && <Badge tone="accent">{t.settings.models.current}</Badge>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
