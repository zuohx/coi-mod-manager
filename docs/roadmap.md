# COI Mod Manager — 开发路线图

> 本文档记录项目的计划中的改进和重构目标。

---

## 计划中的改进

### 方案④：Rust 原生 API 服务器（高优先级）

**问题：** 当前架构依赖 Node.js 运行时来提供 API 服务。Tauri 应用启动时通过 `sidecar` 模式启动一个 Node.js 进程，用于处理 Mod Hub 的抓取、下载、升级等操作。这意味着用户必须安装 Node.js 才能使用完整功能。

**目标：** 用 Rust 重写全部后端逻辑，彻底消除 Node.js 依赖。

**涉及范围：**

| 模块 | 当前实现 | 目标 |
|------|---------|------|
| HTTP 请求 | Node.js `fetch()` | Rust `reqwest` 或 `ureq` |
| HTML 解析 | 正则表达式解析 | Rust `scraper` 或 `tl` |
| ZIP 解压 | 调用系统 `tar` 或 PowerShell | Rust `zip` crate |
| 文件系统操作 | Node.js `fs` | Rust `std::fs` + `tokio::fs` |
| 并发任务 | Node.js Promise.all + 并发控制 | Rust `tokio` + semaphore |
| HTTP 服务器 | Node.js `http.createServer` | Rust `axum` 或 `actix-web` |
| 静态文件服务 | Node.js 自定义静态文件 handler | Rust `axum` + `tower-http` |
| Cookie 管理 | 内存 Map | Rust HashMap + 持久化 |

**优势：**
- 零外部运行时依赖，单 exe 分发
- Startup 时间更快（无需启动 Node.js 子进程）
- 内存占用更低
- 更安全的子进程管理（无需 `hide_command_window` hack）

**预计工作量：** 中到大（约 400-800 行 Rust 代码）

**建议的迁移策略：**
1. 从核心 HTTP 请求层开始（`reqwest` + cookie 管理）
2. 移植 `server/mod-api.ts` 中每个独立函数（`collectLocalMods`, `enrichMod`, `searchHub` 等）
3. 移植下载和分段下载逻辑
4. 用 `axum` 构建 HTTP 路由层
5. 接入 `tower-http` 提供静态文件服务
6. 替换 `src-tauri/src/lib.rs` 中的 `spawn_api_server()` 为直接调用 Rust API 函数
7. 移除 `dist-server/` 构建步骤和 `esbuild` 依赖
8. 移除 `server/` 目录

---

### 其他计划

- **自动更新机制** — 集成 Tauri updater，检查 GitHub Release 并自动下载新版本
- **Mod 配置界面** — 可视化管理每个 Mod 的 Saved Settings
- **多语言支持** — 完善国际化（i18n），支持中文/英文界面
- **离线模式** — 在无网络环境下仅显示本地 Mod 信息，不尝试连接 Hub
