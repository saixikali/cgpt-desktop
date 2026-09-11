/**
 * 聊天输入区：
 *  - Enter 发送 / Shift+Enter 换行（IME 组合中不触发）
 *  - 无会话时以当前工作区根目录自动建会话
 *  - turn/start 支持当轮 model / effort 覆盖（AC-8）
 *  - 流式进行中可"追加"输入（turn/steer，AC-5）或"停止"（turn/interrupt）
 *  - 支持附加本地图片（localImage）
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Send, Square } from "lucide-react";
import { t } from "../../i18n/zh.ts";
import { bridge, call } from "../../lib/ipc.ts";
import { useApprovalsStore } from "../../store/approvals.ts";
import { useProjectsStore } from "../../store/projects.ts";
import { useSettingsStore } from "../../store/settings.ts";
import { useThreadViewStore } from "../../store/thread-view.ts";
import { useThreadsStore } from "../../store/threads.ts";
import { useToastStore } from "../../store/toast.ts";
import { useTurnOverridesStore } from "../../store/turn-overrides.ts";

interface AttachedImage {
  path: string;
  /** data URL 预览，读取失败时仅显示文件名。 */
  preview: string | null;
}

interface ModelRow {
  id: string;
  model: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string }>;
}

function AttachedChip({ img, onRemove }: { img: AttachedImage; onRemove: () => void }) {
  return (
    <div className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-3">
      {img.preview ? (
        <img src={img.preview} alt={img.path} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center p-1 text-center text-[9px] leading-tight text-text-faint">
          {img.path.split(/[\\/]/).pop()}
        </span>
      )}
      <button
        onClick={onRemove}
        className="absolute inset-x-0 bottom-0 hidden bg-black/60 py-0.5 text-center text-[9px] text-white group-hover:block"
      >
        移除
      </button>
    </div>
  );
}

/** 读取本地图片为 data URL 预览（走 fs 白名单，失败不影响发送）。 */
async function readPreview(path: string): Promise<string | null> {
  try {
    const r = await call<{ dataBase64: string }>(() => bridge().fs.readFile({ path }));
    const ext = path.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    return `data:${mime};base64,${r.dataBase64}`;
  } catch {
    return null;
  }
}

const FALLBACK_EFFORTS = ["minimal", "low", "medium", "high"];

export function Composer() {
  const threadId = useThreadViewStore((s) => s.threadId);
  const streaming = useThreadViewStore((s) => s.streaming);
  const open = useThreadViewStore((s) => s.open);
  const startThread = useThreadsStore((s) => s.start);
  const toastError = useToastStore((s) => s.error);

  const activeProject = useProjectsStore((s) => s.items.find((p) => p.id === s.activeId) ?? null);

  // 当轮模型/推理力度覆盖（按会话记忆；新会话用 pending）。
  const overrides = useTurnOverridesStore((s) =>
    threadId ? (s.byThread[threadId] ?? s.pending) : s.pending,
  );
  const setModelOverride = useTurnOverridesStore((s) => s.setModel);
  const setEffortOverride = useTurnOverridesStore((s) => s.setEffort);

  const modelsSlice = useSettingsStore((s) => s.models);
  const loadSettings = useSettingsStore((s) => s.load);
  useEffect(() => {
    void loadSettings("models");
  }, [loadSettings]);
  const modelRows: ModelRow[] = (() => {
    // 兼容两种 model/list 返回形状：裸数组 或 { data: ModelRow[] }。
    const d = (modelsSlice.data as { data?: ModelRow[] } | ModelRow[] | null) ?? null;
    const rows = Array.isArray(d) ? d : Array.isArray(d?.data) ? d!.data : [];
    return rows.filter((m) => !m.hidden);
  })();
  const selectedModelRow = modelRows.find((m) => m.model === overrides.model);
  const effortOptions = (selectedModelRow?.supportedReasoningEfforts?.length
    ? selectedModelRow!.supportedReasoningEfforts.map((e) => e.reasoningEffort)
    : FALLBACK_EFFORTS
  );

  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const composing = useRef(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const send = async () => {
    const body = text.trim();
    if ((!body && images.length === 0) || busy || streaming) return;
    setBusy(true);
    const sentText = body;
    const sentImages = images;
    try {
      let tid = threadId;
      if (!tid) {
        let cwd = activeProject?.roots[0] ?? null;
        if (!cwd) {
          cwd = await call<string | null>(() => bridge().app.pickDirectory(undefined));
          if (!cwd) return;
        }
        tid = await startThread(cwd, activeProject?.id ?? null);
        // 建会话前选择的当轮覆盖挂到新会话上。
        useTurnOverridesStore.getState().adoptPending(tid);
        await open(tid);
      }

      const input: Record<string, unknown>[] = [];
      if (sentText) input.push({ type: "text", text: sentText, text_elements: [] });
      for (const img of sentImages) input.push({ type: "localImage", path: img.path });

      const ov = useTurnOverridesStore.getState().get(tid);

      // turn/start 随流式通知结束才返回：立即清空输入，异步等待结果。
      // 失败时回填草稿，避免丢失用户输入。
      void call(() =>
        bridge().turn.start({
          threadId: tid,
          input,
          ...(ov.model ? { model: ov.model } : {}),
          ...(ov.effort ? { effort: ov.effort } : {}),
        }),
      ).catch((err) => {
        toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
        setText((prev) => prev || sentText);
        setImages((prev) => (prev.length > 0 ? prev : sentImages));
      });
      setText("");
      setImages([]);
      taRef.current?.focus();
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** 流式过程中向当前回合追加指令（turn/steer，AC-5）。 */
  const steer = async () => {
    const body = text.trim();
    if (!body || busy || !threadId) return;
    const expectedTurnId = useThreadViewStore.getState().activeTurnId;
    if (!expectedTurnId) {
      toastError("无法追加", "当前没有进行中的回合");
      return;
    }
    setBusy(true);
    const sentText = body;
    try {
      await call(() =>
        bridge().turn.steer({
          threadId,
          expectedTurnId,
          input: [{ type: "text", text: sentText, text_elements: [] }],
        }),
      );
      setText("");
      taRef.current?.focus();
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
      setText((prev) => prev || sentText);
    } finally {
      setBusy(false);
    }
  };

  const interrupt = async () => {
    if (!threadId) return;
    try {
      // 挂起的审批先取消，否则 codex 在等审批响应、回合不会结束。
      // threadId 未知的挂起卡片也一并尝试取消（嵌套参数审批可能不携带 threadId）。
      const pending = useApprovalsStore
        .getState()
        .pending.filter((a) => !a.threadId || a.threadId === threadId);
      for (const a of pending) {
        try {
          if (a.method === "mcpServer/elicitation/request") {
            await call(() =>
              bridge().approvals.resolveElicitation({ localId: a.localId, action: "cancel" }),
            );
          } else if (a.method === "item/tool/requestUserInput") {
            await call(() =>
              bridge().approvals.respondError({
                localId: a.localId,
                code: -32000,
                message: "用户中断了回合",
              }),
            );
          } else if (
            a.method === "item/fileChange/requestApproval" ||
            a.method === "applyPatchApproval"
          ) {
            await call(() =>
              bridge().approvals.resolveFileChange({ localId: a.localId, decision: "cancel" }),
            );
          } else {
            await call(() =>
              bridge().approvals.resolveCommand({ localId: a.localId, decision: "cancel" }),
            );
          }
          useApprovalsStore.getState().remove(a.localId);
        } catch {
          /* 单个审批取消失败不阻断中断 */
        }
      }
      await call(() => bridge().turn.interrupt({ threadId }));
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    }
  };

  const attachImages = async () => {
    try {
      const picked = await call<string | null>(() =>
        bridge().app.pickFile({
          title: "选择图片",
          filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
        }),
      );
      if (!picked) return;
      const preview = await readPreview(picked);
      setImages((prev) =>
        prev.some((x) => x.path === picked) ? prev : [...prev, { path: picked, preview }],
      );
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || composing.current || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void (streaming ? steer() : send());
  };

  const selectCls =
    "max-w-40 truncate rounded-md border border-border bg-surface-2 px-1.5 py-1 text-[11px] text-text-faint focus:outline-none disabled:opacity-50";

  return (
    <footer className="shrink-0 border-t border-border bg-surface p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {images.length > 0 && (
          <div className="flex gap-2">
            {images.map((img) => (
              <AttachedChip
                key={img.path}
                img={img}
                onRemove={() => setImages((prev) => prev.filter((x) => x.path !== img.path))}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5" title="仅作用于本会话的回合覆盖，不影响设置页全局默认">
          <span className="text-[11px] text-text-faint">当轮</span>
          <select
            className={selectCls}
            value={overrides.model ?? ""}
            disabled={modelRows.length === 0}
            onChange={(e) => {
              setModelOverride(threadId, e.target.value || null);
              // 切换模型后旧 effort 可能不在新模型支持列表内，重置为跟随默认。
              setEffortOverride(threadId, null);
            }}
          >
            <option value="">模型：跟随默认</option>
            {modelRows.map((m) => (
              <option key={m.id} value={m.model}>
                {m.displayName}
                {m.isDefault ? "（默认）" : ""}
              </option>
            ))}
          </select>
          <select
            className={selectCls}
            value={overrides.effort ?? ""}
            onChange={(e) => setEffortOverride(threadId, e.target.value || null)}
          >
            <option value="">推理力度：跟随默认</option>
            {effortOptions.map((eff) => (
              <option key={eff} value={eff}>
                {eff}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-2 p-2 focus-within:border-accent/50">
          <button
            title="附加图片"
            onClick={() => void attachImages()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
          >
            <ImagePlus className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            placeholder={streaming ? "向进行中的回合追加指令（Enter 发送）" : t.chat.inputPlaceholder}
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-relaxed text-text placeholder:text-text-faint focus:outline-none"
          />
          {streaming ? (
            <>
              <button
                title="追加到当前回合"
                onClick={() => void steer()}
                disabled={busy || !text.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-opacity hover:bg-[#5d99ff] disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                title={t.chat.stop}
                onClick={() => void interrupt()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/15 text-red-300 hover:bg-danger/25"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            </>
          ) : (
            <button
              title={t.chat.send}
              onClick={() => void send()}
              disabled={busy || (!text.trim() && images.length === 0)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-opacity hover:bg-[#5d99ff] disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
