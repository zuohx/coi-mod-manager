import { useEffect, useRef, useState } from 'react'

import { openDirectoryPath } from '@/adapters/platform/open-directory'
import type { UseAppUpdateReturn } from '@/features/app-update/model/use-app-update'
import { useModScan } from '@/features/mod-status/model/use-mod-scan'
import { useChangelog } from '@/features/mod-status/model/use-changelog'
import { useLogs } from '@/features/mod-status/model/use-logs'
import { useModFilters, statusConfig } from '@/features/mod-status/model/mod-status-view'
import { useTheme } from '@/features/mod-status/model/use-theme'
import { ChangelogModal } from '@/features/mod-status/ui/ChangelogModal'
import { FilterSelect } from '@/features/mod-status/ui/FilterSelect'
import { LogPanel } from '@/features/mod-status/ui/LogPanel'
import type { ModRecord } from '@/shared/types/api'
import './ModStatusPage.css'

const HUB_MODS_URL = 'https://hub.coigame.com/Mods'

export function ModStatusPage({ appUpdate }: { appUpdate?: UseAppUpdateReturn }) {
  const { mods, scanning, checkingCount, upgradingIds, upgradeProgressMap, error, dirPath, scan, checkUpdates, upgrade, recheck, forceUpgradeAll } = useModScan()

  const { theme, toggleTheme } = useTheme()
  const { logs, logVisible, hoveredLogId, tooltipPos, tooltipShowTimer, tooltipHideTimer, appendLog, setHoveredLogId, setTooltipPos } = useLogs()
  const {
    changelogModalMod,
    changelogEntries,
    changelogLoading,
    changelogError,
    openChangelogFor,
    closeChangelog,
  } = useChangelog()
  const {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    stats,
    filteredMods,
    outdatedMods,
    notice,
  } = useModFilters({ mods, scanning, error, checkingCount })

  const [updatingAll, setUpdatingAll] = useState(false)
  const [forceUpdating, setForceUpdating] = useState(false)
  const lastProgressLogRef = useRef<Record<string, string>>({})

  useEffect(() => {
    appendLog('COI Mod Manager 已加载', 'info')
  }, [appendLog])

  useEffect(() => {
    if (scanning && mods.length > 0 && checkingCount === 0) {
      appendLog(`本地扫描完成，共 ${mods.length} 个 Mod`, 'ok')
    }
  }, [scanning, mods.length, checkingCount, appendLog])

  useEffect(() => {
    if (checkingCount > 0) {
      appendLog(`正在检查 ${checkingCount} 个 Mod…`, 'dim')
    }
  }, [checkingCount, appendLog])

  useEffect(() => {
    for (const id of upgradingIds) {
      const msg = upgradeProgressMap[id]?.message
      if (msg && msg !== lastProgressLogRef.current[id]) {
        lastProgressLogRef.current[id] = msg
        const modName = mods.find((m) => m.id === id)?.displayName ?? id
        appendLog(`[${modName}] ${msg}`, 'info')
      }
    }
    for (const id of Object.keys(lastProgressLogRef.current)) {
      if (!upgradingIds.has(id)) {
        delete lastProgressLogRef.current[id]
      }
    }
  }, [upgradeProgressMap, upgradingIds, mods, appendLog])

  useEffect(() => {
    if (error) {
      appendLog(error.message, 'err')
    }
  }, [error, appendLog])

  const handleOpenFolder = async () => {
    if (!dirPath) {
      appendLog('尚未选择工作目录', 'warn')
      return
    }

    try {
      await openDirectoryPath(dirPath)
      appendLog(`打开目录: ${dirPath}`, 'dim')
    } catch (e) {
      appendLog(e instanceof Error ? `打开目录失败: ${e.message}` : `打开目录失败: ${String(e)}`, 'err')
    }
  }

  const handleScan = () => {
    appendLog('开始扫描本地 Mod…', 'info')
    void scan()
  }

  const handleCheckUpdates = () => {
    appendLog('正在检查 Mod 更新…', 'info')
    void checkUpdates()
  }

  const handleUpdateAll = async () => {
    if (outdatedMods.length === 0 || updatingAll || upgradingIds.size > 0) return
    setUpdatingAll(true)
    appendLog(`开始并发更新 ${outdatedMods.length} 个 Mod…`, 'info')
    await forceUpgradeAll(
      outdatedMods,
      (mod) => appendLog(`更新 ${mod.displayName}…`, 'info'),
      (mod, ok) => {
        if (ok) {
          appendLog(`${mod.displayName} 更新完成`, 'ok')
        } else {
          appendLog(`${mod.displayName} 更新失败`, 'warn')
        }
      }
    )
    appendLog('批量更新完成', 'ok')
    setUpdatingAll(false)
  }

  const handleForceUpdateAll = async () => {
    if (forceUpdating || scanning || checkingCount > 0) return
    setForceUpdating(true)
    appendLog(`开始强制更新全部 ${mods.length} 个 Mod…`, 'info')
    await forceUpgradeAll(
      mods,
      (mod) => appendLog(`更新 ${mod.displayName}…`, 'info'),
      (mod, ok) => {
        if (ok) {
          appendLog(`${mod.displayName} 更新完成`, 'ok')
        } else {
          appendLog(`${mod.displayName} 更新失败或无下载链接`, 'warn')
        }
      }
    )
    appendLog('强制更新全部完成', 'ok')
    setForceUpdating(false)
  }

  const rowClass = (mod: ModRecord): string => {
    if (upgradingIds.has(mod.id)) return 'row-updating'
    if (mod.status === 'update_available') return 'row-outdated'
    return ''
  }

  return (
    <div className='mod-manager-page'>
      <div className='page-shell'>
        <header className='page-header'>
          <div className='brand-block'>
            <h1 className='page-title'>COI Mod Manager <span className='version-tag'>v{__APP_VERSION__}</span></h1>
            <p className='page-subtitle'>Captain of Industry · Mod 版本管理与更新</p>
          </div>
          <div className='header-actions'>
            <button type='button' className='btn btn-default btn-theme-toggle' onClick={toggleTheme} title={theme === 'light' ? '切换到暗色主题' : '切换到浅色主题'}>
              <span className={theme === 'light' ? 'icon icon-moon' : 'icon icon-sun'} aria-hidden />
            </button>
            <button type='button' className='btn btn-default' onClick={() => window.open(HUB_MODS_URL, '_blank')}>
              <span className='icon icon-globe' aria-hidden />
              Mod Hub
            </button>
            {appUpdate && (
              <button
                type='button'
                className='btn btn-default'
                onClick={() => void appUpdate.check()}
                disabled={appUpdate.status === 'checking' || appUpdate.status === 'downloading' || appUpdate.status === 'installing'}
                title='检查 COI Mod Manager 软件更新'
              >
                <span className='icon icon-update' aria-hidden />
                {appUpdate.status === 'checking' ? '检查中…' : '软件更新'}
              </button>
            )}
            <button type='button' className='btn btn-primary' onClick={handleScan} disabled={scanning}>
              {scanning ? <span className='btn-spinner' aria-hidden /> : <span className='icon icon-scan' aria-hidden />}
              {scanning ? '扫描中…' : '扫描本地'}
            </button>
            <button type='button' className='btn btn-success' onClick={handleCheckUpdates} disabled={scanning || checkingCount > 0}>
              <span className='icon icon-refresh' aria-hidden />
              检查更新
            </button>
          </div>
        </header>

        {dirPath && (
          <section className='directory-panel card'>
            <div className='directory-row'>
              <div className='directory-label'>
                <span className='icon icon-folder' aria-hidden />
                <span>工作目录</span>
              </div>
              <div className='directory-input-wrap'>
                <span className='ant-input-affix-wrapper ant-input-affix-wrapper-readonly'>
                  <input className='ant-input ant-input-readonly' type='text' readOnly value={dirPath} />
                </span>
              </div>
              <button type='button' className='btn btn-default directory-open-btn' onClick={() => void handleOpenFolder()}>
                <span className='icon icon-folder' aria-hidden />
                打开目录
              </button>
            </div>
          </section>
        )}

        {mods.length > 0 && (
          <section className='stats-grid' aria-label='Mod 统计'>
            <article className='stat-card stat-total card'>
              <div className='stat-value'>{stats.total}</div>
              <div className='stat-label'>TOTAL MODS</div>
            </article>
            <article className='stat-card stat-up-to-date card'>
              <div className='stat-value'>{stats.upToDate}</div>
              <div className='stat-label'>UP TO DATE</div>
            </article>
            <article className='stat-card stat-need-update card'>
              <div className='stat-value'>{stats.needUpdate}</div>
              <div className='stat-label'>NEED UPDATE</div>
            </article>
            <article className='stat-card stat-unknown card'>
              <div className='stat-value'>{stats.unknown}</div>
              <div className='stat-label'>UNKNOWN</div>
            </article>
          </section>
        )}

        <section className={`notice-bar card notice-${notice.variant}`} role='status'>
          <span className='notice-dot' aria-hidden />
          <span className='notice-text'>{notice.text}</span>
        </section>

        {(mods.length > 0 || scanning) && (
          <section className='toolbar-row'>
            <div className='toolbar-left'>
              <span className='ant-input-affix-wrapper'>
                <span className='ant-input-prefix'>
                  <svg viewBox='0 0 16 16' width='14' height='14' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
                    <circle cx='7' cy='7' r='4.5' />
                    <path d='M10.5 10.5L14 14' />
                  </svg>
                </span>
                <input type='search' className='ant-input' placeholder='搜索 Mod…' value={search} onChange={(e) => setSearch(e.target.value)} />
              </span>
              <FilterSelect value={statusFilter} onChange={setStatusFilter} />
            </div>
            <div className='toolbar-right'>
              <button type='button' className='btn btn-warning' onClick={() => void handleUpdateAll()} disabled={stats.needUpdate === 0 || updatingAll || upgradingIds.size > 0 || scanning}>
                <span className='icon icon-update' aria-hidden />
                更新全部
              </button>
              <button type='button' className='btn btn-danger' onClick={() => void handleForceUpdateAll()} disabled={forceUpdating || upgradingIds.size > 0 || scanning || checkingCount > 0}>
                {forceUpdating ? <span className='btn-spinner' aria-hidden /> : <span className='icon icon-update' aria-hidden />}
                {forceUpdating ? '强制更新中…' : '强制更新全部'}
              </button>
            </div>
          </section>
        )}

        <div className='content-layout'>
          <section className='table-panel card'>
            <div className='table-wrap'>
              <table className='mod-table'>
                <thead>
                  <tr>
                    <th className='col-index'>#</th>
                    <th className='col-mod'>MOD</th>
                    <th className='col-size'>大小</th>
                    <th className='col-local-version'>本地版本</th>
                    <th className='col-hub-version'>HUB 版本</th>
                    <th className='col-link'>链接</th>
                    <th className='col-status'>状态</th>
                    <th className='col-actions'>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {mods.length === 0 ? (
                    <tr className='row-empty'>
                      <td className='cell-empty-filter' colSpan={8}>
                        {scanning ? '正在扫描本地 Mod…' : '暂无 Mod，请点击「扫描本地」查找 Mod'}
                      </td>
                    </tr>
                  ) : filteredMods.length > 0 ? (
                    filteredMods.map((mod, index) => {
                      const status = statusConfig[mod.status] ?? statusConfig.unknown
                      const isUpdating = upgradingIds.has(mod.id)
                      const isChecking = mod.checkingStatus === 'checking'
                      const isOutdated = mod.status === 'update_available'
                      const canUpgrade = isOutdated && !isUpdating && !isChecking && Boolean(mod.downloadUrl || mod.url)
                      const canForce = !isUpdating && !isChecking && Boolean(mod.downloadUrl || mod.url)
                      const canCheck = !isUpdating && !isChecking

                      return (
                        <tr key={mod.id} className={rowClass(mod)} data-id={mod.id}>
                          <td className='cell-index'>{index + 1}</td>
                          <td className='cell-mod'>
                            <div className='mod-main'>{mod.displayName}</div>
                            <div className='mod-sub'>{mod.id}</div>
                          </td>
                          <td className='cell-size'>
                            {mod.checkingStatus === 'checking' ? (
                              <span className='size-loading' aria-label='正在加载 Mod 大小'>
                                <span className='size-spinner' />
                              </span>
                            ) : (
                              <span className='size-text'>{mod.sizeText || '—'}</span>
                            )}
                          </td>
                          <td className={`cell-local-version${isOutdated ? ' is-accent' : ''}${isUpdating ? ' updating-pulse' : ''}`}>{mod.version}</td>
                          <td className='cell-hub-version'>
                            {mod.url && mod.remoteVersion ? (
                              <span className='hub-version-link' onClick={() => void openChangelogFor(mod)} title='查看更新日志'>
                                {mod.remoteVersion}
                              </span>
                            ) : (
                              mod.remoteVersion || '—'
                            )}
                          </td>
                          <td className='cell-link'>
                            {mod.url ? (
                              <a className='hub-link' href={mod.url} target='_blank' rel='noreferrer'>
                                <span className='icon icon-link' aria-hidden />
                                Hub
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className='cell-status'>
                            {isUpdating ? (
                              <span className='status-pill status-updated updating-pulse'>⟳ 更新中</span>
                            ) : mod.upgradeError ? (
                              <span className='status-pill status-unknown' title={mod.upgradeError}>更新失败</span>
                            ) : mod.checkingStatus === 'checking' ? (
                              <span className='status-pill status-unknown checking-pulse'>
                                <span className='size-spinner' aria-hidden />
                                检查中
                              </span>
                            ) : mod.checkingStatus === 'pending' ? (
                              <span className='status-pill status-unknown'>等待检查</span>
                            ) : (
                              <span className={`status-pill ${status.pillClass}`}>{status.text}</span>
                            )}
                          </td>
                          <td className='cell-actions'>
                            {isUpdating && upgradeProgressMap[mod.id] ? (
                              <div className='upgrade-progress-inline'>
                                <div className='upgrade-progress-text'>
                                  <span>{upgradeProgressMap[mod.id].message}</span>
                                  {typeof upgradeProgressMap[mod.id].percent === 'number' && <span>{Math.round(upgradeProgressMap[mod.id].percent!)}%</span>}
                                </div>
                                <div className='upgrade-progress-track'>
                                  <div
                                    className='upgrade-progress-fill'
                                    style={{
                                      width: `${Math.max(0, Math.min(100, upgradeProgressMap[mod.id].percent ?? 12))}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className='action-group'>
                                {mod.upgradeError && (
                                  <div className='upgrade-error-msg' title={mod.upgradeError}>
                                    <span className='upgrade-error-icon'>!</span>
                                    <span className='upgrade-error-text'>{mod.upgradeError.length > 30 ? mod.upgradeError.slice(0, 30) + '…' : mod.upgradeError}</span>
                                  </div>
                                )}
                                {canUpgrade && (
                                  <button
                                    type='button'
                                    className='btn-update-single'
                                    onClick={() => {
                                      appendLog(`下载 ${mod.displayName}…`, 'info')
                                      void upgrade(mod)
                                    }}
                                  >
                                    <span className='icon icon-download' aria-hidden />
                                    更新
                                  </button>
                                )}
                                {canForce && (
                                  <button
                                    type='button'
                                    className='btn-force-single'
                                    onClick={() => {
                                      appendLog(`强制更新 ${mod.displayName}…`, 'info')
                                      void upgrade(mod)
                                    }}
                                  >
                                    <span className='icon icon-update' aria-hidden />
                                    强制更新
                                  </button>
                                )}
                                {canCheck && (
                                  <button
                                    type='button'
                                    className='btn-check-single'
                                    onClick={() => {
                                      appendLog(`重新检查 ${mod.displayName}…`, 'dim')
                                      void recheck(mod)
                                    }}
                                  >
                                    <span className='icon icon-scan' aria-hidden />
                                    检查
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr className='row-empty'>
                      <td className='cell-empty-filter' colSpan={8}>
                        没有符合筛选条件的 Mod
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <LogPanel
            logs={logs}
            logVisible={logVisible}
            hoveredLogId={hoveredLogId}
            tooltipPos={tooltipPos}
            tooltipShowTimerRef={tooltipShowTimer}
            tooltipHideTimerRef={tooltipHideTimer}
            setHoveredLogId={setHoveredLogId}
            setTooltipPos={setTooltipPos}
          />
        </div>
      </div>
      <ChangelogModal
        mod={changelogModalMod}
        entries={changelogEntries}
        loading={changelogLoading}
        error={changelogError}
        onClose={closeChangelog}
      />
    </div>
  )
}
