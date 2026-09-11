import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ellipsis,
  FolderGit2,
  FolderPlus,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { t } from "../../i18n/zh.ts";
import { bridge, call } from "../../lib/ipc.ts";
import { useBackendStore } from "../../store/backend.ts";
import { useProjectsStore } from "../../store/projects.ts";
import { useThreadsStore } from "../../store/threads.ts";
import { useThreadViewStore } from "../../store/thread-view.ts";
import { useToastStore } from "../../store/toast.ts";
import { formatTime, truncate } from "../../lib/format.ts";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { EmptyState, ErrorState } from "../../components/ui/empty-state.tsx";
import { ScrollArea } from "../../components/ui/scroll-area.tsx";
import { SkeletonRows } from "../../components/ui/skeleton.tsx";

const STATUS_TONE: Record<string, "success" | "warning" | "accent" | "neutral"> = {
  idle: "neutral",
  completed: "success",
  waiting_for_input: "warning",
  running: "accent",
};

const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");

function underRoots(cwd: string | null, roots: string[]): boolean {
  if (!cwd || roots.length === 0) return false;
  const c = norm(cwd);
  return roots.some((r) => {
    const root = norm(r);
    return c === root || c.startsWith(`${root}\\`);
  });
}

/* ================= 工作区选择器 ================= */

function WorkspaceBar() {
  const { items, activeId, loading, error } = useProjectsStore();
  const setActive = useProjectsStore((s) => s.setActive);
  const refreshProjects = useProjectsStore((s) => s.refresh);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const active = items.find((p) => p.id === activeId) ?? null;

  return (
    <div className="relative shrink-0 border-b border-border px-2 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors",
          open ? "bg-hover text-text" : "text-text-muted hover:bg-hover hover:text-text",
        )}
      >
        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.7} />
        <span className="truncate font-medium">{active ? active.name : t.projects.all}</span>
        {loading && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-text-faint" />}
        <span
          className={cn(
            "ml-auto shrink-0 text-[9px] text-text-faint transition-transform",
            open && "rotate-180",
          )}
        >
          ▼
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />
          <div className="absolute inset-x-2 top-full z-30 mt-1 flex max-h-80 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/40">
            <ScrollArea className="max-h-60">
              <div className="flex flex-col gap-0.5 p-1.5">
                {error && (
                  <p className="px-2 py-1.5 text-[11px] text-red-300">
                    {t.projects.error}
                    <button
                      className="ml-1 underline"
                      onClick={() => void refreshProjects()}
                    >
                      {t.common.retry}
                    </button>
                  </p>
                )}
                <button
                  onClick={() => {
                    void setActive(null);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                    activeId === null ? "bg-accent-soft text-accent" : "hover:bg-hover",
                  )}
                >
                  <Square className="h-2.5 w-2.5 shrink-0 fill-current" strokeWidth={0} />
                  {t.projects.all}
                </button>
                {items.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
                      activeId === p.id ? "bg-accent-soft" : "hover:bg-hover",
                    )}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => {
                        void setActive(p.id);
                        setOpen(false);
                      }}
                    >
                      <span
                        className={cn(
                          "truncate",
                          activeId === p.id ? "text-accent" : "text-text-muted",
                        )}
                      >
                        {p.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-text-faint">
                        {p.roots.length > 0 ? p.roots.length : t.projects.noRoot}
                      </span>
                    </button>
                    <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                      <button
                        title={t.projects.rename}
                        className="rounded p-1 text-text-faint hover:bg-surface-3 hover:text-text"
                        onClick={() => {
                          setRenameTarget({ id: p.id, name: p.name });
                          setOpen(false);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        title={t.projects.delete}
                        className="rounded p-1 text-text-faint hover:bg-danger/15 hover:text-red-300"
                        onClick={() => {
                          setDeleteTarget({ id: p.id, name: p.name });
                          setOpen(false);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                ))}
                {!error && items.length === 0 && (
                  <p className="px-2 py-1.5 text-[11px] text-text-faint">{t.projects.empty}</p>
                )}
              </div>
            </ScrollArea>
            <button
              className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-text-muted hover:bg-hover hover:text-text"
              onClick={() => {
                setCreateOpen(true);
                setOpen(false);
              }}
            >
              <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.7} />
              {t.projects.create}
            </button>
          </div>
        </>
      )}

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <RenameProjectDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
      />
      <DeleteProjectDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ================= 工作区对话框 ================= */

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useProjectsStore((s) => s.create);
  const toastError = useToastStore((s) => s.error);
  const [name, setName] = useState("");
  const [roots, setRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setRoots([]);
      setBusy(false);
    }
  }, [open]);

  const addRoot = async () => {
    try {
      const picked = await call<string | null>(() => bridge().app.pickDirectory(undefined));
      if (picked && !roots.includes(picked)) setRoots((r) => [...r, picked]);
    } catch (err) {
      toastError(t.wizard.dirPickFailed, err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async () => {
    if (roots.length === 0 || busy) return;
    setBusy(true);
    try {
      await create(name, roots);
      onClose();
    } catch (err) {
      toastError(t.projects.createFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.projects.create}
      width={460}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={roots.length === 0}
            onClick={() => void submit()}
          >
            {busy ? t.projects.creating : t.projects.createConfirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] text-text-faint">{t.projects.createName}</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.projects.createNamePlaceholder}
            maxLength={200}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-faint">{t.projects.roots}</span>
            <Button
              variant="secondary"
              size="sm"
              icon={<FolderPlus className="h-3.5 w-3.5" />}
              onClick={() => void addRoot()}
            >
              {t.projects.addRoot}
            </Button>
          </div>
          {roots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-text-faint">
              {t.projects.emptyHint}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {roots.map((r) => (
                <div
                  key={r}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5"
                >
                  <span className="select-text truncate font-mono text-[11px] text-text-muted">
                    {r}
                  </span>
                  <button
                    className="ml-auto rounded p-0.5 text-text-faint hover:text-red-300"
                    onClick={() => setRoots((list) => list.filter((x) => x !== r))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RenameProjectDialog({
  target,
  onClose,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const rename = useProjectsStore((s) => s.rename);
  const toastError = useToastStore((s) => s.error);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setBusy(false);
    }
  }, [target]);

  const submit = async () => {
    if (!target || !name.trim() || busy) return;
    setBusy(true);
    try {
      await rename(target.id, name);
      onClose();
    } catch (err) {
      toastError(t.projects.renameFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={t.projects.rename}
      width={400}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
            {t.projects.renameConfirm}
          </Button>
        </>
      }
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
    </Dialog>
  );
}

function DeleteProjectDialog({
  target,
  onClose,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const remove = useProjectsStore((s) => s.remove);
  const toastError = useToastStore((s) => s.error);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await remove(target.id);
      onClose();
    } catch (err) {
      toastError(t.projects.deleteFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={t.projects.delete}
      width={400}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="danger" size="sm" loading={busy} onClick={() => void submit()}>
            {t.projects.deleteConfirm}
          </Button>
        </>
      }
    >
      <p className="text-xs leading-relaxed text-text-muted">
        {target?.name ? `「${target.name}」— ` : ""}
        {t.projects.deleteHint}
      </p>
    </Dialog>
  );
}

/* ================= 会话条目菜单 ================= */

function ThreadItemMenu({ threadId, archived }: { threadId: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const rename = useThreadsStore((s) => s.rename);
  const setArchived = useThreadsStore((s) => s.setArchived);
  const remove = useThreadsStore((s) => s.remove);
  const toastError = useToastStore((s) => s.error);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toastError(t.threadMenu.failed, err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <button
        title={t.threadMenu.title}
        className={cn(
          "hidden h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint hover:bg-surface-3 hover:text-text group-hover:flex",
          open && "flex bg-surface-3 text-text",
        )}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Ellipsis className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} />
          <div className="absolute right-1.5 top-7 z-40 flex w-36 flex-col gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-xl shadow-black/40">
            <button
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-hover hover:text-text"
              onClick={() => {
                setOpen(false);
                setDraft("");
                setRenameOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t.threadMenu.rename}
            </button>
            <button
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-hover hover:text-text"
              onClick={() => {
                setOpen(false);
                void guard(() => setArchived(threadId, !archived));
              }}
            >
              <Square className="h-3 w-3" />
              {archived ? t.threadMenu.unarchive : t.threadMenu.archive}
            </button>
            <button
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-red-300 hover:bg-danger/15"
              onClick={() => {
                setOpen(false);
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.threadMenu.delete}
            </button>
          </div>
        </>
      )}

      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title={t.threadMenu.rename}
        width={400}
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setRenameOpen(false);
              void guard(() => rename(threadId, draft));
            }}
          >
            {t.common.save}
          </Button>
        }
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.threadMenu.renameHint}
          maxLength={200}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              setRenameOpen(false);
              void guard(() => rename(threadId, draft));
            }
          }}
        />
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t.threadMenu.delete}
        width={400}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setDeleteOpen(false);
                void guard(() => remove(threadId));
              }}
            >
              {t.threadMenu.deleteConfirm}
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-text-muted">{t.threadMenu.deleteHint}</p>
      </Dialog>
    </>
  );
}

/* ================= 主列表 ================= */

export function ThreadList() {
  const { items, loading, loadingMore, searching, error, initialized, query, nextCursor } =
    useThreadsStore();
  const refresh = useThreadsStore((s) => s.refresh);
  const search = useThreadsStore((s) => s.search);
  const loadMore = useThreadsStore((s) => s.loadMore);
  const startThread = useThreadsStore((s) => s.start);
  const activeId = useThreadViewStore((s) => s.threadId);
  const open = useThreadViewStore((s) => s.open);
  const backendReady = useBackendStore((s) => s.status?.state === "ready");
  const toastError = useToastStore((s) => s.error);

  // 工作区过滤：选中工作区时仅显示其 roots 下的会话。
  const { items: projects, activeId: activeProjectId } = useProjectsStore();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const pickLock = useRef(false);

  useEffect(() => {
    if (backendReady && !initialized) void refresh();
  }, [backendReady, initialized, refresh]);

  useEffect(() => {
    const q = draft.trim();
    const id = setTimeout(() => {
      if (q !== query) void search(q);
    }, 300);
    return () => clearTimeout(id);
  }, [draft, query, search]);

  const visible = useMemo(() => {
    if (!activeProject) return items;
    return items.filter((th) => underRoots(th.cwd, activeProject.roots));
  }, [items, activeProject]);

  const newThread = async () => {
    if (creating || pickLock.current) return;
    try {
      let cwd: string | null = activeProject?.roots[0] ?? null;
      if (!cwd) {
        pickLock.current = true;
        cwd = await call<string | null>(() => bridge().app.pickDirectory(undefined));
        pickLock.current = false;
        if (!cwd) return;
      }
      setCreating(true);
      const id = await startThread(cwd, activeProject?.id ?? null);
      await open(id);
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
      pickLock.current = false;
    }
  };

  const body = useMemo(() => {
    if (loading && !initialized) return <SkeletonRows rows={8} />;
    if (error && items.length === 0) {
      return <ErrorState message={t.threads.error} onRetry={() => void refresh()} />;
    }
    if (initialized && visible.length === 0) {
      return (
        <EmptyState
          icon={<MessageSquarePlus className="h-5 w-5" strokeWidth={1.6} />}
          title={
            query
              ? `没有找到与“${truncate(query, 20)}”相关的会话`
              : activeProject
                ? t.threads.empty
                : t.threads.empty
          }
          hint={query ? undefined : t.threads.emptyHint}
        />
      );
    }
    return (
      <ScrollArea
        className="flex-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 60 && nextCursor && !loadingMore) {
            void loadMore();
          }
        }}
      >
        <div className="flex flex-col gap-0.5 p-1.5">
          {visible.map((th) => (
            <div
              key={th.id}
              className={cn(
                "group relative flex cursor-pointer flex-col items-start gap-1 rounded-lg px-2.5 py-2 transition-colors",
                activeId === th.id ? "bg-accent-soft" : "hover:bg-hover",
              )}
              onClick={() => void open(th.id)}
            >
              <div className="flex w-full items-center gap-1.5">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px] font-medium",
                    activeId === th.id ? "text-text" : "text-text-muted group-hover:text-text",
                  )}
                >
                  {th.name || th.preview || "未命名会话"}
                </span>
                {th.status && STATUS_TONE[th.status] && (
                  <Badge tone={STATUS_TONE[th.status]} className="shrink-0">
                    {th.status === "running" && (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    )}
                    {th.status}
                  </Badge>
                )}
                {th.archived && (
                  <Badge tone="neutral" className="shrink-0">
                    {t.threads.archived}
                  </Badge>
                )}
                <ThreadItemMenu threadId={th.id} archived={th.archived} />
              </div>
              <div className="flex w-full items-center gap-2 text-[11px] text-text-faint">
                <span className="truncate">{th.cwd ?? ""}</span>
                <span className="ml-auto shrink-0">{formatTime(th.updatedAt)}</span>
              </div>
            </div>
          ))}
          {loadingMore && (
            <div className="flex justify-center py-2 text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
        </div>
      </ScrollArea>
    );
  }, [
    activeId,
    activeProject,
    error,
    initialized,
    items,
    loading,
    loadingMore,
    nextCursor,
    open,
    query,
    refresh,
    loadMore,
    visible,
  ]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface">
      <WorkspaceBar />
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.threads.searchPlaceholder}
            className="h-8 w-full select-text rounded-lg border border-border bg-surface-2 pl-8 pr-2 text-xs text-text placeholder:text-text-faint focus:border-accent/50 focus:outline-none"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-faint" />
          )}
        </div>
        <button
          title={t.common.newThread}
          onClick={() => void newThread()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquarePlus className="h-[18px] w-[18px]" strokeWidth={1.7} />
          )}
        </button>
      </div>
      {body}
    </aside>
  );
}
