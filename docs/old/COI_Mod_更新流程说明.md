# COI Mod 更新流程说明

> 基于 Captain of Industry 游戏 Mod 的实际更新操作编写
> 更新时间：2026-05-18

---

## 目录

1. [整体流程概览](#1-整体流程概览)
2. [检查 Mod 是否需要更新](#2-检查-mod-是否需要更新)
3. [获取 Mod 更新包下载链接](#3-获取-mod-更新包下载链接)
4. [下载 Mod 更新包](#4-下载-mod-更新包)
5. [应用 Mod 更新包](#5-应用-mod-更新包)
6. [实际操作案例](#6-实际操作案例)
7. [附录：关键命令速查](#7-附录关键命令速查)

---

## 1. 整体流程概览

```
扫描本地 Mod 目录
    │
    ▼
读取每个 Mod 的 manifest.json → 获取本地版本号
    │
    ▼
访问 COI Mod Hub 网页 → 获取 Hub 最新版本号
    │
    ▼
本地版本 vs Hub 版本 对比
    │
    ├── 一致 → 已最新，跳过
    │
    └── 本地 < Hub → 需要更新
                        │
                        ▼
                从 Hub 页面提取 DownloadMod/{id} 下载链接
                        │
                        ▼
                使用 PowerShell 下载 ZIP 包
                        │
                        ▼
                解压 → 删除旧目录 → 移入新目录 → 清理
```

---

## 2. 检查 Mod 是否需要更新

### 2.1 读取本地版本

每个 COI Mod 的根目录下都有一个 `manifest.json` 文件，记录了版本信息。

**文件路径示例：**
```
Mods/
├── cheat-plus-plus/
│   └── manifest.json        ← 版本 "1.1.3"
├── AutoForestryDesignations/
│   └── manifest.json        ← 版本 "0.1.1"
└── ...
```

**manifest.json 关键字段：**
```json
{
  "id": "cheat-plus-plus",
  "version": "1.1.3",
  "display_name": "Cheat++",
  ...
}
```

**使用命令（`read_file`）：**
```
read_file({ path: "cheat-plus-plus/manifest.json" })
```

### 2.2 获取 Hub 最新版本

访问 COI Mod Hub 列表页获取各 Mod 的最新版本号。

**Hub 地址：** https://hub.coigame.com/Mods

**使用命令（`web_fetch`）：**
```
web_fetch({ url: "https://hub.coigame.com/Mods" })
```

返回的 HTML 中包含每个 Mod 的名称和版本号，例如：

```
Kayser's Automatic Forestry Designations
v0.1.3                   ← 最新版本
```

### 2.3 版本对比

| 结果 | 含义 | 后续操作 |
|------|------|----------|
| 本地 == Hub | 已是最新版 | 无需操作 |
| 本地 < Hub | 有可用更新 | 进入下载与替换流程 |
| 本地不在 Hub 上 | 可能未发布或无 Hub 版本 | 标记为未知 |

**实际检查结果（15 个 Mod）：**

| Mod | 本地版本 | Hub 版本 | 状态 |
|-----|---------|---------|------|
| AutoTerrainDesignations | 0.4.0 | 0.4.0 | ✅ 已最新 |
| **AutoForestryDesignations** | **0.1.1** | **0.1.3** | **🔄 可更新** |
| boost-plus-plus | 1.0.7 | 1.0.7 | ✅ 已最新 |
| Carbon.QuickBuildUnlocked | 1.0.3 | 1.0.3 | ✅ 已最新 |
| **cheat-plus-plus** | **1.1.3** | **1.1.4** | **🔄 可更新** |
| MiningDumpingMod | 4.1.8 | 4.1.8 | ✅ 已最新 |
| NoPillarsMod | 1.2.0 | 1.2.0 | ✅ 已最新 |
| ResearchQueue | 1.0.1 | 1.0.1 | ✅ 已最新 |
| RetainingWallsNeverDieMod | 1.0.0 | 1.0.0 | ✅ 已最新 |
| speed-plus-plus | 1.0.2 | 1.0.2 | ✅ 已最新 |
| storage-plus-plus | 1.0.1 | 1.0.1 | ✅ 已最新 |
| StorageCapacityMod | 1.2.0 | 1.2.0 | ✅ 已最新 |
| tweaks-plus-plus | 1.0.9 | 1.0.9 | ✅ 已最新 |
| UndergroundTransportMod | 5.1.7 | 5.1.7 | ✅ 已最新 |
| WindPower | 0.1.10b | 0.1.10b | ✅ 已最新 |

---

## 3. 获取 Mod 更新包下载链接

### 3.1 原理

COI Hub 的下载按钮是一个带有 `DownloadMod/{id}` 路径的 `<a>` 链接。需要进入 Mod 的详情页提取该 ID。

### 3.2 操作步骤

**第一步：获取 Mod 详情页 HTML**

```
web_fetch({ url: "https://hub.coigame.com/Mod/{modId}/{modSlug}" })
```

例如：
```
web_fetch({ url: "https://hub.coigame.com/Mod/1/Cheat" })
web_fetch({ url: "https://hub.coigame.com/Mod/5/Kaysers-Automatic-Forestry-Designations" })
```

**第二步：搜索 DownloadMod 链接**

在 HTML 中搜索 `/Mod/DownloadMod/{数字}` 模式。每个版本对应一个唯一的下载 ID：

```
<a href="/Mod/DownloadMod/1174" class="mv2-compound-action btn-warning mod-download-trigger">
  ← 表示 Cheat++ v1.1.4 的下载链接
```

**实际提取结果：**

| Mod | 版本 | 下载 ID | 完整下载 URL |
|-----|------|---------|-------------|
| Cheat++ | v1.1.4 | 1174 | `https://hub.coigame.com/Mod/DownloadMod/1174` |
| AutoForestryDesignations | v0.1.3 | 1151 | `https://hub.coigame.com/Mod/DownloadMod/1151` |

---

## 4. 下载 Mod 更新包

### 4.1 工具

使用 PowerShell 的 `System.Net.WebClient.DownloadFile()` 方法。

### 4.2 命令

```powershell
$wc = New-Object System.Net.WebClient
$wc.DownloadFile('https://hub.coigame.com/Mod/DownloadMod/1174', 'cheat-plus-plus-v1.1.4.zip')
$wc.DownloadFile('https://hub.coigame.com/Mod/DownloadMod/1151', 'AutoForestryDesignations-v0.1.3.zip')
```

### 4.3 注意事项

- 下载链接直接返回 ZIP 文件（约 1~3 MB）
- 建议提前检查磁盘空间
- 下载完成后检查 ZIP 文件完整性

---

## 5. 应用 Mod 更新包

### 5.1 完整替换流程

```
下载的 ZIP → 解压 → 删除旧目录 → 移入新目录 → 清理临时文件
```

### 5.2 具体命令

**Step 1：解压 ZIP**
```powershell
Expand-Archive -Path 'cheat-plus-plus-v1.1.4.zip' -DestinationPath 'cheat-plus-plus-temp' -Force
```

**Step 2：删除旧版 Mod 目录**
```powershell
# 使用 delete_directory 工具（递归删除）
delete_directory({ path: "cheat-plus-plus", recursive: true })
delete_directory({ path: "AutoForestryDesignations", recursive: true })
```

**Step 3：移动新目录到原位**
```powershell
Move-Item -Path 'cheat-plus-plus-temp\cheat-plus-plus' -Destination 'cheat-plus-plus' -Force
```

**Step 4：清理临时文件**
```powershell
# 删除解压临时目录
Remove-Item -Path 'cheat-plus-plus-temp' -Recurse -Force

# 删除下载的 ZIP
Remove-Item -Path 'cheat-plus-plus-v1.1.4.zip' -Force

# 删除缓存的 HTML 页面
Remove-Item -Path 'cheat_page.html' -Force
Remove-Item -Path 'forestry_page.html' -Force
```

### 5.3 验证更新

替换完成后，读取新 `manifest.json` 确认版本号已更新：

```json
{
  "id": "cheat-plus-plus",
  "version": "1.1.4",     ← 已从 1.1.3 更新到 1.1.4
  ...
}
```

---

## 6. 实际操作案例

### 案例：更新 Cheat++ v1.1.3 → v1.1.4

| 阶段 | 操作 | 输入/输出 |
|------|------|-----------|
| **检查** | 读取 manifest.json | 本地版本 `1.1.3` |
| **检查** | 访问 Hub 列表页 | Hub 版本 `v1.1.4` |
| **下载** | 提取下载 ID = 1174 | URL: `/Mod/DownloadMod/1174` |
| **下载** | PowerShell 下载 | → `cheat-plus-plus-v1.1.4.zip` (1.3 MB) |
| **应用** | 解压 ZIP | → `cheat-plus-plus-temp\cheat-plus-plus\` |
| **应用** | 删除旧目录 | `cheat-plus-plus/` 已删除 |
| **应用** | 移入新目录 | `cheat-plus-plus-temp\cheat-plus-plus` → `cheat-plus-plus` |
| **验证** | 读取新 manifest.json | `version: "1.1.4"` ✅ |

### 案例：更新 AutoForestryDesignations v0.1.1 → v0.1.3

| 阶段 | 操作 | 输入/输出 |
|------|------|-----------|
| **检查** | 读取 manifest.json | 本地版本 `0.1.1` |
| **检查** | 访问 Hub Mod #5 详情页 | Hub 最新版 `v0.1.3` |
| **下载** | 提取下载 ID = 1151 | URL: `/Mod/DownloadMod/1151` |
| **下载** | PowerShell 下载 | → `AutoForestryDesignations-v0.1.3.zip` (3.1 MB) |
| **应用** | 解压 → 删除 → 移入 | 完成替换 |
| **验证** | 读取新 manifest.json | `version: "0.1.3"` ✅ |

---

## 7. 附录：关键命令速查

### 文件操作

| 操作 | 命令 |
|------|------|
| 读取文件 | `read_file({ path })` |
| 删除目录 | `delete_directory({ path, recursive: true })` |

### 网页操作

| 操作 | 命令 |
|------|------|
| 获取网页内容 | `web_fetch({ url })` |
| 搜索网页文字 | `search_content({ pattern, glob: "*.html", context: N })` |

### PowerShell 命令

| 操作 | 命令 |
|------|------|
| 下载文件 | `New-Object System.Net.WebClient; $wc.DownloadFile($url, $path)` |
| 解压 ZIP | `Expand-Archive -Path $zip -DestinationPath $dir -Force` |
| 移动/重命名 | `Move-Item -Path $src -Destination $dest -Force` |
| 删除文件 | `Remove-Item -Path $path -Force` |
| 删除目录 | `Remove-Item -Path $dir -Recurse -Force` |
| 下载 HTML | `$wc.DownloadString($url)` |

---

> **说明：** 本文档基于对 `https://hub.coigame.com/Mods` 的实际操作编写，各 Mod 的下载 ID 会随版本更新而变化，使用时需重新提取。
