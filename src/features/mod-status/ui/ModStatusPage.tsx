import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModRecord } from "@/shared/types/api";
import { useModScan } from "@/features/mod-status/model/use-mod-scan";
import { openDirectoryPath } from "@/adapters/platform/open-directory";
import "./ModStatusPage.css";

type StatusFilter = "all" | "outdated" | "updated" | "unknown";

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "outdated", label: "可更新" },
  { value: "updated", label: "已最新" },
  { value: "unknown", label: "未知" },
];

function FilterSelect({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLabel = FILTER_OPTIONS.find((o) => o.value === value)?.label ?? "全部";

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // Delay to avoid immediately closing from the toggle click
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className="ant-select" ref={containerRef}>
      <div
        className={`ant-select-selector${open ? " ant-select-selector-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className="ant-select-selection-item">{selectedLabel}</span>
        <span className={`ant-select-arrow${open ? " ant-select-arrow-open" : ""}`}>
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4.5l4 3 4-3" />
          </svg>
        </span>
      </div>
      {open && (
        <div className="ant-select-dropdown">
          <div className="ant-select-item-option-group" role="listbox">
            {FILTER_OPTIONS.map((opt) => {
              const selected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  className={`ant-select-item-option${selected ? " ant-select-item-option-selected" : ""}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="ant-select-item-option-content">{opt.label}</span>
                  {selected && (
                    <span className="ant-select-item-option-state">
                      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 6l2.5 2.5 4.5-5" />
                      </svg>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const HUB_MODS_URL = "https://hub.coigame.com/Mods";

type Theme = "light" | "dark";

type LogType = "info" | "ok" | "warn" | "err" | "dim";

interface LogLine {
  id: number;
  text: string;
  type: LogType;
}

const statusConfig: Record<string, { text: string; pillClass: string; filterKey: StatusFilter }> = {
  up_to_date: { text: "已最新", pillClass: "status-updated", filterKey: "updated" },
  update_available: { text: "可更新", pillClass: "status-outdated", filterKey: "outdated" },
  unknown: { text: "未知", pillClass: "status-unknown", filterKey: "unknown" },
};

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem("coi-mod-manager-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function matchesFilter(mod: ModRecord, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const key = statusConfig[mod.status]?.filterKey ?? "unknown";
  return key === filter;
}

export function ModStatusPage() {
  const { mods, scanning, checkingCount, upgradingIds, upgradeProgressMap, error, dirPath, scan, checkUpdates, upgrade, recheck, forceUpgradeAll } = useModScan();

  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logVisible, setLogVisible] = useState(false);
  const [hoveredLogId, setHoveredLogId] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const tooltipShowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [forceUpdating, setForceUpdating] = useState(false);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem("coi-mod-manager-theme", next);
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const appendLog = useCallback((text: string, type: LogType = "info") => {
    setLogs((prev) => [...prev, { id: Date.now() + Math.random(), text, type }]);
    setLogVisible(true);
  }, []);

  useEffect(() => {
    appendLog("COI Mod Manager 已加载", "info");
  }, [appendLog]);

  useEffect(() => {
    if (scanning && mods.length > 0 && checkingCount === 0) {
      appendLog(`本地扫描完成，共 ${mods.length} 个 Mod`, "ok");
    }
  }, [scanning, mods.length, checkingCount, appendLog]);

  useEffect(() => {
    if (checkingCount > 0) {
      appendLog(`正在检查 ${checkingCount} 个 Mod…`, "dim");
    }
  }, [checkingCount, appendLog]);

  const lastProgressLogRef = useRef<string | null>(null);
  useEffect(() => {
    const firstId = [...upgradingIds][0];
    const msg = firstId ? upgradeProgressMap[firstId]?.message : undefined;
    if (msg && msg !== lastProgressLogRef.current) {
      lastProgressLogRef.current = msg;
      appendLog(msg, "info");
    }
    if (upgradingIds.size === 0) {
      lastProgressLogRef.current = null;
    }
  }, [upgradeProgressMap, upgradingIds, appendLog]);

  useEffect(() => {
    if (error) {
      appendLog(error.message, "err");
    }
  }, [error, appendLog]);

  const stats = useMemo(() => {
    let upToDate = 0;
    let needUpdate = 0;
    let unknown = 0;
    for (const mod of mods) {
      if (mod.status === "up_to_date") upToDate++;
      else if (mod.status === "update_available") needUpdate++;
      else unknown++;
    }
    return { total: mods.length, upToDate, needUpdate, unknown };
  }, [mods]);

  const filteredMods = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return mods.filter((mod) => {
      if (!matchesFilter(mod, statusFilter)) return false;
      if (!kw) return true;
      return mod.displayName.toLowerCase().includes(kw) || mod.id.toLowerCase().includes(kw);
    });
  }, [mods, search, statusFilter]);

  const outdatedMods = useMemo(() => mods.filter((m) => m.status === "update_available"), [mods]);

  const checkedCount = useMemo(() => mods.filter((m) => m.checkingStatus === "done").length, [mods]);

  const notice = useMemo(() => {
    if (scanning && mods.length === 0) {
      return { variant: "info" as const, text: "正在扫描本地 Mod 目录…" };
    }
    if (error) {
      return { variant: "warning" as const, text: error.message };
    }
    if (mods.length === 0) {
      return { variant: "info" as const, text: "未发现 Mod，请确认工作目录或点击「扫描本地」。" };
    }
    if (checkingCount > 0) {
      return {
        variant: "info" as const,
        text: `正在并行检查 Mod 版本（${checkedCount}/${stats.total}，${checkingCount} 路并发）…`,
      };
    }
    if (stats.unknown > 0 && stats.needUpdate === 0) {
      return {
        variant: "info" as const,
        text: `共 ${stats.total} 个 Mod，点击「检查更新」以查询 Hub 版本。`,
      };
    }
    if (stats.needUpdate > 0) {
      return {
        variant: "warning" as const,
        text: `检查完成，共 ${stats.total} 个 Mod。其中 ${stats.needUpdate} 个可更新。`,
      };
    }
    return {
      variant: "success" as const,
      text: `所有 ${stats.total} 个 Mod 均已是最新版本`,
    };
  }, [scanning, mods.length, error, stats, checkingCount, checkedCount]);

  const handleOpenFolder = async () => {
    if (!dirPath) {
      appendLog("尚未选择工作目录", "warn");
      return;
    }

    try {
      await openDirectoryPath(dirPath);
      appendLog(`打开目录: ${dirPath}`, "dim");
    } catch (e) {
      appendLog(
        e instanceof Error ? `打开目录失败: ${e.message}` : `打开目录失败: ${String(e)}`,
        "err",
      );
    }
  };

  const handleScan = () => {
    appendLog("开始扫描本地 Mod…", "info");
    void scan();
  };

  const handleCheckUpdates = () => {
    appendLog("正在检查 Mod 更新…", "info");
    void checkUpdates();
  };

  const handleUpdateAll = async () => {
    if (outdatedMods.length === 0 || updatingAll || upgradingIds.size > 0) return;
    setUpdatingAll(true);
    appendLog(`开始批量更新 ${outdatedMods.length} 个 Mod…`, "info");
    try {
      for (const mod of outdatedMods) {
        appendLog(`更新 ${mod.displayName}…`, "info");
        await upgrade(mod);
        appendLog(`${mod.displayName} 更新完成`, "ok");
      }
      appendLog("全部更新完成", "ok");
    } catch {
      appendLog("批量更新中断", "err");
    } finally {
      setUpdatingAll(false);
    }
  };

  const handleForceUpdateAll = async () => {
    if (forceUpdating || scanning || checkingCount > 0) return;
    setForceUpdating(true);
    appendLog(`开始强制更新全部 ${mods.length} 个 Mod…`, "info");
    await forceUpgradeAll(
      mods,
      (mod) => appendLog(`更新 ${mod.displayName}…`, "info"),
      (mod, ok) => {
        if (ok) {
          appendLog(`${mod.displayName} 更新完成`, "ok");
        } else {
          appendLog(`${mod.displayName} 更新失败或无下载链接`, "warn");
        }
      },
    );
    appendLog("强制更新全部完成", "ok");
    setForceUpdating(false);
  };

  const rowClass = (mod: ModRecord): string => {
    if (upgradingIds.has(mod.id)) return "row-updating";
    if (mod.status === "update_available") return "row-outdated";
    return "";
  };

  return (
    <div className="mod-manager-page">
      <div className="page-shell">
        <header className="page-header">
          <div className="brand-block">
            <h1 className="page-title">COI Mod Manager</h1>
            <p className="page-subtitle">Captain of Industry · Mod 版本管理与更新</p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-default btn-theme-toggle" onClick={toggleTheme} title={theme === "light" ? "切换到暗色主题" : "切换到浅色主题"}>
              <span className={theme === "light" ? "icon icon-moon" : "icon icon-sun"} aria-hidden />
            </button>
            <button type="button" className="btn btn-default" onClick={() => window.open(HUB_MODS_URL, "_blank")}>
              <span className="icon icon-globe" aria-hidden />
              Mod Hub
            </button>
            <button type="button" className="btn btn-primary" onClick={handleScan} disabled={scanning}>
              {scanning ? <span className="btn-spinner" aria-hidden /> : <span className="icon icon-scan" aria-hidden />}
              {scanning ? "扫描中…" : "扫描本地"}
            </button>
            <button type="button" className="btn btn-success" onClick={handleCheckUpdates} disabled={scanning || checkingCount > 0}>
              <span className="icon icon-refresh" aria-hidden />
              检查更新
            </button>
          </div>
        </header>

        {dirPath && (
          <section className="directory-panel card">
            <div className="directory-row">
              <div className="directory-label">
                <span className="icon icon-folder" aria-hidden />
                <span>工作目录</span>
              </div>
              <div className="directory-input-wrap">
                <span className="ant-input-affix-wrapper ant-input-affix-wrapper-readonly">
                  <input className="ant-input ant-input-readonly" type="text" readOnly value={dirPath} />
                </span>
              </div>
              <button type="button" className="btn btn-default directory-open-btn" onClick={() => void handleOpenFolder()}>
                <span className="icon icon-folder" aria-hidden />
                打开目录
              </button>
            </div>
          </section>
        )}

        {mods.length > 0 && (
          <section className="stats-grid" aria-label="Mod 统计">
            <article className="stat-card stat-total card">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">TOTAL MODS</div>
            </article>
            <article className="stat-card stat-up-to-date card">
              <div className="stat-value">{stats.upToDate}</div>
              <div className="stat-label">UP TO DATE</div>
            </article>
            <article className="stat-card stat-need-update card">
              <div className="stat-value">{stats.needUpdate}</div>
              <div className="stat-label">NEED UPDATE</div>
            </article>
            <article className="stat-card stat-unknown card">
              <div className="stat-value">{stats.unknown}</div>
              <div className="stat-label">UNKNOWN</div>
            </article>
          </section>
        )}

        <section className={`notice-bar card notice-${notice.variant}`} role="status">
          <span className="notice-dot" aria-hidden />
          <span className="notice-text">{notice.text}</span>
        </section>

        {(mods.length > 0 || scanning) && (
          <section className="toolbar-row">
            <div className="toolbar-left">
              <span className="ant-input-affix-wrapper">
                <span className="ant-input-prefix">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="7" cy="7" r="4.5" />
                    <path d="M10.5 10.5L14 14" />
                  </svg>
                </span>
                <input type="search" className="ant-input" placeholder="搜索 Mod…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </span>
              <FilterSelect value={statusFilter} onChange={setStatusFilter} />
            </div>
            <div className="toolbar-right">
              <button type="button" className="btn btn-warning" onClick={() => void handleUpdateAll()} disabled={stats.needUpdate === 0 || updatingAll || upgradingIds.size > 0 || scanning}>
                <span className="icon icon-update" aria-hidden />
                更新全部
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void handleForceUpdateAll()} disabled={forceUpdating || upgradingIds.size > 0 || scanning || checkingCount > 0}>
                {forceUpdating ? <span className="btn-spinner" aria-hidden /> : <span className="icon icon-update" aria-hidden />}
                {forceUpdating ? "强制更新中…" : "强制更新全部"}
              </button>
            </div>
          </section>
        )}

        <div className="content-layout">
          <section className="table-panel card">
            <div className="table-wrap">
              <table className="mod-table">
                <thead>
                  <tr>
                    <th className="col-index">#</th>
                    <th className="col-mod">MOD</th>
                    <th className="col-size">大小</th>
                    <th className="col-local-version">本地版本</th>
                    <th className="col-hub-version">HUB 版本</th>
                    <th className="col-link">链接</th>
                    <th className="col-status">状态</th>
                    <th className="col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {mods.length === 0 ? (
                    <tr className="row-empty">
                      <td className="cell-empty-filter" colSpan={8}>
                        {scanning ? '正在扫描本地 Mod…' : '暂无 Mod，请点击「扫描本地」查找 Mod'}
                      </td>
                    </tr>
                  ) : filteredMods.length > 0 ? (
                    filteredMods.map((mod, index) => {
                      const status = statusConfig[mod.status] ?? statusConfig.unknown;
                      const isUpdating = upgradingIds.has(mod.id);
                      const isChecking = mod.checkingStatus === "checking";
                      const isOutdated = mod.status === "update_available";
                      const canUpgrade = isOutdated && !isUpdating && !isChecking && Boolean(mod.downloadUrl || mod.url);
                      const canForce = !isUpdating && !isChecking && Boolean(mod.downloadUrl || mod.url);
                      const canCheck = !isUpdating && !isChecking;

                      return (
                        <tr key={mod.id} className={rowClass(mod)} data-id={mod.id}>
                          <td className="cell-index">{index + 1}</td>
                          <td className="cell-mod">
                            <div className="mod-main">{mod.displayName}</div>
                            <div className="mod-sub">{mod.id}</div>
                          </td>
                          <td className="cell-size">
                            {mod.checkingStatus === "checking" ? (
                              <span className="size-loading" aria-label="正在加载 Mod 大小">
                                <span className="size-spinner" />
                              </span>
                            ) : (
                              <span className="size-text">{mod.sizeText || "—"}</span>
                            )}
                          </td>
                          <td className={`cell-local-version${isOutdated ? " is-accent" : ""}${isUpdating ? " updating-pulse" : ""}`}>{mod.version}</td>
                          <td className="cell-hub-version">{mod.remoteVersion || "—"}</td>
                          <td className="cell-link">
                            {mod.url ? (
                              <a className="hub-link" href={mod.url} target="_blank" rel="noreferrer">
                                <span className="icon icon-link" aria-hidden />
                                Hub
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="cell-status">
                            {isUpdating ? (
                              <span className="status-pill status-updated updating-pulse">⟳ 更新中</span>
                            ) : mod.checkingStatus === "checking" ? (
                              <span className="status-pill status-unknown checking-pulse">
                                <span className="size-spinner" aria-hidden />
                                检查中
                              </span>
                            ) : mod.checkingStatus === "pending" ? (
                              <span className="status-pill status-unknown">等待检查</span>
                            ) : (
                              <span className={`status-pill ${status.pillClass}`}>{status.text}</span>
                            )}
                          </td>
                          <td className="cell-actions">
                            {isUpdating && upgradeProgressMap[mod.id] ? (
                              <div className="upgrade-progress-inline">
                                <div className="upgrade-progress-text">
                                  <span>{upgradeProgressMap[mod.id].message}</span>
                                  {typeof upgradeProgressMap[mod.id].percent === "number" && <span>{Math.round(upgradeProgressMap[mod.id].percent!)}%</span>}
                                </div>
                                <div className="upgrade-progress-track">
                                  <div
                                    className="upgrade-progress-fill"
                                    style={{
                                      width: `${Math.max(0, Math.min(100, upgradeProgressMap[mod.id].percent ?? 12))}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="action-group">
                                {canUpgrade && (
                                  <button
                                    type="button"
                                    className="btn-update-single"
                                    onClick={() => {
                                      appendLog(`下载 ${mod.displayName}…`, "info");
                                      void upgrade(mod);
                                    }}
                                  >
                                    <span className="icon icon-download" aria-hidden />
                                    更新
                                  </button>
                                )}
                                {canForce && (
                                  <button
                                    type="button"
                                    className="btn-force-single"
                                    onClick={() => {
                                      appendLog(`强制更新 ${mod.displayName}…`, "info");
                                      void upgrade(mod);
                                    }}
                                  >
                                    <span className="icon icon-update" aria-hidden />
                                    强制更新
                                  </button>
                                )}
                                {canCheck && (
                                  <button
                                    type="button"
                                    className="btn-check-single"
                                    onClick={() => {
                                      appendLog(`重新检查 ${mod.displayName}…`, "dim");
                                      void recheck(mod);
                                    }}
                                  >
                                    <span className="icon icon-scan" aria-hidden />
                                    检查
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr className="row-empty">
                      <td className="cell-empty-filter" colSpan={8}>
                        没有符合筛选条件的 Mod
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`log-panel card${logVisible ? " visible" : ""}`}>
            <div className="log-header">
              <span className="log-title">操作日志</span>
              {/* <button type="button" className="btn btn-dark btn-xs" onClick={() => setLogVisible((v) => !v)}>
                {logVisible ? "隐藏" : "显示"}
              </button> */}
            </div>
            {logVisible && (
              <div className="log-body">
                {logs.length === 0 ? (
                  <div className="log-line dim">暂无日志</div>
                ) : (
                  [...logs].reverse().map((line) => (
                    <div
                      key={line.id}
                      className={`log-line ${line.type}`}
                      onMouseEnter={(e) => {
                        if (tooltipHideTimer.current) clearTimeout(tooltipHideTimer.current);
                        if (tooltipShowTimer.current) clearTimeout(tooltipShowTimer.current);
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const pos = { x: rect.left + rect.width / 2, y: rect.top - 8 };
                        tooltipShowTimer.current = setTimeout(() => {
                          setHoveredLogId(line.id);
                          setTooltipPos(pos);
                        }, 300);
                      }}
                      onMouseLeave={() => {
                        if (tooltipShowTimer.current) clearTimeout(tooltipShowTimer.current);
                        tooltipHideTimer.current = setTimeout(() => setHoveredLogId(null), 500);
                      }}
                    >
                      {line.text}
                    </div>
                  ))
                )}
              </div>
            )}
            {hoveredLogId !== null && (
              <div
                className="log-tooltip"
                style={{ left: tooltipPos.x, top: tooltipPos.y }}
                onMouseEnter={() => {
                  if (tooltipHideTimer.current) clearTimeout(tooltipHideTimer.current);
                }}
                onMouseLeave={() => {
                  tooltipHideTimer.current = setTimeout(() => setHoveredLogId(null), 500);
                }}
              >
                {logs.find((l) => l.id === hoveredLogId)?.text}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
