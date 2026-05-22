# COI Mod Manager — API 统一优化计划

> 目标：Web 模式使用 Node.js 服务，Tauri 桌面模式使用 Tauri Rust 原生 API，前端通过同一套接口契约调用，底层自动切换实现。

## 一、当前 API 架构深度分析

### 1.1 当前调用链路

```
┌──────────────────────────────────────────────────────────────┐
│                      前端 (React)                             │
│                                                              │
│  ModStatusPage.tsx                                            │
│       ↓                                                      │
│  use-mod-scan.ts (状态管理)                                    │
│       ↓                                                      │
│  mod-api.ts (API 客户端)                                      │
│       │                                                      │
│       │  const API_BASE = import.meta.env.DEV                 │
│       │    ? ''                     // → Vite dev server      │
│       │    : 'http://localhost:5174' // → standalone server   │
│       │                                                      │
└───────┼──────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│              Node.js 服务端 (server/mod-api.ts)              │
│                                                           │
│  ┌─ Web Dev 模式 ──────────────────────────────────────┐  │
│  │  Vite Plugin Middleware → 端口 5173 复用           │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌─ Web Prod / Tauri Dev ─────────────────────────────┐  │
│  │  standalone.ts → HTTP Server → 端口 5174           │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌─ Tauri Prod ───────────────────────────────────────┐  │
│  │  lib.rs → spawn Node.js 子进程 → 端口 5174        │  │
│  │  需要: 找到 node.exe + server.mjs                  │  │
│  │  问题: 打包体积大，依赖外部 Node.js                 │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  1865 行业务逻辑：                                          │
│  ✓ 本地文件扫描 (collectLocalMods)                          │
│  ✓ Manifest 解析与匹配 (parseManifest, findHubListing)      │
│  ✓ COI Hub 网页抓取 (searchHub, HTML 解析)                  │
│  ✓ Hub Cookie 管理与认证 (ensureHubCookies)                 │
│  ✓ 分段并行下载 (8路并发)                                   │
│  ✓ 多策略下载降级 (PowerShell → curl → fetch)                │
│  ✓ ZIP 解压 (tar → PowerShell Expand-Archive)               │
│  ✓ 安装+备份+回滚 (upgradeMod)                              │
│  ✓ NDJSON 流式进度推送                                      │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│              Tauri Rust 端 (src-tauri/src/lib.rs)           │
│                                                           │
│  当前仅有：                                                 │
│  ✗ open_mod_directory — 用 opener 插件打开文件夹            │
│  ✗ spawn_api_server — 生产模式下启动 Node.js 子进程         │
│                                                           │
│  问题：Rust 端只是一个 shell，没有自己的业务能力               │
└───────────────────────────────────────────────────────────┘
```

### 1.2 当前架构的核心问题

| 问题 | 影响 |
|------|------|
| **Tauri 打包必须附带 Node.js** | 安装包体积 +50MB+，且需要查找系统 Node.js |
| **Node.js 子进程管理脆弱** | 启动失败、崩溃无感知、跨平台兼容困难 |
| **两个独立运行时** | Rust 进程管理 Node.js 进程，调试困难 |
| **Tauri 未发挥价值** | 斥资引入 Rust 但只用于启动 Node 进程 |
| **Web 和 Tauri 走同一路径** | 无法利用 Tauri 原生能力（文件系统、系统通知等） |

---

## 二、目标架构

### 2.1 前端统一接口层

前端不直接调用 fetch 或 Tauri invoke，而是通过一个 **API Service 抽象层**：

```
┌──────────────────────────────────────────────────────┐
│              前端业务层 (use-mod-scan.ts)               │
│                         ↓                            │
│              IModApiService 接口                       │
│                ↓              ↓                       │
│     HttpApiService      TauriApiService              │
│     (fetch → Node)    (invoke → Rust)                │
│                                                        │
│   选择逻辑:                                             │
│   if (window.__TAURI_INTERNALS__) → TauriApiService    │
│   else → HttpApiService                                │
└──────────────────────────────────────────────────────┘
```

### 2.2 后端双实现

```
Web 模式                        Tauri 桌面模式
┌─────────────────┐            ┌─────────────────────────┐
│ server/mod-api.ts│            │ src-tauri/src/          │
│ (1865 行 Node)   │            │ ├── commands/           │
│ 保持不变          │            │ │   ├── scan.rs        │
│                  │            │ │   ├── check.rs       │
│  Vite Plugin     │            │ │   ├── upgrade.rs     │
│  Middleware      │            │ │   └── mod.rs         │
│                  │            │ ├── hub/               │
│                  │            │ │   ├── client.rs      │
│                  │            │ │   ├── parser.rs      │
│                  │            │ │   └── cookies.rs     │
│                  │            │ ├── download/          │
│                  │            │ │   └── mod.rs         │
│                  │            │ └── lib.rs             │
│                  │            │                         │
│                  │            │ Tauri Commands          │
│                  │            │ + IPC Channel (stream)  │
└─────────────────┘            └─────────────────────────┘
```

---

## 三、API 接口契约设计

### 3.1 TypeScript 接口定义

```typescript
// src/features/mod-status/model/api-service.types.ts

/** 扫描事件流 */
export type ScanEvent =
  | { type: 'start'; dirPath: string; mods: ModRecord[] }
  | { type: 'mod'; mod: ModRecord }
  | { type: 'complete'; result: ScanModsResponse }
  | { type: 'error'; message: string }

/** 升级事件流 */
export type UpgradeEvent =
  | { type: 'progress'; progress: UpgradeProgress }
  | { type: 'complete'; result: ScanModsResponse }
  | { type: 'error'; message: string }

/** 统一 API 服务接口 */
export interface IModApiService {
  /** 快速本地扫描（不查 Hub） */
  localScan(): Promise<ScanModsResponse>

  /** 流式扫描（含 Hub 版本比对） */
  streamScan(onEvent: (event: ScanEvent) => void): Promise<ScanModsResponse>

  /** 检查单个 Mod */
  checkMod(installDir: string): Promise<ModRecord>

  /** 流式升级 */
  streamUpgrade(
    installDir: string,
    downloadUrl: string,
    hubPageUrl: string | undefined,
    onEvent: (event: UpgradeEvent) => void
  ): Promise<ScanModsResponse>
}
```

### 3.2 环境检测工厂

```typescript
// src/features/mod-status/model/api-service.ts

export function createApiService(): IModApiService {
  if (window.__TAURI_INTERNALS__) {
    return new TauriApiService()
  }
  return new HttpApiService()
}
```

### 3.3 Tauri Commands 对应关系

| 前端接口 | Tauri Command | Rust 函数 |
|----------|--------------|-----------|
| `localScan()` | `mod_local_scan` | `commands::scan::local_scan` |
| `streamScan(cb)` | `mod_stream_scan` + IPC Channel | `commands::scan::stream_scan` |
| `checkMod(dir)` | `mod_check` | `commands::check::check_mod` |
| `streamUpgrade(...)` | `mod_stream_upgrade` + IPC Channel | `commands::upgrade::stream_upgrade` |

---

## 四、Rust 实现范围与依赖分析

### 4.1 服务端功能清单与 Rust 可行性

| 功能 | Node.js 实现 | Rust 实现方案 | 难度 |
|------|-------------|--------------|------|
| **文件系统遍历** | `fs.readdir` 递归 | `std::fs::read_dir` + `walkdir` crate | ⭐ 简单 |
| **Manifest 解析** | `JSON.parse` | `serde_json::from_str` | ⭐ 简单 |
| **目录大小计算** | `du` 命令 | `walkdir` + `fs::metadata` | ⭐ 简单 |
| **HTTP 请求 (Hub)** | `fetch()` | `reqwest` crate + `cookie_store` | ⭐⭐ 中等 |
| **Cookie 管理** | `Map<string,string>` + 文件读写 | `reqwest::cookie::Jar` + 文件持久化 | ⭐⭐ 中等 |
| **HTML 解析** | 正则表达式 | `scraper` crate (CSS 选择器) | ⭐⭐ 中等 |
| **分段并行下载** | `fetch` + `Range` header | `reqwest` + `tokio::task::spawn` | ⭐⭐⭐ 较难 |
| **ZIP 解压** | `tar` / `Expand-Archive` | `zip` crate 原生解压 | ⭐⭐ 中等 |
| **安装+备份+回滚** | `fs.rename/cp/rm` | 同逻辑，Rust 原生 fs 操作 | ⭐⭐ 中等 |
| **流式进度推送** | NDJSON via HTTP response | Tauri IPC Channel | ⭐⭐ 中等 |
| **PowerShell/curl 降级** | `execFile` | 不需要（reqwest 原生足够） | — 简化 |

### 4.2 Cargo 依赖

```toml
[dependencies]
# HTTP 客户端（带 Cookie 管理）
reqwest = { version = "0.12", features = ["cookies", "stream", "json"] }
reqwest_cookie_store = "0.8"

# HTML 解析
scraper = "0.21"

# 异步运行时
tokio = { version = "1", features = ["full"] }

# ZIP 处理
zip = "2"

# 文件遍历
walkdir = "2"

# 序列化
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Tauri
tauri = { version = "2.11", features = [] }
tauri-plugin-opener = "2"
```

### 4.3 Rust 不需要实现的部分（保持 Node.js 独有）

| Node.js 特性 | 在 Rust 中 |
|-------------|-----------|
| PowerShell WebClient 下载 | `reqwest` 自带分段下载，性能更好 |
| curl 下载 | `reqwest` 替代 |
| `execFile` 子进程调用 | 不需要（Rust 原生） |
| Vite Plugin 中间件 | 不需要（Tauri 走 IPC） |

> **关键简化**：Rust 实现不需要多策略下载降级链！`reqwest` 本身就是最好的 HTTP 客户端，比 PowerShell/curl/fetch 更可靠，且原生支持分段下载和进度回调。

---

## 五、分阶段实施计划

### Phase 1：基础设施搭建（预计 4-6 小时）

**目标**：建立开发环境、类型系统和前后端通信框架。

```
任务 1.1  定义共享类型                                    [Rust + TS]
  ├── 创建 src/shared/types/api.ts（前端接口定义）
  ├── 在 Rust 中定义对应的 serde 结构体
  └── 确保两端的 JSON 序列化格式一致

任务 1.2  前端抽象层                                      [TypeScript]
  ├── 创建 IModApiService 接口
  ├── 实现 HttpApiService（包装现有 fetch 逻辑）
  ├── 实现 TauriApiService（骨架，后续填充）
  └── 实现 createApiService() 工厂函数

任务 1.3  前端迁移                                       [TypeScript]
  ├── use-mod-scan.ts 从直接调用 fetch 迁移到 IModApiService
  ├── 保持 ModStatusPage.tsx 行为完全不变
  └── 运行全量测试确认无回归

任务 1.4  Rust 项目骨架                                   [Rust]
  ├── 添加 Cargo 依赖（reqwest, scraper, zip, walkdir）
  ├── 创建 commands/ 模块结构
  └── 实现 local_scan command（最简可行版本）
```

**验收标准**：
- Web 模式行为与优化前完全一致
- Rust `local_scan` 命令能返回正确 JSON 结构
- 所有现有测试通过

### Phase 2：本地操作移植（预计 4-6 小时）

**目标**：将不依赖网络的本地操作移植到 Rust。

```
任务 2.1  文件扫描引擎                                   [Rust]
  ├── collect_local_mods：递归遍历 Mod 目录
  ├── read_manifest：读取并解析 manifest.json
  ├── get_mod_size：计算 Mod 目录大小
  └── 排序：按 displayName 排序

任务 2.2  localScan 完整实现                              [Rust + TS]
  ├── Rust: mod_local_scan command 完整实现
  ├── TS: TauriApiService.localScan() 调用 invoke
  └── 测试：Web 和 Tauri 返回相同结构

任务 2.3  checkMod 实现                                   [Rust]
  ├── Rust: mod_check command
  ├── 解析 manifest + 计算目录大小
  └── 暂不包含 Hub 版本比对（Phase 3）
```

**验收标准**：
- Tauri 模式下 `localScan()` 能正确扫描本地 Mod 目录
- 返回数据与 Node.js 版本结构一致
- Web 模式不受影响

### Phase 3：Hub 集成移植（预计 6-8 小时）

**目标**：将 COI Hub 网页抓取和 Cookie 认证移植到 Rust。

```
任务 3.1  Hub HTTP 客户端                                 [Rust]
  ├── reqwest 客户端配置（User-Agent、Headers 伪装）
  ├── Cookie Store 持久化（config/hub.json）
  └── Cookie 预热流程（ensureHubCookies → warmHubPage）

任务 3.2  Hub HTML 解析                                   [Rust]
  ├── searchHub：搜索 Hub Mod 列表
  ├── extractHubListings：HTML → HubListing[]
  ├── fetchModDetailInfo：下载链接 + 文件大小
  └── 使用 scraper crate CSS 选择器代替正则

任务 3.3  enrichMod 完整实现                              [Rust]
  ├── findHubListing：匹配算法
  ├── applyHubDetail：获取详细信息
  └── computeStatus：版本比较

任务 3.4  streamScan 完整实现                              [Rust + TS]
  ├── Rust: mod_stream_scan + IPC Channel
  ├── TS: TauriApiService.streamScan() 对接 Channel
  └── 流式推送 {start, mod, complete, error} 事件
```

**验收标准**：
- Tauri 模式下扫描结果包含 Hub 版本信息
- Cookie 自动获取和持久化正常工作
- 流式推送事件与 Node.js NDJSON 格式一致

### Phase 4：下载与升级移植（预计 6-8 小时）

**目标**：将下载、解压、安装流程移植到 Rust。

```
任务 4.1  下载引擎                                        [Rust]
  ├── probe_download_meta：探测文件大小和 Range 支持
  ├── download_single：单流下载
  ├── download_segmented：分段并行下载（8 路）
  └── 下载进度回调（通过 IPC Channel）

任务 4.2  解压引擎                                        [Rust]
  ├── zip crate 原生解压
  ├── locate_extracted_mod_root：找到 manifest.json
  └── 简化：不需要 tar/Expand-Archive 降级

任务 4.3  安装+备份+回滚                                    [Rust]
  ├── 备份当前 Mod 目录
  ├── 安装新版本
  ├── 恢复 Saved Settings + zh.json
  ├── 清理备份 / 失败回滚
  └── 重新扫描已更新 Mod

任务 4.4  streamUpgrade 完整实现                           [Rust + TS]
  ├── Rust: mod_stream_upgrade + IPC Channel
  ├── TS: TauriApiService.streamUpgrade() 对接 Channel
  └── 进度事件与 Node.js 版本格式一致
```

**验收标准**：
- Tauri 模式下能完成完整的 Mod 升级流程
- 升级过程有实时进度展示
- 升级失败能正确回滚

### Phase 5：清理与优化（预计 2-4 小时）

**目标**：移除不需要的 Node.js 依赖，简化 Tauri 打包。

```
任务 5.1  移除 Tauri 中的 Node.js 依赖                     [Rust]
  ├── 删除 spawn_api_server()
  ├── 删除 find_node_exe()
  ├── 删除 find_project_root()
  └── 移除 build:server 构建步骤

任务 5.2  更新打包配置                                      [Config]
  ├── 移除 resources 中的 node.exe 和 server.mjs
  ├── 更新 tauri.conf.json beforeBuildCommand
  └── 更新 CI/CD 脚本

任务 5.3  保留 Node.js 服务用于 Web 模式                      [Node]
  ├── server/mod-api.ts → 仅 Web 模式使用
  ├── standalone.ts → 仅 Web 模式使用
  └── 添加注释标记两个实现的对应关系

任务 5.4  清理适配器层死代码                                  [TS]
  ├── 合并 Phase 1 清理计划（死代码删除）
  └── open-directory.ts 路由到 Tauri command
```

**验收标准**：
- Tauri 打包不再需要 Node.js
- 安装包体积显著减小
- Web 模式行为和 Tauri 模式行为一致

---

## 六、前端迁移策略（最小侵入）

### 6.1 use-mod-scan.ts 改造

当前 `use-mod-scan.ts` 直接调用 `localScan`、`checkMod`、`upgradeMod` 等函数。改造后通过注入的 service 调用：

```typescript
// 改造前
import { localScan, checkMod, upgradeMod } from './mod-api'

// 改造后
import { createApiService, type IModApiService } from './api-service'

export function useModScan(service?: IModApiService) {
  const api = service ?? createApiService()
  // ... 通过 api.localScan() 等调用
}
```

### 6.2 流式传输适配

**Node.js 模式**（NDJSON over HTTP）→ 保持不变

**Tauri 模式**（IPC Channel）→ 转换层：

```typescript
// TauriApiService 中
import { Channel } from '@tauri-apps/api/core'

async streamScan(onEvent: (e: ScanEvent) => void): Promise<ScanModsResponse> {
  return new Promise((resolve, reject) => {
    const channel = new Channel<ScanEvent>()
    channel.onmessage = (event) => {
      onEvent(event)
      if (event.type === 'complete') resolve(event.result)
      if (event.type === 'error') reject(new Error(event.message))
    }
    invoke('mod_stream_scan', { channel })
  })
}
```

---

## 七、风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| reqwest Cookie 管理与 Hub 网站不兼容 | 高 | 预留 Cookie 文件手动配置机制（同 `config/hub.json`），Phase 3 先做充分测试 |
| HTML 解析准确度不足 | 中 | scraper crate 选择器比正则更精准；保留 Node 版实现作为对照 |
| 分段下载实现复杂 | 中 | 先用单流下载完成 MVP，分段下载作为优化项延后 |
| Rust 开发效率低于 Node.js | 中 | 每个 Phase 小块迭代，先跑通再完善 |
| 前后端接口不一致 | 低 | 共享类型定义 + 序列化快照测试 |
| Tauri IPC Channel 限制 | 低 | Tauri 2.x 原生支持，测试覆盖流式场景 |

---

## 八、工期估算

| Phase | 内容 | 预估工时 | 依赖 |
|-------|------|----------|------|
| Phase 1 | 基础设施搭建 | 4-6h | 无 |
| Phase 2 | 本地操作移植 | 4-6h | Phase 1 |
| Phase 3 | Hub 集成移植 | 6-8h | Phase 2 |
| Phase 4 | 下载与升级移植 | 6-8h | Phase 3 |
| Phase 5 | 清理与优化 | 2-4h | Phase 4 |
| **合计** | | **22-32h** | |

> 总代码量预估：Rust ~2500 行，TypeScript 改动 ~200 行（接口层 + 适配器）。

---

## 九、Phase 1 之后可交付的最小可行版本

完成 Phase 1+2 后即可获得一个可用的中间状态：

- ✅ Tauri 模式下 `localScan()` 通过 Rust 原生实现
- ✅ Tauri 模式下 `checkMod()` 本地部分通过 Rust 实现
- ✅ `streamScan()` 和 `streamUpgrade()` 临时回退到 Node.js（Tauri spawn 方式）
- ✅ 前端通过统一接口调用，下层切换透明

这允许逐步迁移，每个 Phase 都有独立价值。

---

> **最后更新**：2026-05-22
> **下一步**：确认是否开始 Phase 1
