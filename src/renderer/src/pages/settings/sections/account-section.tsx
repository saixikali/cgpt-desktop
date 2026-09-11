/**
 * 设置-账号：展示登录状态，支持 ChatGPT 浏览器授权 / 设备码两种登录方式与退出。
 * 登录完成由 account/login/completed 通知驱动（store 内已绑定）。
 */
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { t } from "../../../i18n/zh.ts";
import { bridge, call } from "../../../lib/ipc.ts";
import { useBackendStore } from "../../../store/backend.ts";
import { useSettingsStore } from "../../../store/settings.ts";
import { useToastStore } from "../../../store/toast.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { Card, Field } from "./shared.tsx";

interface AuthStatus {
  authMethod: string | null;
  authToken: string | null;
  requiresOpenaiAuth: boolean | null;
}

interface AccountInfo {
  account: { type: string; email?: string | null; planType?: string } | null;
  requiresOpenaiAuth?: boolean;
}

export function AccountSection() {
  const ready = useBackendStore((s) => s.status?.state === "ready");
  const auth = useSettingsStore((s) => s.auth);
  const login = useSettingsStore((s) => s.login);
  const load = useSettingsStore((s) => s.load);
  const refreshAuth = useSettingsStore((s) => s.refreshAuth);
  const startLogin = useSettingsStore((s) => s.startLogin);
  const logout = useSettingsStore((s) => s.logout);
  const clearLogin = useSettingsStore((s) => s.clearLogin);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (ready) void load("auth", true);
  }, [ready, load]);

  // 登录方式就绪后尝试拉账号信息（老版本无 account 方法时静默降级）。
  useEffect(() => {
    if (!ready) return;
    const status = useSettingsStore.getState().auth.data as AuthStatus | null;
    if (!status?.authMethod) {
      setAccount(null);
      return;
    }
    setAccountErr(null);
    void call<AccountInfo>(() => bridge().settings.account({}))
      .then(setAccount)
      .catch(() => setAccountErr(t.settings.account.usageUnavailable));
  }, [ready, auth.data]);

  const status = auth.data as AuthStatus | null;
  const loggedIn = Boolean(status?.authMethod);

  const copyCode = async () => {
    if (!login.userCode) return;
    await navigator.clipboard.writeText(login.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!ready) {
    return <Card><p className="text-xs text-text-faint">等待 Codex 后端连接…</p></Card>;
  }
  if (auth.loading && !auth.data) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (auth.error) {
    return (
      <Card>
        <p className="text-xs text-danger">{t.settings.authError}：{auth.error}</p>
        <Button size="sm" variant="secondary" className="mt-2" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void refreshAuth()}>
          {t.common.retry}
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {login.pending && (
        <Card className="border-accent/40 bg-accent-soft">
          <p className="text-[13px] font-medium text-text">{t.settings.account.loggingIn}</p>
          {login.type === "chatgpt" && login.authUrl && (
            <p className="mt-1 text-xs text-text-muted">{t.settings.account.browserOpened}</p>
          )}
          {login.type === "chatgptDeviceCode" && login.userCode && (
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-base tracking-widest text-text">
                {login.userCode}
              </span>
              <Button size="sm" variant="secondary" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => void copyCode()}>
                {t.settings.account.copyCode}
              </Button>
            </div>
          )}
          {(login.authUrl ?? login.verificationUrl) && (
            <a
              href={login.authUrl ?? login.verificationUrl ?? "#"}
              onClick={(e) => {
                e.preventDefault();
                void call(() => bridge().app.openExternal({ url: (login.authUrl ?? login.verificationUrl)! })).catch(() => {});
              }}
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              {login.authUrl ?? login.verificationUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={clearLogin}>{t.settings.account.cancelLogin}</Button>
          </div>
        </Card>
      )}

      {login.error && (
        <Card className="border-danger/40">
          <p className="text-xs text-danger">{t.settings.account.loginFailed}：{login.error}</p>
        </Card>
      )}

      <Card>
        <Field label={t.settings.account.loginMethod}>
          {status?.authMethod ? (
            <Badge tone="success">{t.authMode[status.authMethod as keyof typeof t.authMode] ?? status.authMethod}</Badge>
          ) : (
            <Badge tone="warning">{t.settings.account.notLoggedIn}</Badge>
          )}
        </Field>
        {!loggedIn && !login.pending && (
          <>
            <p className="mt-1 text-xs leading-relaxed text-text-faint">{t.settings.account.notLoggedInHint}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => void startLogin("chatgpt")}>
                {t.settings.account.loginChatgpt}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void startLogin("chatgptDeviceCode")}>
                {t.settings.account.loginDeviceCode}
              </Button>
            </div>
          </>
        )}
        {loggedIn && (
          <div className="mt-2">
            <Button
              size="sm"
              variant="dangerSoft"
              icon={<LogOut className="h-3.5 w-3.5" />}
              onClick={() => void logout().catch((err) => useToastStore.getState().error(t.settings.account.logoutFailed, String((err as Error).message)))}
            >
              {t.settings.account.logout}
            </Button>
          </div>
        )}
      </Card>

      {loggedIn && account?.account && account.account.type === "chatgpt" && (
        <Card>
          <Field label={t.settings.account.email}>
            <span className="text-xs text-text-muted">{account.account.email ?? "-"}</span>
          </Field>
          <Field label={t.settings.account.plan}>
            <Badge tone="accent">{account.account.planType ?? "-"}</Badge>
          </Field>
        </Card>
      )}
      {accountErr && <p className="px-1 text-xs text-text-faint">{accountErr}</p>}
    </div>
  );
}
