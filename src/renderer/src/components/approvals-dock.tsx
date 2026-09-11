/**
 * 审批 Dock（Task 13）：命令执行 / 文件变更 / MCP elicitation / 用户输入
 * 四类交互式 serverRequest 的待办卡片，堆叠于聊天区右下角。
 * 其余非交互请求已在主进程 ApprovalRegistry 自动应答。
 */
import { useMemo, useState } from "react";
import { FileDiff, Gavel, ShieldQuestion, Terminal } from "lucide-react";
import { t } from "../i18n/zh.ts";
import { bridge, call } from "../lib/ipc.ts";
import { useApprovalsStore, type PendingApproval } from "../store/approvals.ts";
import { useToastStore } from "../store/toast.ts";
import { useTerminalStore } from "../store/terminal.ts";
import { cn } from "../lib/cn.ts";
import { Button } from "./ui/button.tsx";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

interface QuestionDraft {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[] | null;
  value: string;
}

function CommandCard({ a }: { a: PendingApproval }) {
  const p = (a.params ?? {}) as Record<string, unknown>;
  const resolve = useApprovalsStore((s) => s.remove);
  const toastError = useToastStore((s) => s.error);
  const [busy, setBusy] = useState(false);

  const act = async (decision: "accept" | "acceptForSession" | "decline") => {
    setBusy(true);
    try {
      await call(() => bridge().approvals.resolveCommand({ localId: a.localId, decision }));
      resolve(a.localId);
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-warning/40 bg-surface shadow-lg shadow-shadow">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Terminal className="h-3.5 w-3.5 text-warning" strokeWidth={1.7} />
        <span className="text-xs font-semibold">命令执行请求</span>
        {str(p.reason) && (
          <span className="ml-auto max-w-[220px] truncate text-[10px] text-text-faint">
            {str(p.reason)}
          </span>
        )}
      </header>
      <div className="px-3 py-2">
        <pre className="select-text max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#0d1117] p-2 font-mono text-[11px] text-[#c9d1d9]">
          {str(p.command) || "（未知命令）"}
        </pre>
        {str(p.cwd) && (
          <p className="mt-1 truncate font-mono text-[10px] text-text-faint">{str(p.cwd)}</p>
        )}
      </div>
      <footer className="flex items-center justify-end gap-1.5 px-3 py-2">
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void act("decline")}>
          {t.approvals.decline}
        </Button>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void act("acceptForSession")}>
          {t.approvals.acceptSession}
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void act("accept")}>
          {t.approvals.accept}
        </Button>
      </footer>
    </div>
  );
}

function FileChangeCard({ a }: { a: PendingApproval }) {
  const p = (a.params ?? {}) as Record<string, unknown>;
  const resolve = useApprovalsStore((s) => s.remove);
  const toastError = useToastStore((s) => s.error);
  const [busy, setBusy] = useState(false);

  const act = async (decision: "accept" | "decline") => {
    setBusy(true);
    try {
      await call(() => bridge().approvals.resolveFileChange({ localId: a.localId, decision }));
      resolve(a.localId);
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-warning/40 bg-surface shadow-lg shadow-shadow">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileDiff className="h-3.5 w-3.5 text-warning" strokeWidth={1.7} />
        <span className="text-xs font-semibold">文件变更请求</span>
      </header>
      <div className="px-3 py-2 text-[11px] text-text-muted">
        {str(p.reason) ? <p className="select-text">{str(p.reason)}</p> : <p>Codex 请求写入受保护路径。</p>}
        {str(p.grantRoot) && (
          <p className="mt-1 select-text break-all font-mono text-[10px] text-text-faint">
            写入范围：{str(p.grantRoot)}
          </p>
        )}
      </div>
      <footer className="flex items-center justify-end gap-1.5 px-3 py-2">
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void act("decline")}>
          {t.approvals.decline}
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void act("accept")}>
          {t.approvals.accept}
        </Button>
      </footer>
    </div>
  );
}

function ElicitationCard({ a }: { a: PendingApproval }) {
  const p = (a.params ?? {}) as Record<string, unknown>;
  const resolve = useApprovalsStore((s) => s.remove);
  const toastError = useToastStore((s) => s.error);
  const [busy, setBusy] = useState(false);

  const act = async (action: "accept" | "decline") => {
    setBusy(true);
    try {
      await call(() =>
        bridge().approvals.resolveElicitation({ localId: a.localId, action, content: null }),
      );
      resolve(a.localId);
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const url = str(p.url);
  return (
    <div className="rounded-xl border border-warning/40 bg-surface shadow-lg shadow-shadow">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Gavel className="h-3.5 w-3.5 text-warning" strokeWidth={1.7} />
        <span className="text-xs font-semibold">MCP 服务器请求</span>
        <span className="ml-auto truncate font-mono text-[10px] text-text-faint">{str(p.serverName)}</span>
      </header>
      <div className="px-3 py-2 text-[11px] text-text-muted">
        <p className="select-text">{str(p.message) || "服务器请求补充信息或授权。"}</p>
        {url && (
          <p className="mt-1 select-text break-all font-mono text-[10px] text-text-faint">{url}</p>
        )}
      </div>
      <footer className="flex items-center justify-end gap-1.5 px-3 py-2">
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void act("decline")}>
          {t.approvals.decline}
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void act("accept")}>
          {t.approvals.accept}
        </Button>
      </footer>
    </div>
  );
}

function UserInputCard({ a }: { a: PendingApproval }) {
  const p = (a.params ?? {}) as Record<string, unknown>;
  const resolve = useApprovalsStore((s) => s.remove);
  const toastError = useToastStore((s) => s.error);
  const [busy, setBusy] = useState(false);

  const questions: QuestionDraft[] = useMemo(() => {
    const list = Array.isArray(p.questions) ? p.questions : [];
    return list.map((raw) => {
      const q = (raw ?? {}) as Record<string, unknown>;
      const options = Array.isArray(q.options)
        ? q.options.map((o) => {
            const op = (o ?? {}) as Record<string, unknown>;
            return { label: str(op.label), description: str(op.description) };
          })
        : null;
      return {
        id: str(q.id),
        header: str(q.header),
        question: str(q.question),
        options,
        value: "",
      };
    });
  }, [p]);

  const [drafts, setDrafts] = useState<QuestionDraft[]>(questions);
  const draftsFor = drafts.length === questions.length ? drafts : questions;

  const submit = async () => {
    setBusy(true);
    try {
      const answers: Record<string, { answers: string[] }> = {};
      for (const q of draftsFor) answers[q.id] = { answers: [q.value] };
      await call(() => bridge().approvals.resolveUserInput({ localId: a.localId, answers }));
      resolve(a.localId);
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-accent/40 bg-surface shadow-lg shadow-shadow">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ShieldQuestion className="h-3.5 w-3.5 text-accent" strokeWidth={1.7} />
        <span className="text-xs font-semibold">Codex 需要你的回答</span>
      </header>
      <div className="flex max-h-56 flex-col gap-2 overflow-auto px-3 py-2">
        {draftsFor.map((q, qi) => (
          <div key={q.id || qi}>
            <p className="select-text text-[11px] font-medium text-text">
              {q.header ? `${q.header}：` : ""}
              {q.question}
            </p>
            {q.options && q.options.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {q.options.map((op) => (
                  <button
                    key={op.label}
                    title={op.description}
                    onClick={() =>
                      setDrafts((prev) => {
                        const base = prev.length === draftsFor.length ? prev : draftsFor;
                        return base.map((x) => (x.id === q.id ? { ...x, value: op.label } : x));
                      })
                    }
                    className={`rounded-md border px-2 py-0.5 text-[11px] ${
                      q.value === op.label
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-text-muted hover:bg-hover"
                    }`}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            ) : (
              <input
                value={q.value}
                onChange={(e) =>
                  setDrafts((prev) => {
                    const base = prev.length === draftsFor.length ? prev : draftsFor;
                    return base.map((x) => (x.id === q.id ? { ...x, value: e.target.value } : x));
                  })
                }
                className="mt-1 h-7 w-full select-text rounded-md border border-border bg-surface-2 px-2 text-[11px] focus:border-accent/50 focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>
      <footer className="flex items-center justify-end gap-1.5 px-3 py-2">
        <Button size="sm" variant="primary" loading={busy} onClick={() => void submit()}>
          {t.common.confirm}
        </Button>
      </footer>
    </div>
  );
}

export function ApprovalsDock() {
  const pending = useApprovalsStore((s) => s.pending);
  const terminalOpen = useTerminalStore((s) => s.open);

  if (pending.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute right-4 z-30 flex max-h-[70%] w-[340px] flex-col gap-2 overflow-y-auto transition-[bottom] duration-200",
        terminalOpen ? "bottom-[300px]" : "bottom-3",
      )}
    >
      {pending.map((a) => (
        <div key={a.localId} className="pointer-events-auto">
          {a.method === "item/commandExecution/requestApproval" || a.method === "execCommandApproval" ? (
            <CommandCard a={a} />
          ) : a.method === "item/fileChange/requestApproval" || a.method === "applyPatchApproval" ? (
            <FileChangeCard a={a} />
          ) : a.method === "mcpServer/elicitation/request" ? (
            <ElicitationCard a={a} />
          ) : a.method === "item/tool/requestUserInput" ? (
            <UserInputCard a={a} />
          ) : (
            <div className="rounded-xl border border-warning/40 bg-surface px-3 py-2 text-[11px] text-text-muted shadow-lg shadow-shadow">
              未支持的请求类型：{a.method}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
