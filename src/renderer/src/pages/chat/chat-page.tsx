import { useEffect } from "react";
import { Sidebar } from "./sidebar.tsx";
import { ThreadPane } from "./thread-pane.tsx";
import { ApprovalsDock } from "../../components/approvals-dock.tsx";
import { TerminalDrawer } from "../../components/terminal/terminal-drawer.tsx";
import { useApprovalsStore } from "../../store/approvals.ts";
import { useBackendStore } from "../../store/backend.ts";
import { useProjectsStore } from "../../store/projects.ts";
import { useTerminalStore } from "../../store/terminal.ts";
import { bindCodexEvents } from "../../store/codex-events.ts";
import { bindTerminalEvents } from "../../store/terminal.ts";

export function ChatPage() {
  const startApprovals = useApprovalsStore((s) => s.start);
  const refreshProjects = useProjectsStore((s) => s.refresh);
  const backendReady = useBackendStore((s) => s.status?.state === "ready");
  const terminalOpen = useTerminalStore((s) => s.open);

  useEffect(() => {
    startApprovals();
    const offCodex = bindCodexEvents();
    const offTerminal = bindTerminalEvents();
    return () => {
      offCodex();
      offTerminal();
    };
  }, [startApprovals]);

  useEffect(() => {
    if (backendReady) void refreshProjects();
  }, [backendReady, refreshProjects]);

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <ThreadPane />
        <ApprovalsDock />
        {terminalOpen && <TerminalDrawer />}
      </main>
    </div>
  );
}
