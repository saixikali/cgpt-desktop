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
  main/            主进程：Codex app-server 传输/RPC、审批、IPC 注册、PTY、托盘、窗口
    codex/         RPC 客户端、传输层、审批与通知、CLI 定位/更新/诊断
    ipc/           IPC handler 注册与路径守卫
    pty/           集成终端（ConPTY）
  preload/         contextBridge 安全桥接
  renderer/        React 渲染端（页面、组件、zustand stores、i18n）
  shared/ipc/      跨进程 IPC 通道名与 zod 契约
protocol/generated/ 由 codex PROTOCOL.json 生成的 TypeScript 类型
scripts/           协议生成、图标生成与开发期诊断脚本
build/、resources/  安装与运行时图标资源
```

## 许可证

MIT
