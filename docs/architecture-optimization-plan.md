# COI Mod Manager — 架构优化计划

> 基于 2026-05-21 项目分析报告，针对发现的架构问题制定分阶段优化方案。

## 问题全景图

经过代码引用链追踪，实际运行时链路极简：

```
main.tsx → App.tsx → ModStatusPage.tsx → use-mod-scan.ts → mod-api.ts → server/mod-api.ts
                                                                                    ↑
                              open-directory.ts (唯一被使用的适配器)                    
```

而项目声明了完整的 **Feature-Sliced + 六边形架构**，其中大量模块处于"设计但未接通"状态：

| 模块 | 状态 | 说明 |
|------|------|------|
| `domain/mod/types.ts` | 🟡 仅被死代码引用 | 类型系统实际在 server 和 features 中各有一套 |
| `domain/mod/parse-manifest.ts` | 🔴 仅被死代码引用 | 实际解析在 server 端完成 |
| `domain/mod/compute-status.ts` | 🔴 仅被死代码引用 | 实际状态计算在 server 端完成 |
| `domain/mod/match-mod.ts` | 🔴 仅被死代码引用 | 实际匹配逻辑在 server 端完成 |
| `domain/mod/ports.ts` | 🔴 零引用 | 接口定义未被实现 |
| `adapters/cohub/cohub-client.ts` | 🔴 仅测试引用 | 调用不存在的 API，Hub 集成全在 server |
| `adapters/file/web-manifest-reader.ts` | 🔴 仅测试引用 | 文件读取在 server 端完成 |
| `adapters/file/web-directory-picker.ts` | 🔴 仅测试引用 | 目录选择在 server 端完成 |
| `adapters/platform/capabilities.ts` | 🔴 仅测试引用 | 能力检测未接入任何功能 |
| `adapters/platform/open-directory.ts` | 🟢 生产使用 | 唯一存活的适配器 |
| `app/routes.tsx` | 🔴 零引用 | react-router-dom 完全闲置 |
| `pnpm-workspace.yaml` | 🟡 仅 esbuild 构建许可 | 非真正 workspace 用法 |
| `shared/lib/result.ts` | 🟡 仅被死代码+测试引用 | Result 类型未被功能层使用 |
| `shared/lib/semver.ts` | 🟡 仅被死代码引用 | server 端有独立版本比较逻辑 |

**核心矛盾**：项目有两套平行的类型系统和业务逻辑 — 一套在设计层（domain/adapters），一套在实际运行层（server + features），两者从未真正对接。

---

## 优化总览

```
Phase 1 (立即 / 低风险)        Phase 2 (短期 / 中风险)        Phase 3 (中期 / 高风险)
┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
│ P1-1  删除 routes.tsx│       │ P2-1  统一类型系统   │       │ P3-1  前端领域层复活  │
│ P1-2  清理 dead deps │       │ P2-2  提取共享包    │       │       或正式废弃     │
│ P1-3  删除死代码文件  │       │ P2-3  瘦身 adapters │       │ P3-2  引入 E2E 测试  │
│ P1-4  废弃 pnpm-ws   │       └─────────────────────┘       └─────────────────────┘
└─────────────────────┘
```

---

## Phase 1：清理死代码（预计 1-2 小时，零风险）

**目标**：删除所有确定不会被使用的代码和依赖，减少维护负担和认知负载。

### P1-1：删除空壳路由系统

**文件**：`src/app/routes.tsx`

**操作**：
```bash
rm src/app/routes.tsx
```

**连带清理**：
```bash
pnpm remove react-router-dom
```

**验证**：`pnpm build && pnpm test` 全部通过。

### P1-2：清理死依赖

从 `package.json` 移除 `react-router-dom`（已在 P1-1 处理）。

潜在可评估移除的依赖（需要在清理死代码后最终确认）：
- `@testing-library/react` — 如果仅剩的 ModStatusPage 测试改用纯 vitest

### P1-3：删除死代码文件

| 文件 | 原因 | 连带影响 |
|------|------|----------|
| `src/adapters/cohub/cohub-client.ts` | 调用不存在 API，零生产引用 | 测试文件一并删除 |
| `src/adapters/file/web-manifest-reader.ts` | 文件读取在 server 端完成 | 测试文件一并删除 |
| `src/adapters/file/web-directory-picker.ts` | 目录选择在 server 端完成 | 测试文件一并删除 |
| `src/adapters/platform/capabilities.ts` | 能力检测未接入功能 | 测试文件一并删除 |
| `src/domain/mod/ports.ts` | 零实现零引用 | 无测试文件 |

**对应的测试文件一并删除**：
- `src/test/adapters/cohub-client.test.ts`
- `src/test/adapters/web-manifest-reader.test.ts`
- `src/test/adapters/web-directory-picker.test.ts`
- `src/test/adapters/capabilities.test.ts`

**保留但标记**（Phase 2 决定去留）：
- `src/domain/mod/types.ts` — 定义清晰，可能作为共享类型源
- `src/domain/mod/parse-manifest.ts` — 纯函数逻辑，可能复用
- `src/domain/mod/compute-status.ts` — 纯函数逻辑，可能复用
- `src/domain/mod/match-mod.ts` — 纯函数逻辑，可能复用
- `src/shared/lib/result.ts` — 工具类型，可能复用
- `src/shared/lib/semver.ts` — 工具函数，可能复用
- 以上对应的测试文件保留

### P1-4：评估 pnpm-workspace.yaml

当前内容仅 `allowBuilds: { esbuild: true }`，不是真正的 workspace 配置。

**决策**：保留。虽然语义上是 workspace 文件，但 esbuild 的 native 模块确实需要 pnpm 的构建许可。这不是问题，不需要动。

---

## Phase 2：统一类型系统（预计 3-4 小时，中等风险）

**目标**：消除 server 端与前端 features 层之间的类型重复，建立单一真相源。

### P2-1：提取共享类型包

当前类型重复情况：

| 概念 | server/mod-api.ts | features/model/mod-api.ts | 备注 |
|------|-------------------|---------------------------|------|
| ModStatus | `'up_to_date' \| 'update_available' \| 'unknown'` | 同左 | 完全重复 |
| Mod 记录 | `ApiModRecord`（11 字段） | `ModRecord`（10 字段 + checkingStatus） | 同源异构 |
| UpgradeProgress | 无 | `UpgradeProgress`（3 字段） | server 端通过字符串传 |
| ScanResponse | `ScanResponse`（2 字段） | `ScanModsResponse`（2 字段） | 完全重复 |

**方案**：创建 `src/shared/types/mod.ts` 作为唯一类型源：

```typescript
// src/shared/types/mod.ts

/** Mod 版本状态 */
export type ModStatus = 'up_to_date' | 'update_available' | 'unknown'

/** Mod 检查状态（前端特有） */
export type CheckingStatus = 'pending' | 'checking' | 'done'

/** 升级进度阶段 */
export type UpgradePhase = 'resolving' | 'downloading' | 'extracting' | 'installing' | 'scanning' | 'completed'

/** 升级进度 */
export interface UpgradeProgress {
  phase: UpgradePhase
  message: string
  percent?: number
}

/** API 响应的 Mod 记录（与 server 端 API 契约一致） */
export interface ApiModRecord {
  id: string
  displayName: string
  version: string
  sizeText: string
  sizeLoading?: boolean
  remoteVersion?: string
  url?: string
  downloadUrl?: string
  status: ModStatus
  manifestPath: string
  installDir: string
}

/** 扫描响应 */
export interface ScanResponse {
  dirPath: string
  mods: ApiModRecord[]
}

/** 前端 Mod 记录（扩展 checkingStatus） */
export interface ModRecord extends ApiModRecord {
  checkingStatus?: CheckingStatus
}
```

**迁移步骤**：

1. 创建 `src/shared/types/mod.ts`
2. 修改 `src/features/mod-status/model/mod-api.ts`：删除类型定义，改为从 `@/shared/types/mod` 导入
3. 修改 `server/mod-api.ts`：无法直接 import 前端文件（运行在不同环境），采用 **复制+注释同步标记** 方案，在 server 端添加注释：
   ```typescript
   // ⚠️ SYNC: 此类型与 src/shared/types/mod.ts 中的 ApiModRecord 保持同步
   // 由于 server 运行在 Node 环境，无法直接 import 前端 TS 模块
   ```
4. 添加 CI 检查：编写脚本对比两处类型定义，不一致时报错

### P2-2：提取共享纯函数

将 domain 层中仍有价值的纯函数提升为真正的共享模块：

| 函数 | 当前位置 | 目标位置 | 说明 |
|------|----------|----------|------|
| `parseManifest` | `domain/mod/parse-manifest.ts` | `shared/lib/manifest.ts` | Manifest JSON 解析，前端验证可用 |
| `compareVersions` | `shared/lib/semver.ts` | 保留并补充测试 | 已存在但未被功能层使用 |
| `computeStatus` | `domain/mod/compute-status.ts` | `shared/lib/mod-status.ts` | 状态计算逻辑，可复用于前端乐观更新 |
| `matchMod` | `domain/mod/match-mod.ts` | `shared/lib/mod-match.ts` | 匹配逻辑，可复用于前端搜索 |

### P2-3：瘦身 adapters 目录

Phase 1 删除死代码后，adapters 目录仅剩：

```
src/adapters/
└── platform/
    └── open-directory.ts   ← 唯一存活
```

**决策**：将 `open-directory.ts` 移到 `src/shared/platform/open-directory.ts`，删除空的 `src/adapters/` 目录。

---

## Phase 3：架构决策与补强（预计 4-6 小时，高风险）

**目标**：对前端领域层的去留做出明确决策，并补充工程基础设施。

### P3-1：前端领域层 — 复活还是废弃

有两种路线：

#### 路线 A：复活（推荐，如果未来有离线/客户端计算需求）

将 domain 层纯函数对接到 features 层，实现前端独立计算能力：

```
ModStatusPage → use-mod-scan
                  ├── 本地扫描 → server API（不变）
                  ├── 版本比较 → shared/lib/mod-status.ts（前端计算）
                  └── Hub 匹配 → server API（不变）
```

**收益**：减少一次网络往返，更新状态判断可前端完成。

**成本**：需要重构 use-mod-scan 的状态更新逻辑。

#### 路线 B：废弃（推荐，如果保持当前架构不变）

直接删除 domain 层所有文件，承认当前架构是"瘦前端 + 胖服务端"。

**收益**：彻底消除认知负载。

**成本**：损失了已有的纯函数实现和测试。

**建议**：选择路线 B，因为：
1. COI Hub 无公开 API，全靠 server 端抓取 HTML，前端无法独立完成
2. 项目本质是"本地 Mod 扫描器 + Hub 网页抓取器"，不是分布式系统
3. 保持简单比架构纯粹更重要

### P3-2：引入 E2E 测试

当前 16 个测试文件全部是单元测试，缺少端到端验证。

**推荐工具**：Playwright（已有 `playwright-cli` skill）

**覆盖场景**：
1. 页面加载 → 自动扫描 → 显示 Mod 列表
2. 筛选 Mod（按名称搜索、按状态过滤）
3. 单个 Mod 更新流程（需要 mock server）
4. 主题切换持久化

### P3-3：CI/CD 检查

在 GitHub Actions 中增加：
- 类型一致性检查脚本（P2-1 的同步标记校验）
- Dead import 检查（`ts-prune` 或 `knip`）

---

## 执行优先级矩阵

| 优化项 | 影响范围 | 风险 | 收益 | 建议顺序 |
|--------|----------|------|------|----------|
| P1-1 删除 routes.tsx | 1 文件 + 1 依赖 | 无 | 中 | **1** |
| P1-3 删除死代码 | ~10 文件 | 低 | 高 | **2** |
| P2-1 统一类型系统 | ~4 文件 | 中 | 高 | **3** |
| P2-3 瘦身 adapters | 1 文件 | 低 | 低 | **4** |
| P2-2 提取共享函数 | ~4 文件 | 中 | 中 | **5** |
| P3-1 领域层决策 | ~5 文件 | 高 | 中 | **6** |
| P3-2 E2E 测试 | 新增 | 低 | 高 | **7** |
| P3-3 CI 检查 | 新增 | 低 | 中 | **8** |

---

## 风险评估

| 风险 | 概率 | 缓解措施 |
|------|------|----------|
| 删除文件后测试失败 | 中 | 先删死代码对应测试，再运行全量测试 |
| 类型迁移导致 API 契约断裂 | 中 | 使用 extends 保持向后兼容 |
| server 端类型无法同步 | 高 | 使用注释标记 + CI 校验脚本代替 import |
| 重构引入回归 bug | 低 | 每个 Phase 完成后运行全量测试 |

---

## 预期成果

完成后项目结构：

```
src/
├── features/mod-status/       # 唯一功能模块
│   ├── model/
│   │   ├── mod-api.ts         # 前端 API 客户端（类型从 shared 导入）
│   │   └── use-mod-scan.ts    # 状态管理 Hook
│   └── ui/
│       ├── ModStatusPage.tsx   # 主页面组件
│       └── ModStatusPage.css
├── shared/
│   ├── types/
│   │   └── mod.ts             # 唯一类型源
│   ├── lib/
│   │   ├── result.ts          # Result 工具类型
│   │   └── semver.ts          # 版本比较
│   └── platform/
│       └── open-directory.ts  # 唯一适配器
├── app/
│   ├── App.tsx
│   ├── App.css
│   └── providers.tsx
├── test/                      # 测试文件（同步清理）
├── main.tsx
├── index.css
└── vite-env.d.ts

server/
├── mod-api.ts                 # Vite 插件 + API 实现
└── standalone.ts              # 独立服务器入口
```

文件数从 **40 个源文件** 精简到约 **25 个**，测试从 **16 个** 精简到约 **11 个**。

---

> **最后更新**：2026-05-21
> **下一步**：确认是否开始执行 Phase 1
