# Captain of Industry Mod Manager

[![Build](https://github.com/zuohx/coi-mod-manager/actions/workflows/release.yml/badge.svg)](https://github.com/zuohx/coi-mod-manager/actions/workflows/release.yml)

Captain of Industry (COI) 模组管理器 - 用于管理 COI 游戏模组的桌面应用，支持 Web 和 Tauri 桌面两种运行模式。

## 技术栈

- **前端**: React 19 + TypeScript + Vite 6
- **桌面端**: Tauri 2.x (Rust)
- **测试**: Vitest + Testing Library + jsdom
- **包管理**: pnpm

## 环境要求

- **Node.js** >= 18
- **Rust** (仅 Tauri 桌面开发需要)
- **pnpm**

### 安装 Rust (仅 Tauri 开发)

```bash
# Windows (PowerShell)
winget install Rustlang.Rustup

# macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

安装后重启终端，验证：

```bash
rustc --version
cargo --version
```

## 本地开发

### 1. 克隆仓库

```bash
git clone https://github.com/zuohx/coi-mod-manager.git
cd coi-mod-manager
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 启动开发服务器

**仅 Web 模式** (浏览器访问 http://localhost:5173)：

```bash
pnpm dev
```

**Tauri 桌面模式** (需要安装 Rust)：

```bash
pnpm tauri:dev
```

## 可用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Vite 开发服务器 (Web) |
| `pnpm build` | TypeScript 检查 + Vite 生产构建 |
| `pnpm preview` | 预览生产构建产物 |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm tauri:dev` | 启动 Tauri 桌面开发模式 |
| `pnpm tauri:build` | 构建 Tauri 桌面安装包 |

## 项目结构

```
├── src/                    # 前端源码
│   ├── adapters/           # 外部服务适配层
│   │   ├── file/           # 文件系统访问 (目录选择、manifest 读取)
│   │   ├── cohub/          # COI Hub API 客户端
│   │   └── platform/       # 平台能力检测
│   ├── domain/             # 核心业务逻辑 (manifest 解析、版本状态计算)
│   ├── features/           # 功能模块 (按功能组织)
│   │   └── mod-status/     # 模组状态管理
│   ├── shared/             # 共享工具 (Result 类型、semver 解析)
│   └── app/                # 应用外壳 (路由、Providers)
├── server/                 # Vite 服务端插件 (mod 操作 API)
├── src-tauri/              # Tauri 桌面端 (Rust)
├── config/                 # 配置文件
├── public/                 # 静态资源
└── docs/                   # 项目文档
```

## 架构说明

- **Feature-Sliced Design**: 功能模块自包含，每个模块包含 `model/` (数据层) 和 `ui/` (视图层)
- **路径别名**: `@/` 映射到 `src/`
- **主题系统**: CSS 自定义属性，支持亮色/暗色模式
- **服务端插件**: `server/mod-api.ts` 在 Vite 的 Node.js 环境中运行，提供模组管理 API

## 许可证

[MIT](LICENSE)
