#!/usr/bin/env node
/**
 * Task 2 传输层/RPC 客户端验收脚本（直接运行主进程 TS 源码，Node 24 type stripping）。
 *
 * TR-2.1 解析器解析到 codex，版本与 codex --version 一致
 * TR-2.2 initialize + getAuthStatus + thread/list + project/list
 * TR-2.3 外部 taskkill 进程树 → reconnecting → ready，日志出现两次 initialize
 * TR-2.4 日志脱敏：伪造密钥不落盘；审批 ServerRequest 回包正确
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";

const src = (p) => pathToFileURL(join(process.cwd(), "src", "main", p)).href;

const { resolveCodex } = await import(src("codex/codex-resolver.ts"));
const { CodexRpcClient, RpcDisconnectedError } = await import(src("codex/rpc-client.ts"));
const { logger, maskSecrets } = await import(src("logging.ts"));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ---------- TR-2.4a 脱敏纯函数 ----------
const secretSamples = [
  "Authorization: Bearer abcdef0123456789abcdef",
  `{"api_key":"sk-ABCDEFGHIJKLMNOP1234567890"}`,
  "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwp",
  'OPENAI_API_KEY=sk-proj-0123456789abcdefABCDEF',
];
const maskedAll = secretSamples.every((s) => !/abcdef0123456789|sk-[A-Za-z0-9]|eyJ[A-Za-z0-9]/.test(maskSecrets(s)));
check("TR-2.4 maskSecrets 覆盖 Bearer/sk-/JWT/键值", maskedAll);

// ---------- 日志文件落临时目录，注入伪造密钥 ----------
const logDir = await mkdtemp(join(tmpdir(), "cgpt-check-rpc-"));
logger.init(logDir, "debug");
logger.info("planted secret line", { authorization: "Bearer PLAINTEXT_TOKEN_zzz_123456" });
logger.info("another", { apiKey: "sk-PLAINTEXT_abcdef123456" });

// ---------- TR-2.1 解析器 ----------
const { resolution, failures } = await resolveCodex();
check("TR-2.1 解析到可执行 codex", !!resolution, resolution ? `${resolution.version} @ ${resolution.source}` : JSON.stringify(failures));
if (resolution) {
  const raw = execFileSync(resolution.path, ["--version"], { encoding: "utf8" }).trim();
  const v = raw.match(/codex-cli\s+(\S+)/)?.[1];
  check("TR-2.1 版本与 codex --version 一致", v === resolution.version, `${v} === ${resolution.version}`);
}

// ---------- 假传输层：审批 ServerRequest 回包 ----------
class FakeTransport extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.alive = true;
  }
  get childPid() {
    return undefined;
  }
  start() {
    /* no-op */
  }
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
    }
    return true;
  }
  async stop() {
    this.alive = false;
    setImmediate(() => this.emit("exit", { code: 0, signal: null, expected: true }));
  }
}

{
  const fake = new FakeTransport();
  const client = new CodexRpcClient({
    appVersion: "0.0.0-test",
    resolver: async () => ({ resolution: { path: "fake.exe", version: "0.0.0", source: "override" }, failures: [] }),
    transportFactory: () => fake,
  });
  await client.start();
  check("假传输层 initialize 握手", client.isReady);

  const serverReqPromise = new Promise((resolve) => client.once("serverRequest", resolve));
  fake.emit("message", {
    jsonrpc: "2.0",
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: { command: "echo hi" },
  });
  const got = await serverReqPromise;
  check("ServerRequest 被分发（审批登记前置）", got?.id === "approval-1" && got.method.endsWith("requestApproval"));
  client.respondToServerRequest("approval-1", { decision: "accept" });
  const reply = fake.sent.find((f) => f.id === "approval-1");
  check(
    "审批决议按同 id 回送 JSON-RPC response",
    !!reply && reply.result?.decision === "accept" && reply.error === undefined,
    JSON.stringify(reply),
  );
  await client.stop();
}

// ---------- TR-2.2/2.3 真实 app-server ----------
if (!resolution) {
  check("真实 app-server 用例（跳过：未解析到 codex）", false);
} else {
  const statuses = [];
  const client = new CodexRpcClient({ appVersion: "0.0.0-test", cwd: process.cwd() });
  client.on("status", (s) => statuses.push(s));

  await client.start();
  check("TR-2.2 initialize 含 codexHome/platformFamily", !!client.serverInfo?.codexHome && !!client.serverInfo?.platformFamily, client.serverInfo?.codexHome);

  const auth = await client.request("getAuthStatus", { refresh: false });
  check("TR-2.2 getAuthStatus.authMethod", typeof auth?.authMethod === "string", auth?.authMethod);
  const threads = await client.request("thread/list", { limit: 5 });
  check("TR-2.2 thread/list.data 数组", Array.isArray(threads?.data), `${threads?.data?.length ?? 0} 条`);
  const projects = await client.request("project/list", { limit: 5 });
  check("TR-2.2 project/list.data 数组", Array.isArray(projects?.data), `${projects?.data?.length ?? 0} 个`);

  // 断连时在途请求必须被拒绝（无悬挂 Promise）
  const pending = client.request("thread/list", { limit: 1 }, { timeoutMs: 60_000 });
  const rejected = pending.then(
    () => false,
    (e) => e instanceof RpcDisconnectedError,
  );

  // TR-2.3 外部杀掉 codex 进程树
  const pidBefore = client["transport"]?.childPid;
  assert(pidBefore, "拿不到 app-server 子进程 pid");
  execFileSync("taskkill", ["/PID", String(pidBefore), "/T", "/F"], { stdio: "ignore" });

  check("TR-2.3 断连拒绝在途 Promise（无泄漏）", await rejected);

  const readyAgain = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 60_000);
    client.on("status", (s) => {
      if (s === "ready" && client.initializeHandshakes >= 2) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
  check("TR-2.3 杀进程后自动重连并再次 ready", readyAgain, `initialize 次数=${client.initializeHandshakes}`);
  check("TR-2.3 状态序列包含 reconnecting", statuses.includes("reconnecting"), statuses.join("→"));
  check("TR-2.3 日志中存在两次 initialize 握手", client.initializeHandshakes >= 2, `${client.initializeHandshakes} 次`);

  // 重连后仍可正常请求
  const after = await client.request("getAuthStatus", { refresh: false });
  check("重连后请求恢复", typeof after?.authMethod === "string");

  await client.stop();
}

// ---------- TR-2.4b 日志文件不得含明文密钥 ----------
await logger.close();
// 日志按本地日期命名，这里直接取目录内的 cgpt-*.log（测试目录隔离，只会有一个）
const { readdirSync } = await import("node:fs");
const logName = readdirSync(logDir).find((f) => /^cgpt-.*\.log$/.test(f));
const logFile = logName ? join(logDir, logName) : null;
const disk = logFile && existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
check(
  "TR-2.4 日志文件不含伪造 token 明文",
  !disk.includes("PLAINTEXT_TOKEN_zzz_123456") && !disk.includes("sk-PLAINTEXT_abcdef123456"),
);
check(
  "TR-2.4 日志文件中密钥已打码",
  disk.includes("Bearer ***") && disk.includes('"apiKey":"***"'),
  logFile ?? "(日志缺失)",
);

const failed = results.filter((r) => !r.ok);
console.log(`\ncheck-rpc: ${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
