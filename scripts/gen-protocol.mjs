#!/usr/bin/env node
/**
 * 重新生成 Codex app-server 协议 TypeScript 类型（单一事实源）。
 *
 * 再生命令：npm run gen:protocol
 *
 * 解析 codex 顺序见 scripts/lib/codex-locator.mjs
 * 产物：protocol/generated/**（由 `codex app-server generate-ts --experimental` 生成，勿手改）
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexCandidates, locateCodex } from "./lib/codex-locator.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(rootDir, "protocol", "generated");

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
}

const resolved = locateCodex();
// 把位于命中候选之前的不可用候选打出来便于排障。
if (resolved) {
  for (const candidate of codexCandidates()) {
    if (candidate.path === resolved.path) break;
    console.warn(`gen-protocol: 候选不可用，跳过：${candidate.path}`);
  }
}
if (!resolved) {
  console.error(
    "gen-protocol: 未找到可执行的 codex。设置 CODEX_BIN 环境变量或安装/修复 Codex CLI。",
  );
  process.exit(1);
}

console.log(`gen-protocol: codex=${resolved.path} (${resolved.source})`);
console.log(`gen-protocol: version=${resolved.version}`);

const tmpDir = join(
  process.env.TEMP ?? rootDir,
  `cgpt-protocol-${Date.now()}`,
);
mkdirSync(tmpDir, { recursive: true });

const gen = run(resolved.path, [
  "app-server",
  "generate-ts",
  "--experimental",
  "--out",
  tmpDir,
]);
if (gen.status !== 0) {
  console.error(gen.stdout);
  console.error(gen.stderr);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(gen.status ?? 1);
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
cpSync(tmpDir, outDir, { recursive: true });
rmSync(tmpDir, { recursive: true, force: true });

const manifest = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8"),
);
const info = {
  generatedAt: new Date().toISOString(),
  codexVersion: resolved.version,
  codexPath: resolved.path,
  source: resolved.source,
  generator: "codex app-server generate-ts --experimental",
  appVersion: manifest.version,
};
writeFileSync(
  join(outDir, "PROTOCOL.json"),
  JSON.stringify(info, null, 2) + "\n",
);

const count = run(process.platform === "win32" ? "cmd" : "find", [
  ...(process.platform === "win32"
    ? ["/c", "dir", "/b", "/s", join(outDir, "*.ts")]
    : [outDir, "-name", "*.ts"]),
]);
const fileCount = (count.stdout.match(/\.ts$/gm) ?? []).length;
console.log(
  `gen-protocol: 完成，${fileCount} 个 .ts 类型文件 → protocol/generated`,
);
