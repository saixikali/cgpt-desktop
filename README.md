# Cgpt Desktop

适配本机 [OpenAI Codex CLI](https://github.com/openai/codex) 的 Windows 桌面客户端。Electron 44 + React 18 + electron-vite + TypeScript（strict），深色中文界面，NSIS x64 安装包。

应用本身**不内置 codex**，运行时自动发现并连接本机已安装的 Codex CLI（app-server 模式）。

## 功能

- **会话管理**：多线程会话列表、历史搜索、线程归档/删除、深链（`cgpt-desktop://`）定位会话。
- **对话与流式输出**：Markdown 渲染（GFM、代码高亮、大文本节流）、回合进行中追加指令（steer）、停止当前回合。
- **当轮参数覆盖**：在不修改全局配置的前提下，为单个回合/新会话指定模型与推理力度（reasoning effort）。
- **审批体系**：命令执行 / 文件修改审批卡片，支持「拒绝 / 允许 / 本次会话始终允许」，并发审批全部展示；决议在 RPC 不可写时不会被误核销。
- **集成终端**：基于 node-pty 的 ConPTY 终端，输出环形截断防止超长日志拖慢界面。
- **MCP**：展示 MCP 服务器状态，支持 elicitation 表单交互。
- **系统集成**：托盘、Windows 通知、窗口状态记忆、首次使用向导（引导定位 codex 与工作目录）。
- **安全边界**：IPC 契约经 zod 校验；终端启动目录与文件操作经路径守卫（realpath 防 symlink/junction 穿越）；渲染端不接触 token。

## 环境要求

- Windows 10/11 x64
- 本机已安装 Codex CLI 并完成登录（apikey 或 ChatGPT 账号均可）
- 开发：Node.js 18+、npm

## 开发

```powershell
npm install
npm run dev
```

类型检查（主进程/预加载与渲染端两个工程）：

```powershell
npm run typecheck
```

## 构建与打包

```powershell
npm run build        # electron-vite 产物到 out/
npm run dist:win     # 构建 + electron-builder，产物在 dist/
```

输出安装包：`dist/Cgpt-Desktop-<version>-x64-setup.exe`（per-user NSIS，可选安装目录、开始菜单/桌面快捷方式）。

> `node-pty` 使用自带 prebuilds，打包时 `npmRebuild: false`，无需 node-gyp。
> 国内网络可使用仓库自带 `.npmrc` 中配置的 electron / electron-builder 镜像。

## 协议类型

Codex app-server 的 JSON-RPC 协议类型由脚本生成：

```powershell
npm run gen:protocol
```

生成结果位于 `protocol/generated/`，已提交到仓库，主进程与渲染端共享引用。

## 目录结构

```
src/
├─ main/                       主进程
│  ├─ codex/                   Codex 适配层
│  │  ├─ rpc-client.ts         JSON-RPC 客户端（请求/通知/断连重连）
│  │  ├─ app-server-transport.ts  app-server 子进程与 stdio 传输（含背压处理）
│  │  ├─ codex-api.ts          RPC 方法封装（线程、回合、审批、登录等）
│  │  ├─ codex-resolver.ts     本机 codex 可执行文件发现
│  │  ├─ approvals.ts          审批登记/决议/TTL 与系统通知联动
│  │  ├─ notifications.ts      Codex 服务端通知订阅
│  │  └─ cli-tools.ts          CLI 更新、取消更新与 doctor 诊断
│  ├─ ipc/
│  │  ├─ register-ipc.ts       全部 IPC handler 注册
│  │  └─ path-guard.ts         路径守卫（realpath，防 symlink/junction 穿越）
│  ├─ pty/terminal-service.ts  集成终端（node-pty / ConPTY）
│  ├─ backend-service.ts       Codex 后端生命周期管理
│  ├─ window.ts / tray.ts      窗口与托盘
│  ├─ app-settings.ts          用户设置读写（%APPDATA%\Cgpt Desktop）
│  ├─ notifications.ts         Windows 系统通知
│  ├─ window-state.ts / logging.ts / index.ts
├─ preload/index.ts            contextBridge 安全桥接（window.cgpt）
├─ renderer/src/               React 渲染端
│  ├─ pages/
│  │  ├─ chat/                 会话页（列表、会话窗、输入框、导航栏）
│  │  ├─ settings/sections/    设置页（账号、Codex、模型、MCP、配置、诊断等）
│  │  └─ wizard/               首次使用向导
│  ├─ components/
│  │  ├─ approvals-dock.tsx    底部审批坞（并发审批卡片）
│  │  ├─ timeline.tsx          会话时间线（消息/命令/工具调用）
│  │  ├─ markdown.tsx          Markdown 渲染（节流、代码高亮、链接白名单）
│  │  ├─ terminal/             集成终端组件（xterm.js）
│  │  ├─ ui/                   基础 UI 组件（Button/Dialog/Input 等）
│  │  └─ titlebar / toast-viewport / backend-banner
│  ├─ store/                   zustand 状态（threads、thread-view、approvals、
│  │                           terminal、settings、toast、turn-overrides 等）
│  ├─ i18n/zh.ts               中文文案
│  ├─ lib/                     IPC 调用封装与工具函数
│  └─ App.tsx / main.tsx / styles.css
├─ shared/ipc/
│  ├─ channels.ts              IPC 通道名常量
│  └─ contract.ts              跨进程 zod 契约（主/渲染/预加载共享类型）
└─ shared/globals.d.ts

protocol/generated/            由 codex PROTOCOL.json 生成的 TS 类型（含生成脚本）
scripts/                       协议/图标生成脚本与开发期诊断脚本（lib/ 为辅助库）
build/icon.ico                 NSIS 与窗口图标
resources/                     运行时托盘/通知图标（*.png，electron-builder extraResources）

electron.vite.config.ts        electron-vite 构建配置
electron-builder.yml           NSIS x64 打包配置（asarUnpack node-pty、深链协议）
tsconfig.json / tsconfig.node.json / tsconfig.web.json  双工程 TS strict 配置
.npmrc                         electron 与 electron-builder 国内镜像
package.json
```

## 许可证

MIT
