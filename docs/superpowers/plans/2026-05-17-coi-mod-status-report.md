# Captain of Industry Mod Status Report 实现计划

## 1. 实现思路

先按 **核心领域层 / 适配层 / 界面编排层** 三层落地，避免把浏览器能力、COI Hub 请求和业务规则写死在 React 组件里。

- **核心领域层**：只处理 `manifest.json` 解析、匹配规则、版本状态计算，不依赖 React 和浏览器 API。
- **适配层**：封装目录选择、文件读取、COI Hub 查询、平台能力探测；Web MVP 先实现只读能力。
- **界面编排层**：负责页面状态、批量检查、人工确认候选项、错误提示和表格展示。

关键数据草图：

```ts
type ManifestSummary = {
  id: string
  version: string
  displayName: string
  authors: string[]
}

type HubCandidate = {
  remoteId: string
  title: string
  version?: string
  exact: boolean
  score: number
}

type MatchStatus = 'exact' | 'candidate_required' | 'unmatched'
type UpdateStatus = 'up_to_date' | 'update_available' | 'unknown'

type ModStatusRow = {
  local: ManifestSummary
  remote?: HubCandidate
  candidates?: HubCandidate[]
  matchStatus: MatchStatus
  updateStatus: UpdateStatus
}
```

## 2. 建议文件结构

```text
.
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ index.html
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ app/
│  │  ├─ providers.tsx
│  │  └─ routes.tsx
│  ├─ domain/
│  │  └─ mod/
│  │     ├─ types.ts
│  │     ├─ parse-manifest.ts
│  │     ├─ match-mod.ts
│  │     ├─ compute-status.ts
│  │     └─ ports.ts
│  ├─ adapters/
│  │  ├─ file/
│  │  │  ├─ web-directory-picker.ts
│  │  │  └─ web-manifest-reader.ts
│  │  ├─ cohub/
│  │  │  ├─ cohub-client.ts
│  │  │  └─ cohub-mapper.ts
│  │  └─ platform/
│  │     └─ capabilities.ts
│  ├─ features/mod-status/
│  │  ├─ model/use-mod-scan.ts
│  │  ├─ model/use-bulk-version-check.ts
│  │  ├─ ui/mod-status-page.tsx
│  │  ├─ ui/mod-status-table.tsx
│  │  ├─ ui/match-status-badge.tsx
│  │  └─ ui/candidate-confirm-dialog.tsx
│  ├─ shared/
│  │  ├─ lib/result.ts
│  │  ├─ lib/semver.ts
│  │  └─ ui/
│  └─ tests/
│     ├─ fixtures/
│     ├─ domain/
│     ├─ adapters/
│     └─ features/
└─ docs/
   └─ local-extension-boundary.md
```

## 3. 按实现顺序拆解的任务

### T1 项目基础设施
- **目标**：搭好 Vite + React + TypeScript 工程骨架，接入测试框架与基础 UI。
- **涉及**：`package.json`、`vite.config.ts`、`tsconfig.json`、`src/main.tsx`、`src/App.tsx`、`src/app/*`
- **依赖**：无

### T2 核心领域层
- **目标**：先把可复用业务规则做出来，包括 manifest 解析、COI Hub 匹配策略、版本状态计算。
- **涉及**：`src/domain/mod/*`、`src/shared/lib/result.ts`、`src/shared/lib/semver.ts`
- **依赖**：T1
- **说明**：匹配规则固定为“优先精确匹配；否则返回候选项供确认”。

### T3 Web 适配层
- **目标**：实现浏览器目录选择、遍历 Mods 子目录、读取 `manifest.json`、请求 COI Hub。
- **涉及**：`src/adapters/file/*`、`src/adapters/cohub/*`、`src/adapters/platform/capabilities.ts`
- **依赖**：T2
- **说明**：目录访问依赖 File System Access API；不支持时给出明确降级提示。

### T4 页面编排与交互
- **目标**：完成主流程：选目录、扫描、展示、批量检查、人工确认候选项。
- **涉及**：`src/features/mod-status/model/*`、`src/features/mod-status/ui/*`
- **依赖**：T3
- **说明**：人工确认结果仅保存在当前会话态，不落盘。

### T5 集成收口与未来扩展口
- **目标**：统一异常处理、补齐边界状态、沉淀未来 Tauri/helper 接口。
- **涉及**：`src/adapters/platform/capabilities.ts`、`docs/local-extension-boundary.md`、相关页面与 hooks
- **依赖**：T4
- **说明**：预留 `pickModsDirectory`、`readManifest`、`writeManifest`、`launchHelper` 等能力接口，但本期只实现只读版本。

## 4. 测试建议

- **单元测试**：优先覆盖 `parse-manifest`、`match-mod`、`compute-status`，验证缺字段、无效 JSON、精确匹配、候选回退、版本比较。
- **适配层测试**：mock COI Hub 返回，覆盖成功、空结果、超时、异常映射。
- **组件测试**：验证表格列展示、批量检查按钮状态、候选确认弹窗交互。
- **集成测试**：用 fixtures 模拟多个 mod 目录，覆盖“全部精确匹配 / 部分人工确认 / 全部无匹配”。
- **手工验证**：Chrome/Edge 下目录选择是否正常；弱网时批量检查是否可恢复。

## 5. 优先抽象的可复用核心层

1. `ManifestSummary` 解析与校验逻辑  
2. COI Hub 结果到领域对象的映射  
3. “精确匹配优先、候选回退”的匹配策略  
4. 本地/远程版本对比与状态计算  
5. 平台能力接口定义（Web、Tauri、helper 共用）

这些应保持 **无 UI、无平台依赖**，未来桌面版直接复用。

## 6. Web MVP 与未来本地增强版边界

### 本期要做
- 选择整个 Mods 目录
- 扫描每个 Mod 的 `manifest.json`
- 查询 COI Hub
- 展示本地版本、远程版本、匹配状态、更新状态
- 支持“检查全部 Mod 版本”
- 对非精确匹配提供人工确认

### 本期不做
- 修改本地 `manifest.json`
- 自动下载或更新 Mod
- 后台常驻扫描
- 本地路径持久化与系统级权限管理

### 未来增强版预留
- Tauri 或 helper 接管更稳定的目录访问
- 真正的文件写回与批量修正
- 后台任务、缓存、断点恢复
- 本地索引与更强的模糊匹配策略

整体原则是：**先把业务规则做成纯核心层，再把 Web 只读能力薄封装到适配层，React 只负责编排与展示**。这样后续切到桌面增强版时，不需要重写主流程。
