import { useEffect } from "react";
import { TitleBar } from "./components/titlebar.tsx";
import { BackendBanner } from "./components/backend-banner.tsx";
import { ToastViewport } from "./components/toast-viewport.tsx";
import { ChatPage } from "./pages/chat/chat-page.tsx";
import { WizardPage } from "./pages/wizard/wizard-page.tsx";
import { SettingsPage } from "./pages/settings/settings-page.tsx";
import { bindAppEvents } from "./store/app-events.ts";
import { useBackendStore } from "./store/backend.ts";
import { useRouterStore } from "./store/router.ts";

export function App() {
  const start = useBackendStore((s) => s.start);
  const wizard = useBackendStore((s) => s.wizard);
  const view = useRouterStore((s) => s.view);

  useEffect(() => {
    start();
    return bindAppEvents();
  }, [start]);

  // 向导未完成时锁定主界面（设置/聊天不可进入）。
  const locked = wizard !== null && !wizard.completed;
  const effective = locked ? "wizard" : view;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
      <TitleBar />
      <BackendBanner />
      {effective === "wizard" && <WizardPage />}
      {effective === "settings" && <SettingsPage />}
      {effective === "chat" && <ChatPage />}
      <ToastViewport />
    </div>
  );
}
