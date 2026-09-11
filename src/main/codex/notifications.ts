/**
 * 服务端通知订阅中心：
 *   hub.on("*", (n) => ...)                    全量
 *   hub.onMethod("thread/status/changed", cb)  按方法
 *   hub.onThread(threadId, cb)                 按线程（params.threadId 过滤）
 * 底层仅注册一次 rpc 监听，避免多处直连导致重复订阅。
 */
import { EventEmitter } from "node:events";
import type { CodexRpcClient } from "./rpc-client.ts";
import type { ServerNotificationEnvelope } from "@protocol/ServerNotificationEnvelope";

type NotificationCallback = (params: unknown, envelope: ServerNotificationEnvelope) => void;

export class NotificationHub {
  private readonly emitter = new EventEmitter();
  private readonly rpcListener: (n: ServerNotificationEnvelope) => void;

  constructor(private readonly rpc: CodexRpcClient) {
    this.rpcListener = (n: ServerNotificationEnvelope) => this.dispatch(n);
    rpc.on("notification", this.rpcListener);
    this.emitter.setMaxListeners(100);
  }

  /** 客户端重建前释放：摘掉 rpc 监听与全部订阅，避免旧 hub 残留分发。 */
  dispose(): void {
    this.rpc.off("notification", this.rpcListener);
    this.emitter.removeAllListeners();
  }

  private dispatch(envelope: ServerNotificationEnvelope): void {
    this.emitter.emit("*", envelope.params, envelope);
    this.emitter.emit(`method:${envelope.method}`, envelope.params, envelope);
    const params = envelope.params as { threadId?: unknown } | null;
    if (params && typeof params === "object" && typeof params.threadId === "string") {
      this.emitter.emit(`thread:${params.threadId}`, envelope.params, envelope);
    }
  }

  /** 全量通知。 */
  onAny(cb: (envelope: ServerNotificationEnvelope) => void): () => void {
    const wrapped = (_params: unknown, envelope: ServerNotificationEnvelope) => cb(envelope);
    this.emitter.on("*", wrapped);
    return () => this.emitter.off("*", wrapped);
  }

  onMethod(method: string, cb: NotificationCallback): () => void {
    const key = `method:${method}`;
    this.emitter.on(key, cb);
    return () => this.emitter.off(key, cb);
  }

  onThread(threadId: string, cb: NotificationCallback): () => void {
    const key = `thread:${threadId}`;
    this.emitter.on(key, cb);
    return () => this.emitter.off(key, cb);
  }
}
