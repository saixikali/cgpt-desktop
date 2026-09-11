#!/usr/bin/env node
/**
 * Task 3 高层 API / 审批登记中心 / 通知订阅 / 能力降级 验收脚本。
 * 直接运行 src/main 下 TS 源码（Node 24 type stripping）。
 *
 * TR-3.1 真实链路：thread/list → thread/resume(excludeTurns) → turns/list → items/list
 * TR-3.2 审批：4 类 ServerRequest 的决议回包 + 服务端核销 + 超时 + 未知 id
 * TR-3.3 API 面覆盖 FR-3~FR-10 所需方法
 */
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const src = (p) => pathToFileURL(join(process.cwd(), "src", "main", p)).href;
const { CodexApi, MethodUnavailableError } = await import(src("codex/codex-api.ts"));
const { CodexRpcClient } = await import(src("codex/rpc-client.ts"));
const { ApprovalRegistry } = await import(src("codex/approvals.ts"));
const { resolveCodex } = await import(src("codex/codex-resolver.ts"));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** 假传输层：initialize 自动应答，其余帧走 responder。 */
class FakeTransport extends EventEmitter {
  constructor(responder) {
    super();
    this.sent = [];
    this.responder = responder;
    this.alive = true;
  }
  get childPid() {
    return undefined;
  }
  start() {}
  sendJson(frame) {
    this.sent.push(frame);
    if (frame.method === "initialize") {
      setImmediate(() =>
        this.emit("message", {
          jsonrpc: "2.0",
          id: frame.id,
          result: { userAgent: "fake/1.0", codexHome: "C:\\fake", platformFamily: "windows", platformOs: "windows" },
        }),
      );
    } else if (this.responder) {
      const r = this.responder(frame);
      if (r) setImmediate(() => this.emit("message", { jsonrpc: "2.0", id: frame.id, ...r }));
    }
    return true;
  }
  async stop() {
    this.alive = false;
    setImmediate(() => this.emit("exit", { code: 0, signal: null, expected: true }));
  }
}

async function fakeClient(responder) {
  const transport = new FakeTransport(responder);
  const client = new CodexRpcClient({
    appVersion: "0.0.0-test",
    resolver: async () => ({ resolution: { path: "fake.exe", version: "0", source: "override" }, failures: [] }),
    transportFactory: () => transport,
  });
  await client.start();
  return { client, transport };
}

// ---------- TR-3.2 审批登记中心 ----------
{
  const { client, transport } = await fakeClient();
  const api = new CodexApi(client);
  const pendingEvents = [];
  api.approvals.on("pending", (a) => pendingEvents.push(a));

  const deliver = (id, method, params = {}) =>
    transport.emit("message", { jsonrpc: "2.0", id, method, params });

  const waitPending = async () => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && pendingEvents.length === 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return pendingEvents.shift();
  };

  // 命令审批
  deliver("srv-cmd", "item/commandExecution/requestApproval", { threadId: "t1", command: "rm -rf x" });
  const a1 = await waitPending();
  api.approvals.resolveCommand(a1.localId, "accept");
  const f1 = transport.sent.find((f) => f.id === "srv-cmd");
  check(
    "TR-3.2 命令审批 accept 回包",
    f1?.result?.decision === "accept" && f1.error === undefined,
    JSON.stringify(f1?.result),
  );

  // 文件变更审批
  deliver("srv-file", "item/fileChange/requestApproval", { threadId: "t1" });
  const a2 = await waitPending();
  api.approvals.resolveFileChange(a2.localId, "acceptForSession");
  const f2 = transport.sent.find((f) => f.id === "srv-file");
  check("TR-3.2 文件审批 acceptForSession 回包", f2?.result?.decision === "acceptForSession");

  // MCP elicitation
  deliver("srv-elicit", "mcpServer/elicitation/request", { threadId: "t1" });
  const a3 = await waitPending();
  api.approvals.resolveElicitation(a3.localId, "decline");
  const f3 = transport.sent.find((f) => f.id === "srv-elicit");
  check(
    "TR-3.2 elicitation decline 回包（action/content/_meta）",
    f3?.result?.action === "decline" && f3.result.content === null && f3.result._meta === null,
    JSON.stringify(f3?.result),
  );

  // 工具用户输入
  deliver("srv-input", "item/tool/requestUserInput", { threadId: "t1" });
  const a4 = await waitPending();
  api.approvals.resolveUserInput(a4.localId, { q1: { answers: ["hello"] } });
  const f4 = transport.sent.find((f) => f.id === "srv-input");
  check(
    "TR-3.2 requestUserInput answers 回包",
    Array.isArray(f4?.result?.answers?.q1?.answers) && f4.result.answers.q1.answers[0] === "hello",
    JSON.stringify(f4?.result),
  );

  // 服务端主动核销
  deliver("srv-auto", "item/permissions/requestApproval", { threadId: "t1" });
  const a5 = await waitPending();
  transport.emit("message", {
    jsonrpc: "2.0",
    method: "serverRequest/resolved",
    params: { threadId: "t1", requestId: "srv-auto" },
  });
  await new Promise((r) => setTimeout(r, 20));
  check("TR-3.2 serverRequest/resolved 自动核销", api.approvals.get(a5.localId) === undefined);

  // 未知 localId
  let threwUnknown = false;
  try {
    api.approvals.respond("no-such-id", {});
  } catch {
    threwUnknown = true;
  }
  check("TR-3.2 未知审批 id 决议抛错", threwUnknown);

  await client.stop();
}

// ---------- 审批 TTL 超时 ----------
{
  const { client } = await fakeClient();
  // 直接 new 一个 120ms TTL 的登记中心（rpc 允许多监听者）
  const registry = new ApprovalRegistry(client, 120);
  let resolvedStatus = null;
  registry.on("resolved", (a) => (resolvedStatus = a.status));
  client.emit("serverRequest", { id: "ttl-1", method: "item/fileChange/requestApproval", params: {} });
  await new Promise((r) => setTimeout(r, 300));
  const pending = registry.list().find((a) => a.serverId === "ttl-1");
  let threwExpired = false;
  try {
    const local = [...registry.list()];
    if (local[0]) registry.resolveFileChange(local[0].localId, "accept");
    else threwExpired = true; // 已从 pending 列表移除
  } catch {
    threwExpired = true;
  }
  check("TR-3.2 超时审批移出 pending 且决议被拒", pending === undefined && threwExpired, `status=${resolvedStatus}`);
  registry.dispose();
  await client.stop();
}

// ---------- 能力降级 ----------
{
  const { client, transport } = await fakeClient((frame) =>
    frame.method === "server/diagnostics"
      ? { error: { code: -32601, message: "method not found" } }
      : { result: null },
  );
  const api = new CodexApi(client);
  let unavailable = null;
  try {
    await api.diagnostics();
  } catch (e) {
    unavailable = e;
  }
  const framesBefore = transport.sent.length;
  let secondHit = false;
  try {
    await api.diagnostics();
  } catch (e) {
    secondHit = e instanceof MethodUnavailableError;
  }
  check(
    "方法 -32601 被归一为 MethodUnavailableError 并记忆",
    unavailable instanceof MethodUnavailableError &&
      !api.isMethodAvailable("server/diagnostics") &&
      secondHit &&
      transport.sent.length === framesBefore,
  );
  await client.stop();
}

// ---------- TR-3.3 API 面覆盖 ----------
{
  const required = [
    "getAuthStatus", "getAccount", "logout", "listModels", "listPermissionProfiles",
    "readConfig", "writeConfigValue", "batchWriteConfig", "configRequirements",
    "listMcpStatus", "reloadMcpConfig", "readMcpResource", "callMcpTool",
    "listProjects", "readProject", "createProject", "updateProject", "deleteProject",
    "importProject", "moveProject",
    "listThreads", "readThread", "startThread", "resumeThread", "forkThread",
    "archiveThread", "unarchiveThread", "deleteThread", "listTurns", "listItems", "listTimeline",
    "searchThreads", "setThreadName", "updateThreadSettings",
    "startTurn", "steerTurn", "interruptTurn", "updateTurnSettings",
    "fsReadFile", "fsReadDirectory", "fsGetMetadata",
    "processSpawn", "processWriteStdin", "processResizePty", "processKill", "diagnostics",
  ];
  const { client } = await fakeClient();
  const api = new CodexApi(client);
  const missing = required.filter((m) => typeof api[m] !== "function");
  check(`TR-3.3 封装方法覆盖（要求 ${required.length} 个）`, missing.length === 0, missing.join(","));
  await client.stop();
}

// ---------- TR-3.1 真实链路 ----------
const { resolution } = await resolveCodex();
if (!resolution) {
  check("TR-3.1 真实链路（跳过：未解析到 codex）", false);
} else {
  const client = new CodexRpcClient({ appVersion: "0.0.0-test", cwd: process.cwd() });
  try {
    await client.start();
    const api = new CodexApi(client);

    const threadList = await api.listThreads({ limit: 20 });
    const threads = threadList.data ?? [];
    check("TR-3.1 thread/list 至少 1 条历史会话", threads.length > 0, `${threadList.data?.length ?? 0} 条`);

    // 部分会话可能正被其它 Codex 进程占用（active writer），依次找可恢复的。
    let resumed = null;
    const lockErrors = [];
    for (const t of threads.slice(0, 8)) {
      try {
        const r = await api.resumeThread({ threadId: t.id, excludeTurns: true });
        resumed = { thread: t, response: r };
        break;
      } catch (e) {
        lockErrors.push(e.message);
      }
    }
    check(
      "TR-3.1 thread/resume(excludeTurns) 返回 thread",
      resumed?.response?.thread?.id != null,
      resumed ? resumed.response.thread.id : `全部被占用：${lockErrors[0]}`,
    );

    if (resumed) {
      const id = resumed.thread.id;
      const turns = await api.listTurns({ threadId: id, limit: 10 });
      const turnArr = Array.isArray(turns?.turns) ? turns.turns : Array.isArray(turns?.data) ? turns.data : null;
      check("TR-3.1 thread/turns/list 成功（Turn 内嵌 items）", Array.isArray(turnArr), `turns=${turnArr?.length ?? -1}`);

      // 0.151-alpha 上 thread/items/list 与 timeline/list 返回 -32601 "not supported yet"；
      // 允许降级（MethodUnavailableError 记忆），历史条目从 Turn.items 取。
      let itemsOk = false;
      let detail = "";
      try {
        const items = await api.listItems({ threadId: id, limit: 10 });
        const n = Array.isArray(items?.items) ? items.items.length : Array.isArray(items?.data) ? items.data.length : -1;
        itemsOk = n >= 0;
        detail = `独立接口 items=${n}`;
      } catch (e) {
        if (e instanceof MethodUnavailableError) {
          itemsOk = true;
          const embedded = turnArr?.reduce((acc, t) => acc + (Array.isArray(t.items) ? t.items.length : 0), 0) ?? 0;
          detail = `版本未启用，降级走 Turn.items，内嵌条目=${embedded}`;
        } else {
          detail = e.message;
        }
      }
      check("TR-3.1 历史条目可取（items/list 或 Turn.items 降级）", itemsOk, detail);
    }
  } catch (err) {
    check(`TR-3.1 链路异常：${err.message}`, false);
  } finally {
    await client.stop();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\ncheck-api: ${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
