#!/usr/bin/env node
/**
 * Codex app-server 冒烟检查（Task 2 TR 与开发自检共用）。
 *
 * 校验：
 *   1. initialize 握手（experimentalApi 能力）
 *   2. getAuthStatus 返回鉴权方式
 *   3. thread/list 可调用并返回数组
 *   4. project/list 可调用并返回数组
 *
 * 全部通过退出码 0，任一失败退出码 1。
 */
import { spawn } from "node:child_process";
import { killProcessTree, locateCodex } from "./lib/codex-locator.mjs";

const TIMEOUT_MS = 15000;

const codex = locateCodex();
if (!codex) {
  console.error("check: 未找到可执行的 codex CLI（CODEX_BIN/PATH/MSIX/sandbox-bin）");
  process.exit(1);
}
console.log(`check: codex ${codex.version} @ ${codex.path} (${codex.source})`);

const child = spawn(codex.path, ["app-server", "--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let buffer = Buffer.alloc(0);
const pending = new Map();
const notifications = [];
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  let nl;
  while ((nl = buffer.indexOf(0x0a)) >= 0) {
    const line = buffer.subarray(0, nl).toString("utf8").trim();
    buffer = buffer.subarray(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("check: 无法解析的帧：", line.slice(0, 300));
      continue;
    }
    if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
    } else if (msg.method) {
      notifications.push(msg);
    }
  }
});
child.stderr.on("data", (c) => process.stderr.write(`[codex-stderr] ${c}`));
child.on("exit", (code) => {
  for (const [id, { reject }] of pending) {
    reject(new Error(`app-server 在响应 id=${id} 前退出（code=${code}）`));
  }
});

function request(method, params = {}) {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`请求超时（${TIMEOUT_MS}ms）：${method}`));
    }, TIMEOUT_MS);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      pending.delete(id);
      if (msg.error) {
        reject(
          new Error(
            `${method} 返回 JSON-RPC 错误：${msg.error.code} ${msg.error.message}`,
          ),
        );
      } else {
        resolve(msg.result);
      }
    });
    child.stdin.write(payload + "\n");
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  // 1. initialize（app-server 握手前静默，无需等待 banner）
  const init = await request("initialize", {
    clientInfo: { name: "cgpt-check", title: "Cgpt Desktop Check", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  check(
    "initialize 返回 codexHome/userAgent",
    !!init && typeof init.codexHome === "string" && init.userAgent !== undefined,
    init ? `codexHome=${init.codexHome ?? "?"}` : "",
  );

  // 2. 鉴权状态
  const auth = await request("getAuthStatus", { refresh: false });
  check(
    "getAuthStatus 返回 authMethod",
    !!auth && typeof auth.authMethod === "string",
    auth ? `authMethod=${auth.authMethod}` : "",
  );

  // 3. 会话列表（游标分页：{ data, nextCursor, backwardsCursor }）
  const threads = await request("thread/list", { limit: 50 });
  const threadData = threads?.data;
  check(
    "thread/list 返回 data 数组",
    Array.isArray(threadData),
    Array.isArray(threadData) ? `${threadData.length} 条历史会话` : "",
  );

  // 4. 项目列表（实验接口）
  const projects = await request("project/list", { limit: 50 });
  const projectData = projects?.data;
  check(
    "project/list 返回 data 数组",
    Array.isArray(projectData),
    Array.isArray(projectData) ? `${projectData.length} 个项目` : "",
  );
} catch (err) {
  check(`app-server 交互异常：${err.message}`, false);
} finally {
  try {
    child.stdin.end();
  } catch {
    /* ignore */
  }
  killProcessTree(child.pid);
}

const failed = results.filter((r) => !r.ok);
console.log(`\ncheck: ${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
