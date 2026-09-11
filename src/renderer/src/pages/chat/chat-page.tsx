import { useEffect } from "react";
import { NavRail } from "./nav-rail.tsx";
import { ThreadList } from "./thread-list.tsx";
import { ThreadPane } from "./thread-pane.tsx";
import { ApprovalsDock } from "../../components/approvals-dock.tsx";
import { TerminalPane } from "../../components/terminal/terminal-pane.tsx";
import { useApprovalsStore } from "../../store/approvals.ts";
import { useBackendStore } from "../../store/backend.ts";
import { useProjectsStore } from "../../store/projects.ts";
import { bindCodexEvents } from "../../store/codex-events.ts";

export function ChatPage() {
  const startApprovals = useApprovalsStore((s) => s.start);
  const refreshProjects = useProjectsStore((s) => s.refresh);
  const backendReady = useBackendStore((s) => s.status?.state === "ready");

  useEffect(() => {
    startApprovals();
    return bindCodexEvents();
  }, [startApprovals]);

  useEffect(() => {
    if (backendReady) void refreshProjects();
  }, [backendReady, refreshProjects]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <ThreadList />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <ThreadPane />
          <ApprovalsDock />
        </main>
      </div>
      <TerminalPane />
    </div>
  );
}
