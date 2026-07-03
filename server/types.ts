export type ModStatus = 'up_to_date' | 'update_available' | 'unknown'

export type LocalMod = {
  id: string
  displayName: string
  version: string
  sizeText: string
  authors: string[]
  manifestPath: string
  installDir: string
  hubUrl?: string
  hubVersion?: string
}

export type HubListing = {
  title: string
  version?: string
  url: string
}

export type ChangelogEntry = {
  version: string
  date: string
  content: string
}

export type ScanResponse = {
  dirPath: string
  mods: ApiModRecord[]
}

export type ApiModRecord = {
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
  changelogEntries?: ChangelogEntry[]
}

export type UpgradeRequest = {
  installDir?: string
  downloadUrl?: string
  hubPageUrl?: string
}

export type HubBrowserHeaderOptions = {
  referer?: string
  accept?: string
  fetchDest?: string
  fetchMode?: string
  fetchSite?: string
  fetchUser?: string
}

export type UpgradeProgress = {
  phase: 'resolving' | 'downloading' | 'extracting' | 'installing' | 'scanning' | 'completed'
  message: string
  percent?: number
}

export type DownloadSegment = {
  start: number
  end: number
}

export type NextFunction = (error?: unknown) => void
