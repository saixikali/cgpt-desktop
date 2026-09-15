/**
 * 聊天侧栏（参照任务式 AI 客户端布局）：
 * 品牌 + 会话历史前进/后退 → 新建任务/搜索/自动化/插件市场菜单 →
 * 「分组/项目」分段（平铺全部 / 按工作区分组）→ 底部账号、终端、设置。
 * 工作区对话框与会话行菜单逻辑自旧 thread-list.tsx 平移，未改业务行为。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Blocks,
  Ellipsis,
  Folder,
  FolderPlus,
  Hash,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  TerminalSquare,
  Trash2,
  User,
  Workflow,
  X,
} from "lucide-react";
import { t } from "../../i18n/zh.ts";
import { bridge, call } from "../../lib/ipc.ts";
import { useBackendStore } from "../../store/backend.ts";
import { useProjectsStore } from "../../store/projects.ts";
import { useThreadsStore } from "../../store/threads.ts";
import { useThreadViewStore } from "../../store/thread-view.ts";
import { useToastStore } from "../../store/toast.ts";
import { useRouterStore } from "../../store/router.ts";
import { useApprovalsStore } from "../../store/approvals.ts";
import { useTerminalStore } from "../../store/terminal.ts";
import { formatRelativeTime, truncate } from "../../lib/format.ts";
import { cn } from "../../lib/cn.ts";
import { BrandMark } from "../../components/brand.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { EmptyState, ErrorState } from "../../components/ui/empty-state.tsx";
import { ScrollArea } from "../../components/ui/scroll-area.tsx";
import { SkeletonRows } from "../../components/ui/skeleton.tsx";
import type { ThreadSummary } from "../../lib/types.ts";

const COLLAPSE_KEY = "cgpt.sidebar.collapsed";
const MODE_KEY = "cgpt.sidebar.listmode";

/** groups=全部会话平铺；projects=按工作区分组。 */
type ListMode = "groups" | "projects";

const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");

function underRoots(cwd: string | null, roots: string[]): boolean {
  if (!cwd || roots.length === 0) return false;
  const c = norm(cwd);
  return roots.some((r) => {
    const root = norm(r);
    return c === root || c.startsWith(`${root}\\`);
  });
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-accent animate-pulse",
  waiting_for_input: "bg-warning",
};

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
                    className="ml-auto rounded p-0.5 text-text-faint hover:text-danger"
                    onClick={() => setRoots((list) => list.filter((x) => x !== r))}
                  >
                    <X className="h-3 w-3" />
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
          <div className="absolute right-1.5 top-6 z-40 flex w-36 flex-col gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-lg shadow-shadow">
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
              <Folder className="h-3 w-3" />
              {archived ? t.threadMenu.unarchive : t.threadMenu.archive}
            </button>
            <button
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
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

/* ================= 会话行 ================= */

function ThreadRow({ thread, active }: { thread: ThreadSummary; active: boolean }) {
  const open = useThreadViewStore((s) => s.open);
  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-[7px] transition-colors",
        active ? "bg-surface-3" : "hover:bg-hover",
      )}
      onClick={() => void open(thread.id)}
    >
      {thread.status && STATUS_DOT[thread.status] && (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[thread.status])} />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          active ? "font-medium text-text" : "text-text-muted group-hover:text-text",
        )}
      >
        {thread.name || thread.preview || "未命名会话"}
      </span>
      {thread.archived && (
        <span className="shrink-0 rounded border border-border px-1 text-[9px] text-text-faint">
          {t.threads.archived}
        </span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
        {formatRelativeTime(thread.updatedAt)}
      </span>
      <ThreadItemMenu threadId={thread.id} archived={thread.archived} />
    </div>
  );
}

/* ================= 工作区组头 ================= */

function GroupHeader({
  projectId,
  name,
  active,
  onMenu,
}: {
  projectId: string | null;
  name: string;
  active: boolean;
  onMenu: (target: { id: string; name: string }, kind: "rename" | "delete") => void;
}) {
  const setActive = useProjectsStore((s) => s.setActive);
  const projects = useProjectsStore((s) => s.items);
  const [menuOpen, setMenuOpen] = useState(false);
  const project = projectId ? projects.find((p) => p.id === projectId) ?? null : null;

  return (
    <div
      className={cn(
        "group relative mt-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
        active ? "text-text" : "text-text-muted hover:bg-hover",
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={() => void setActive(active ? null : projectId)}
      >
        <Folder className={cn("h-3.5 w-3.5 shrink-0", active ? "text-accent" : "text-text-faint")} strokeWidth={1.8} />
        <span className="truncate font-medium">{name}</span>
      </button>
      {project && (
        <>
          <button
            title={t.threadMenu.title}
            className={cn(
              "hidden h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint hover:bg-surface-3 hover:text-text group-hover:flex",
              menuOpen && "flex bg-surface-3 text-text",
            )}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onMouseDown={() => setMenuOpen(false)} />
              <div className="absolute right-1 top-7 z-40 flex w-32 flex-col gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-lg shadow-shadow">
                <button
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-hover hover:text-text"
                  onClick={() => {
                    setMenuOpen(false);
                    onMenu({ id: project.id, name: project.name }, "rename");
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t.projects.rename}
                </button>
                <button
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
                  onClick={() => {
                    setMenuOpen(false);
                    onMenu({ id: project.id, name: project.name }, "delete");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t.projects.delete}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ================= 主菜单项 ================= */

function MenuRow({
  icon: Icon,
  label,
  shortcut,
  spin,
  onClick,
}: {
  icon: typeof Search;
  label: string;
  shortcut?: string;
  spin?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-text-muted transition-colors hover:bg-hover hover:text-text"
    >
      <Icon className={cn("h-[18px] w-[18px] shrink-0", spin && "animate-spin")} strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <span className="shrink-0 text-[11px] text-text-faint">{shortcut}</span>}
    </button>
  );
}

/* ================= 底部账号 ================= */

interface AccountInfoResponse {
  account?: { type?: string; email?: string | null } | null;
}

function AccountButton() {
  const openSettings = useRouterStore((s) => s.openSettings);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    call<AccountInfoResponse>(() => bridge().settings.account({}))
      .then((r) => {
        if (!cancelled) setEmail(r?.account?.email ?? null);
      })
      .catch(() => {
        if (!cancelled) setEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const name = email ? email.split("@")[0] || email : t.sidebar.localAccount;
  return (
    <button
      title={t.sidebar.account}
      onClick={() => openSettings("account")}
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-hover"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
        {email ? name.slice(0, 1).toUpperCase() : <User className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{name}</span>
    </button>
  );
}

/* ================= 侧栏主体 ================= */

export function Sidebar() {
  const { items, loading, loadingMore, searching, error, initialized, query, nextCursor } =
    useThreadsStore();
  const refresh = useThreadsStore((s) => s.refresh);
  const search = useThreadsStore((s) => s.search);
  const loadMore = useThreadsStore((s) => s.loadMore);
  const startThread = useThreadsStore((s) => s.start);
  const activeThreadId = useThreadViewStore((s) => s.threadId);
  const openThread = useThreadViewStore((s) => s.open);
  const backendReady = useBackendStore((s) => s.status?.state === "ready");
  const toastError = useToastStore((s) => s.error);

  const projects = useProjectsStore((s) => s.items);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const projectsError = useProjectsStore((s) => s.error);
  const activeProjectId = useProjectsStore((s) => s.activeId);

  const setView = useRouterStore((s) => s.setView);
  const openSettings = useRouterStore((s) => s.openSettings);
  const pendingCount = useApprovalsStore((s) => s.pending.length);
  const terminalSessions = useTerminalStore((s) => s.sessions.length);
  const terminalOpen = useTerminalStore((s) => s.open);
  const setTerminalOpen = useTerminalStore((s) => s.setOpen);
  const createTerminal = useTerminalStore((s) => s.create);
  const goBack = useThreadViewStore((s) => s.goBack);
  const goForward = useThreadViewStore((s) => s.goForward);
  const historyIndex = useThreadViewStore((s) => s.historyIndex);
  const historyLength = useThreadViewStore((s) => s.history.length);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [draft, setDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const pickLock = useRef(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [listMode, setListMode] = useState<ListMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "projects" ? "projects" : "groups";
    } catch {
      return "groups";
    }
  });

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

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, listMode);
    } catch {
      /* ignore */
    }
  }, [listMode]);

  // 全局快捷键：Ctrl+N 新建任务、Ctrl+K 聚焦搜索（输入焦点在表单内时不劫持）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        void newThread();
      } else if (key === "k") {
        e.preventDefault();
        setCollapsed(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // newThread 每渲染重建，这里仅需挂载一次，命令读取的都是最新 store 状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const newThread = async () => {
    if (creating || pickLock.current) return;
    const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
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
      await openThread(id);
    } catch (err) {
      toastError(t.toast.actionFailed, err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
      pickLock.current = false;
    }
  };

  // 归档过滤 + 搜索结果（store 已按 query 拉取，本地再兜 archived）。
  const filtered = useMemo(
    () => (showArchived ? items : items.filter((th) => !th.archived)),
    [items, showArchived],
  );

  // 按工作区 roots 分组；不属于任何工作区的归入“未分组”。空组不渲染。
  const groups = useMemo(() => {
    const result: Array<{ id: string | null; name: string; threads: ThreadSummary[] }> = [];
    const remaining: ThreadSummary[] = [];
    for (const th of filtered) {
      const owner = projects.find((p) => underRoots(th.cwd, p.roots));
      if (!owner) {
        remaining.push(th);
        continue;
      }
      let g = result.find((x) => x.id === owner.id);
      if (!g) {
        g = { id: owner.id, name: owner.name, threads: [] };
        result.push(g);
      }
      g.threads.push(th);
    }
    // 「项目」分段始终平铺全部工作区（activeProjectId 只影响新建任务的默认目录，不过滤列表）。
    const visible = result;
    if (remaining.length > 0) {
      visible.push({ id: null, name: t.sidebar.ungrouped, threads: remaining });
    }
    return visible;
  }, [filtered, projects, t.sidebar.ungrouped]);

  const flatEmpty = initialized && filtered.length === 0;
  const projectEmpty = initialized && groups.every((g) => g.threads.length === 0);
  const empty = listMode === "groups" ? flatEmpty : projectEmpty;

  const terminalButton = (collapsedSize: boolean) => (
    <button
      title={t.sidebar.terminal}
      onClick={() => {
        if (terminalSessions === 0) void createTerminal();
        else setTerminalOpen(!terminalOpen);
      }}
      className={cn(
        "relative flex items-center justify-center rounded-lg",
        collapsedSize ? "h-9 w-9" : "h-8 w-8",
        terminalOpen ? "bg-accent-soft text-accent" : "text-text-faint hover:bg-hover hover:text-text",
      )}
    >
      <TerminalSquare className={collapsedSize ? "h-[17px] w-[17px]" : "h-4 w-4"} strokeWidth={1.8} />
      {terminalSessions > 0 && (
        <span
          className={cn(
            "absolute rounded-full bg-accent font-semibold text-on-accent",
            collapsedSize
              ? "right-1 top-1 min-w-3.5 px-1 text-[8px] leading-[12px]"
              : "right-0.5 top-0.5 min-w-3.5 px-1 text-[8px] leading-[12px]",
          )}
        >
          {terminalSessions}
        </span>
      )}
    </button>
  );

  /* ---------- 收起态：仅图标 ---------- */
  if (collapsed) {
    return (
      <aside className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-3">
        <button
          title={t.sidebar.expand}
          onClick={toggleCollapsed}
          className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-hover hover:text-text"
        >
          <BrandMark size={22} />
        </button>
        <button
          title={t.sidebar.newTask}
          onClick={() => void newThread()}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-hover hover:text-text"
        >
          {creating ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />}
        </button>
        <button
          title={t.sidebar.toggleSearch}
          onClick={() => {
            setCollapsed(false);
            setSearchOpen(true);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
        >
          <Search className="h-[17px] w-[17px]" strokeWidth={1.8} />
        </button>
        <button
          title={t.sidebar.automation}
          onClick={() => setView("wizard")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
        >
          <Workflow className="h-[17px] w-[17px]" strokeWidth={1.8} />
        </button>
        <button
          title={t.sidebar.marketplace}
          onClick={() => openSettings("mcp")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
        >
          <Blocks className="h-[17px] w-[17px]" strokeWidth={1.8} />
        </button>
        <div className="flex-1" />
        {terminalButton(true)}
        <button
          title={t.nav.settings}
          onClick={() => setView("settings")}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
        >
          <SettingsIcon className="h-[17px] w-[17px]" strokeWidth={1.8} />
          {pendingCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
          )}
        </button>
      </aside>
    );
  }

  /* ---------- 展开态 ---------- */
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-surface">
      {/* 品牌 + 会话历史导航 + 收起 */}
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        <BrandMark size={26} radius={8} className="mr-1 shrink-0" />
        <button
          title={t.sidebar.back}
          disabled={historyIndex <= 0}
          onClick={goBack}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          title={t.sidebar.forward}
          disabled={historyIndex < 0 || historyIndex >= historyLength - 1}
          onClick={goForward}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <div className="flex-1" />
        <button
          title={t.sidebar.collapse}
          onClick={toggleCollapsed}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover hover:text-text"
        >
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      {/* 主菜单 */}
      <nav className="flex shrink-0 flex-col gap-0.5 px-3 pb-1">
        <MenuRow
          icon={creating ? Loader2 : MessageSquarePlus}
          spin={creating}
          label={t.sidebar.newTask}
          shortcut="Ctrl+N"
          onClick={() => void newThread()}
        />
        <MenuRow
          icon={Search}
          label={t.sidebar.toggleSearch}
          shortcut="Ctrl+K"
          onClick={() => setSearchOpen(true)}
        />
        <MenuRow icon={Workflow} label={t.sidebar.automation} onClick={() => setView("wizard")} />
        <MenuRow
          icon={Blocks}
          label={t.sidebar.marketplace}
          onClick={() => openSettings("mcp")}
        />
      </nav>

      {/* 分组/项目分段 + 归档过滤 + 新建工作区 */}
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-2">
        <div className="flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
          <button
            onClick={() => setListMode("groups")}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
              listMode === "groups"
                ? "bg-surface-3 font-medium text-text"
                : "text-text-faint hover:text-text",
            )}
          >
            <Hash className="h-3.5 w-3.5" strokeWidth={2} />
            {t.sidebar.tabGroups}
          </button>
          <button
            onClick={() => setListMode("projects")}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
              listMode === "projects"
                ? "bg-surface-3 font-medium text-text"
                : "text-text-faint hover:text-text",
            )}
          >
            <Folder className="h-3.5 w-3.5" strokeWidth={2} />
            {t.sidebar.tabProjects}
          </button>
        </div>
        <div className="flex-1" />
        <button
          title={t.sidebar.toggleArchived}
          onClick={() => setShowArchived((v) => !v)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg",
            showArchived ? "text-accent" : "text-text-faint hover:bg-hover hover:text-text",
          )}
        >
          <Archive className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          title={t.sidebar.newWorkspace}
          onClick={() => setCreateOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
        >
          <FolderPlus className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      {/* 内联搜索框 */}
      {searchOpen && (
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft("");
                  setSearchOpen(false);
                }
              }}
              placeholder={t.sidebar.search}
              className="h-8 w-full select-text rounded-lg border border-border bg-surface-2 pl-8 pr-7 text-xs text-text placeholder:text-text-faint focus:border-accent/50 focus:outline-none"
            />
            {searching ? (
              <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-faint" />
            ) : draft ? (
              <button
                onClick={() => setDraft("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading && !initialized ? (
        <div className="px-3">
          <SkeletonRows rows={8} />
        </div>
      ) : error && items.length === 0 ? (
        <ErrorState message={t.threads.error} onRetry={() => void refresh()} />
      ) : projectsError && projects.length === 0 ? (
        <ErrorState message={t.projects.error} onRetry={() => void useProjectsStore.getState().refresh()} />
      ) : empty ? (
        <div className="px-3">
          <EmptyState
            icon={<MessageSquarePlus className="h-5 w-5" strokeWidth={1.6} />}
            title={
              query
                ? `没有找到与“${truncate(query, 20)}”相关的会话`
                : t.threads.empty
            }
            hint={query ? undefined : t.threads.emptyHint}
          />
        </div>
      ) : (
        <ScrollArea
          className="flex-1"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 60 && nextCursor && !loadingMore) {
              void loadMore();
            }
          }}
        >
          {listMode === "groups" ? (
            <div className="flex flex-col gap-px px-2 pb-2">
              {filtered.map((th) => (
                <ThreadRow key={th.id} thread={th} active={activeThreadId === th.id} />
              ))}
              {loadingMore && (
                <div className="flex justify-center py-2 text-text-faint">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 px-2 pb-2">
              {groups.map((g) => (
                <div key={g.id ?? "__ungrouped"}>
                  <GroupHeader
                    projectId={g.id}
                    name={g.name}
                    active={g.id !== null && g.id === activeProjectId}
                    onMenu={(target, kind) =>
                      kind === "rename" ? setRenameTarget(target) : setDeleteTarget(target)
                    }
                  />
                  <div className="flex flex-col gap-px pl-2.5">
                    {g.threads.map((th) => (
                      <ThreadRow key={th.id} thread={th} active={activeThreadId === th.id} />
                    ))}
                  </div>
                </div>
              ))}
              {loadingMore && (
                <div className="flex justify-center py-2 text-text-faint">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      )}

      {projectsLoading && projects.length === 0 && (
        <div className="shrink-0 px-3 pb-1 text-[10px] text-text-faint">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          {t.common.loading}
        </div>
      )}

      {/* 底部：账号 / 终端 / 设置 */}
      <div className="flex h-14 shrink-0 items-center gap-1 border-t border-border px-2.5">
        <AccountButton />
        {terminalButton(false)}
        <button
          title={t.nav.settings}
          onClick={() => setView("settings")}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
        >
          <SettingsIcon className="h-4 w-4" strokeWidth={1.8} />
          {pendingCount > 0 && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
          )}
        </button>
      </div>

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <RenameProjectDialog target={renameTarget} onClose={() => setRenameTarget(null)} />
      <DeleteProjectDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </aside>
  );
}
