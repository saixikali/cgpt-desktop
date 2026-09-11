/**
 * codex 通知 → 渲染层 store 的单一分发点（ChatPage 挂载时绑定一次）。
 * 会话/工作区列表校正在本处处理；流式 delta 转发给 thread-view 归并。
 */
import { EVENTS } from "@shared/ipc/contract.ts";
import { onEvent } from "../lib/ipc.ts";
import { normalizeThread } from "../lib/types.ts";
import { useProjectsStore } from "./projects.ts";
import { useThreadViewStore } from "./thread-view.ts";
import { useThreadsStore } from "./threads.ts";

let bound = false;

/** 交给 thread-view 做流式归并的通知方法。 */
const STREAM_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "thread/tokenUsage/updated",
  "error",
  "warning",
]);

export function bindCodexEvents(): () => void {
  if (bound) return () => undefined;
  bound = true;

  return onEvent(EVENTS.codexNotification, (payload) => {
    const env = payload as { method?: unknown; params?: unknown } | null;
    if (!env || typeof env.method !== "string") return;
    const params = (env.params ?? {}) as Record<string, unknown>;
    const threads = useThreadsStore.getState();

    // 流式/回合级通知统一转发给 thread-view 归并。
    if (STREAM_METHODS.has(env.method)) {
      useThreadViewStore.getState().applyNotification({ method: env.method, params });
    }

    const threadId =
      typeof params.threadId === "string" ? params.threadId : null;

    switch (env.method) {
      case "project/changed":
        void useProjectsStore.getState().refresh();
        break;

      case "thread/started": {
        const raw = (params.thread ?? params) as Record<string, unknown>;
        if (raw && typeof raw.id === "string") threads.upsert(normalizeThread(raw));
        break;
      }

      case "thread/status/changed":
        if (threadId) {
          threads.patchStatus(threadId, typeof params.status === "string" ? params.status : null);
        }
        break;

      case "thread/name/updated":
        if (threadId) {
          threads.patchName(
            threadId,
            typeof params.threadName === "string" ? params.threadName : null,
          );
        }
        break;

      case "thread/archived":
      case "thread/unarchived":
        if (threadId) threads.setArchivedLocal(threadId, env.method === "thread/archived");
        break;

      case "thread/deleted":
        if (threadId) threads.dropLocal(threadId);
        break;

      default:
        break;
    }
  });
}
