import {
  Button,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconFolderOpenOutline16,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useMemo, useState } from "react";

import type { PersonalOsSettings } from "../settingsStore.ts";
import type { PersonalOsViewFace } from "./face.ts";

export type PersonalOsSettingsCardProps =
  & PropsRuntime<"settings.plugin.item">
  & PropsLocale<"dsh.personal.os">
  & InjectFace<PersonalOsViewFace>;

interface SessionRow {
  id: string;
  title?: string;
  cwd?: string;
}

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? "settingsSwitch on" : "settingsSwitch"}
      onClick={() => { onChange(!checked); }}
    >
      <span className="settingsSwitchThumb" />
    </button>
  );
}

export function PersonalOsSettingsCard({
  t,
  ready,
  getSettings,
  choosePersonalDataDirectory,
  pickDirectory,
  listSessions,
  openPersonalDataDirectory,
  updatePreferences,
  getHistory,
  revertHistory,
  preflightImport,
  startImport,
  getImportJob,
  getLatestImportJob,
  cancelImport,
  getCurationStatus,
  cancelHistoricalCuration,
  getSnapshot,
  refreshDomain,
}: PersonalOsSettingsCardProps) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PersonalOsSettings | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getHistory>>["entries"]>([]);
  const [importPreview, setImportPreview] = useState<Awaited<ReturnType<typeof preflightImport>>>();
  const [importMode, setImportMode] = useState<"copy" | "in-place">("copy");
  const [importJob, setImportJob] = useState<Awaited<ReturnType<typeof startImport>>>();
  const [curationStatus, setCurationStatus] = useState<Awaited<ReturnType<typeof getCurationStatus>>>();
  const [domainStatus, setDomainStatus] = useState<Awaited<ReturnType<typeof getSnapshot>>>();
  const [sessionModal, setSessionModal] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([]);
  const [sessionPicked, setSessionPicked] = useState<ReadonlySet<string>>(new Set());
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ready()) return;
    let cancelled = false;
    void getSettings().then((next) => {
      if (!cancelled) setSettings(next);
      return Promise.all([getCurationStatus(), getSnapshot(), getLatestImportJob()]);
    }).then(([curation, domain, latestImport]) => {
      if (!cancelled) { setCurationStatus(curation); setDomainStatus(domain); setImportJob(latestImport ?? undefined); }
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    void listSessions().then((rows) => {
      if (!cancelled) { setSessionRows(rows); setSessionTitles(Object.fromEntries(rows.map((row) => [row.id, row.title ?? row.cwd ?? row.id]))); }
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [ready, getSettings, getCurationStatus, getSnapshot, getLatestImportJob, listSessions]);

  useEffect(() => {
    if (!importJob || (importJob.state !== "running" && importJob.state !== "stopping")) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getImportJob(importJob.id).then((next) => {
        if (cancelled) return;
        if (!next) { setError(true); setMessage("导入任务状态不可用，请刷新设置页。"); return; }
        setImportJob(next);
      }).catch(() => { if (!cancelled) setError(true); });
    }, 350);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [importJob?.id, importJob?.state, getImportJob]);

  useEffect(() => {
    const job = curationStatus?.job;
    if (!job || (job.state !== "running" && job.state !== "stopping")) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getCurationStatus().then((next) => { if (!cancelled) setCurationStatus(next); }).catch(() => { if (!cancelled) setError(true); });
    }, 500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [curationStatus?.job?.id, curationStatus?.job?.state, getCurationStatus]);

  useEffect(() => {
    if (!importJob || importJob.state === "running" || importJob.state === "stopping") return;
    setSaving(false);
    if (importJob.state === "failed") {
      setError(true);
      setMessage(importJob.error ?? "导入失败；已完成内容会在重试时自动跳过。");
      return;
    }
    setImportPreview(undefined);
    setMessage(importJob.state === "canceled"
      ? "导入已取消；可以重新开始，已完成内容不会重复。"
      : `导入完成：${importJob.report?.imported ?? 0} 个，跳过 ${importJob.report?.skipped ?? 0} 个。`);
  }, [importJob?.id, importJob?.state]);

  const selected = settings?.personalDataDirectory ?? "";

  const update = async (patch: Parameters<typeof updatePreferences>[0]) => {
    setSaving(true); setError(false); setMessage("");
    try {
      const next = await updatePreferences(patch);
      setSettings(next);
      if (next.versionHistory) setHistory((await getHistory()).entries);
      setCurationStatus(await getCurationStatus());
    } catch { setError(true); } finally { setSaving(false); }
  };

  const choose = async () => {
    if (saving) return;
    setSaving(true); setError(false);
    try { if (await choosePersonalDataDirectory()) setSettings(await getSettings()); }
    catch { setError(true); } finally { setSaving(false); }
  };

  const openDirectory = async () => {
    if (selected === "") return;
    setError(false);
    try { await openPersonalDataDirectory(selected); } catch { setError(true); }
  };

  const addExcludedWorkspace = async () => {
    if (saving || !settings) return;
    const picked = await pickDirectory();
    if (!picked || settings.excludedWorkspaces.includes(picked)) return;
    await update({ excludedWorkspaces: [...settings.excludedWorkspaces, picked] });
  };

  const removeExcludedWorkspace = async (path: string) => {
    if (!settings) return;
    await update({ excludedWorkspaces: settings.excludedWorkspaces.filter((item) => item !== path) });
  };

  const removeExcludedSession = async (id: string) => {
    if (!settings) return;
    await update({ excludedSessions: settings.excludedSessions.filter((item) => item !== id) });
  };

  const openSessionModal = () => {
    setSessionQuery(""); setSessionPicked(new Set()); setSessionModal(true);
    void listSessions().then((rows) => {
      setSessionRows(rows);
      setSessionTitles((prev) => ({ ...prev, ...Object.fromEntries(rows.map((row) => [row.id, row.title ?? row.cwd ?? row.id])) }));
    }).catch(() => { setError(true); });
  };

  const confirmSessionPick = async () => {
    if (!settings || sessionPicked.size === 0) { setSessionModal(false); return; }
    await update({ excludedSessions: [...new Set([...settings.excludedSessions, ...sessionPicked])] });
    setSessionModal(false);
  };

  const toggleSessionPick = (id: string) => {
    setSessionPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLocaleLowerCase();
    if (q === "") return sessionRows;
    return sessionRows.filter((row) => `${row.title ?? ""} ${row.cwd ?? ""} ${row.id}`.toLocaleLowerCase().includes(q));
  }, [sessionRows, sessionQuery]);

  useEffect(() => {
    if (!sessionModal) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSessionModal(false); };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); };
  }, [sessionModal]);

  const importVault = async () => {
    setSaving(true); setError(false); setMessage("");
    try {
      const source = await pickDirectory();
      if (!source) return;
      const preview = await preflightImport(source, importMode);
      setImportPreview(preview);
    } catch { setError(true); } finally { setSaving(false); }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setSaving(true); setError(false); setMessage(importPreview.mode === "copy" ? "正在后台复制，关闭页面不会中断…" : "正在后台原位初始化 Markdown…");
    try { setImportJob(await startImport(importPreview.source, importPreview.mode)); }
    catch { setError(true); setSaving(false); }
  };

  const cancelActiveImport = async () => {
    if (!importJob || importJob.state !== "running") return;
    const canceled = await cancelImport(importJob.id); if (canceled) setImportJob(canceled);
  };

  return (
    <li data-plugin="dsh-personal-os" data-surface="settings-card" className={open ? "open" : ""}>
      <button
        type="button"
        className="settingsHeader"
        aria-expanded={open}
        aria-label={`${t(open ? "settings.collapse" : "settings.expand")}: ${t("settings.title")}`}
        onClick={() => { setOpen(!open); }}
      >
        <span className="settingsHeading">
          <span className="settingsName">{t("settings.title")}</span>
          <span className="settingsDescription">{t("settings.description")}</span>
        </span>
        <IconChevronDownOutline14 className={open ? "chevron open" : "chevron"} />
      </button>
      {open && settings && (
        <div className="settingsBody">
          <section className="settingsSection">
            <h3 className="settingsSectionTitle">数据与存储</h3>
            <div className="settingsField">
              <strong>{t("settings.directory")}</strong>
              <span className="settingsHint">{t("settings.directoryHint")}</span>
              <span className={selected === "" ? "settingsPath empty" : "settingsPath"}>
                {selected === "" ? t("settings.unselected") : selected}
              </span>
              <div className="settingsActions">
                {selected !== "" && <Button variant="outline" size="sm" icon={<IconFolderOpenOutline16 size={16} />} onClick={() => { void openDirectory(); }}>{t("settings.open")}</Button>}
                <Button variant="primary" size="sm" disabled={saving} onClick={() => { void choose(); }}>{t(selected === "" ? "settings.choose" : "settings.change")}</Button>
              </div>
            </div>
            <label className="settingToggle"><span><strong>本地版本历史</strong><small>自动创建本地恢复点，不连接远端。</small></span><Switch checked={settings.versionHistory} disabled={saving} label="本地版本历史" onChange={(next) => { void update({ versionHistory: next }); }} /></label>
            {settings.versionHistory && <div className="historyList"><div className="settingsSubsection"><span><strong>版本历史</strong><small>恢复会创建一个新检查点。</small></span><Button variant="outline" size="sm" onClick={() => { void getHistory().then((value) => { setHistory(value.entries); }); }}>刷新</Button></div>{history.slice(0, 5).map((entry) => <div className="historyRow" key={entry.id}><span><strong>{entry.summary}</strong><small>{new Date(entry.at).toLocaleString()}</small></span><button type="button" onClick={() => { void revertHistory(entry.id).then(() => { setMessage("已恢复，并创建了新的检查点。"); }); }}>恢复</button></div>)}</div>}
          </section>

          <section className="settingsSection">
            <h3 className="settingsSectionTitle">记忆与学习</h3>
            <div className="settingSegmented"><span><strong>任务结果整理</strong><small>按完整任务而非单轮对话工作：谨慎模式在完成后生成待确认提案；主动模式仅自动应用高置信度结果；关闭后只响应显式整理。</small></span><div className="segmented" role="radiogroup" aria-label="任务结果整理">{(["off", "balanced", "proactive"] as const).map((level) => <button type="button" role="radio" aria-checked={settings.curationLevel === level} key={level} className={settings.curationLevel === level ? "active" : ""} disabled={saving} onClick={() => { void update({ curationLevel: level }); }}>{level === "off" ? "关闭" : level === "balanced" ? "谨慎" : "主动"}</button>)}</div></div>
            <label className="settingToggle"><span><strong>学习历史会话</strong><small>允许手动补扫历史会话；由你或 Agent 显式触发，不自动启动。</small></span><Switch checked={settings.historicalLearning} disabled={saving} label="学习历史会话" onChange={(next) => { void update({ historicalLearning: next }); }} /></label>
            <label className="settingToggle"><span><strong>跨工作区学习</strong><small>默认只处理当前工作区；开启后仍遵守排除范围。</small></span><Switch checked={settings.crossWorkspaceLearning} disabled={saving} label="跨工作区学习" onChange={(next) => { void update({ crossWorkspaceLearning: next }); }} /></label>
            <div className="curationStatus"><span>已处理 {curationStatus?.processedSessions ?? 0} 个会话{curationStatus?.job && (curationStatus.job.state === "running" || curationStatus.job.state === "stopping") ? ` · ${curationStatus.job.state === "stopping" ? "正在停止" : `${curationStatus.job.progress.completed}/${curationStatus.job.progress.total}`}` : ""}</span>{curationStatus && Object.keys(curationStatus.failures).length > 0 && <span className="settingsError">! {Object.keys(curationStatus.failures).length} 个会话等待重试</span>}{curationStatus?.job?.state === "running" ? <button type="button" onClick={() => { void cancelHistoricalCuration().then(() => getCurationStatus()).then(setCurationStatus); }}>取消补扫</button> : <button type="button" onClick={() => { void getCurationStatus().then(setCurationStatus); }}>重新索引</button>}</div>
          </section>

          <section className="settingsSection">
            <h3 className="settingsSectionTitle">隐私与排除</h3>
            <div className="settingList"><span><strong>排除的工作区</strong><small>从记忆收集中排除这些目录。</small></span><div className="listItems">{settings.excludedWorkspaces.map((path) => <span className="listChip" key={path}><span className="chipLabel" title={path}>{path}</span><button type="button" className="chipRemove" aria-label={`移除 ${path}`} disabled={saving} onClick={() => { void removeExcludedWorkspace(path); }}><IconCloseOutline16 size={12} /></button></span>)}{settings.excludedWorkspaces.length === 0 && <span className="listEmpty">未排除任何目录</span>}<button type="button" className="addItem" disabled={saving} onClick={() => { void addExcludedWorkspace(); }}>+ 添加</button></div></div>
            <div className="settingList"><span><strong>排除的会话</strong><small>从记忆收集中排除这些会话。</small></span><div className="listItems">{settings.excludedSessions.map((id) => <span className="listChip" key={id}><span className="chipLabel" title={id}>{sessionTitles[id] ?? id}</span><button type="button" className="chipRemove" aria-label={`移除 ${id}`} disabled={saving} onClick={() => { void removeExcludedSession(id); }}><IconCloseOutline16 size={12} /></button></span>)}{settings.excludedSessions.length === 0 && <span className="listEmpty">未排除任何会话</span>}<button type="button" className="addItem" onClick={() => { openSessionModal(); }}>选择会话</button></div></div>
          </section>

          <section className="settingsSection">
            <h3 className="settingsSectionTitle">知识库</h3>
            <div className="settingsSubsection"><span><strong>模板</strong><small>直接编辑保留目录中的普通 Markdown 模板。</small></span><Button variant="outline" size="sm" onClick={() => { void openPersonalDataDirectory(`${selected}/templates`); }}>打开模板目录</Button></div>
            <div className="curationStatus"><span>索引 {domainStatus?.documents.length ?? 0} 个文档{domainStatus?.indexing ? " · 建立索引中…" : ""}</span>{(domainStatus?.diagnostics.length ?? 0) > 0 && <span className="settingsError">! {domainStatus?.diagnostics.length} 个内容问题</span>}<button type="button" disabled={saving || domainStatus?.indexing} onClick={() => { void refreshDomain().then((snapshot) => { setDomainStatus(snapshot); setMessage("索引已重新建立。"); }).catch(() => { setError(true); }); }}>重新索引</button></div>
            <div className="settingsSubsection"><span><strong>导入已有知识库</strong><small>默认复制且不修改源目录；高级原位模式会改写源 Markdown。</small></span><span className="importMode"><select value={importMode} disabled={saving} onChange={(event) => { setImportMode(event.target.value as typeof importMode); }}><option value="copy">安全复制</option><option value="in-place">原位初始化</option></select><Button variant="outline" size="sm" disabled={saving} onClick={() => { void importVault(); }}>选择知识库目录</Button></span></div>
            {importPreview && <div className="importPreview"><strong>导入前确认</strong><p>{importPreview.markdown} 个 Markdown · {importPreview.attachments} 个附件 · {importPreview.conflicts} 个潜在冲突</p><small>{importPreview.source}</small>{importPreview.mode === "in-place" && <><p className="settingsError">! 原位模式会给源 Markdown 写入 Personal OS 头部元数据，请先确认已有备份。</p><ul>{importPreview.plannedChanges.slice(0, 8).map((change) => <li key={change}>{change}</li>)}</ul>{importPreview.plannedChanges.length > 8 && <small>另有 {importPreview.plannedChanges.length - 8} 个文件</small>}</>}<div><Button variant="outline" size="sm" disabled={saving} onClick={() => { setImportPreview(undefined); }}>取消</Button><Button variant="primary" size="sm" disabled={saving} onClick={() => { void confirmImport(); }}>{importPreview.mode === "copy" ? "开始复制" : "确认原位初始化"}</Button></div></div>}
            {(importJob?.state === "running" || importJob?.state === "stopping") && <div className="importProgress"><span>{importJob.state === "stopping" ? "正在安全停止…" : `正在处理 ${importJob.progress.completed}/${importJob.progress.total}`}</span><small>{importJob.progress.current}</small>{importJob.state === "running" && <Button variant="outline" size="sm" onClick={() => { void cancelActiveImport(); }}>取消任务</Button>}</div>}
          </section>

          {message && <span className="settingsMessage">{message}</span>}
          {error && <span className="settingsError" role="alert">{t("settings.error")}</span>}

          {sessionModal && (
            <div className="sessionModalBackdrop" onClick={() => { setSessionModal(false); }}>
              <div className="sessionModal" role="dialog" aria-modal="true" aria-label="选择要排除的会话" onClick={(event) => { event.stopPropagation(); }}>
                <div className="sessionModalHeader"><strong>排除的会话</strong><button type="button" onClick={() => { setSessionModal(false); }}>完成</button></div>
                <input className="sessionSearch" aria-label="搜索会话标题或工作区" autoFocus value={sessionQuery} onChange={(event) => { setSessionQuery(event.target.value); }} placeholder="搜索会话标题或工作区…" />
                <div className="sessionResults">
                  {filteredSessions.map((row) => <button type="button" key={row.id} className={sessionPicked.has(row.id) ? "sessionRow picked" : "sessionRow"} onClick={() => { toggleSessionPick(row.id); }}><span className="sessionCheck">{sessionPicked.has(row.id) ? <IconCheckOutline16 size={12} /> : ""}</span><span className="sessionInfo"><strong>{row.title ?? row.id}</strong><small>{row.cwd ?? ""}</small></span></button>)}
                  {filteredSessions.length === 0 && <p className="sectionEmpty">没有匹配的会话。</p>}
                </div>
                <div className="sessionModalFooter"><span>已选择 {sessionPicked.size} 个</span><Button variant="primary" size="sm" disabled={sessionPicked.size === 0} onClick={() => { void confirmSessionPick(); }}>排除所选</Button></div>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
