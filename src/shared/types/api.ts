/**
 * COI Mod Manager — 共享 API 类型定义
 *
 * 这是前端 API 服务层的公共类型契约，两个实现（HttpApiService / TauriApiService）
 * 必须严格遵守此接口。
 */

// ============================================================
// 基础类型
// ============================================================

export type ModStatus = 'up_to_date' | 'update_available' | 'unknown'

export type CheckingStatus = 'pending' | 'checking' | 'done'

export type UpgradePhase = 'resolving' | 'downloading' | 'extracting' | 'installing' | 'scanning' | 'completed'

// ============================================================
// 数据模型
// ============================================================

export interface ModRecord {
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
  checkingStatus?: CheckingStatus
}

export interface UpgradeProgress {
  phase: UpgradePhase
  message: string
  percent?: number
}

export interface ScanModsResponse {
  dirPath: string
  mods: ModRecord[]
}

// ============================================================
// 流式事件
// ============================================================

export type ScanEvent =
  | { type: 'start'; dirPath: string; mods: ModRecord[] }
  | { type: 'mod'; mod: ModRecord }
  | { type: 'complete'; result: ScanModsResponse }
  | { type: 'error'; message: string }

export type UpgradeEvent =
  | { type: 'progress'; progress: UpgradeProgress }
  | { type: 'complete'; result: ScanModsResponse }
  | { type: 'error'; message: string }

// ============================================================
// 服务接口（前端调用契约）
// ============================================================

/**
 * Mod API 服务接口。
 *
 * Web 模式：HttpApiService → Node.js server
 * Tauri 模式：TauriApiService → Rust commands
 */
export interface IModApiService {
  /** 快速本地扫描（不查 Hub） */
  localScan(): Promise<ScanModsResponse>

  /** 流式扫描（含 Hub 版本比对） */
  streamScan(onEvent: (event: ScanEvent) => void): Promise<ScanModsResponse>

  /** 检查单个 Mod（本地信息 + Hub 版本比对） */
  checkMod(installDir: string): Promise<ModRecord>

  /** 流式升级（下载 + 解压 + 安装 + 重新扫描） */
  streamUpgrade(
    installDir: string,
    downloadUrl: string,
    hubPageUrl: string | undefined,
    onEvent: (event: UpgradeEvent) => void
  ): Promise<ScanModsResponse>
}
