import {
  Button,
  IconArchiveOutline20,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconLinkOutline16,
  IconSendOutline16,
  MarkdownText,
  OnboardingSurface,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { ContentDiagnostic, DocumentKind, PersonalDocument } from "../domain/types.ts";
import type { PersonalOsSettings } from "../settingsStore.ts";
import type { TaskOutcomeReviewAction } from "../service.ts";
import type { TaskOutcomeCandidate, TaskOutcomeProposal, TaskSpanView } from "../taskOutcome.ts";
import { CONVERSATION_INSET_BREAKPOINT, applyConversationInset, restoreConversationInset } from "./conversationInset.ts";
import type { PersonalOsViewFace } from "./face.ts";
import { PersonalOsBrand } from "./sidebar/PersonalOsBrand.tsx";
import { getSidebarTab, isInspectorVisible, selectPersonalOsDocument, setPersonalOsMode, setPersonalOsPage, setPersonalOsSetupState, setSidebarTab, usePersonalOsViewState } from "./viewState.ts";

export type PersonalOsOverlayProps = PropsRuntime<"shell.overlay"> & InjectFace<PersonalOsViewFace> & PropsLocale<"dsh.personal.os">;
export interface TaskOutcomeDockProps { face: PersonalOsViewFace; outcomeSessionId: string }

const PAGE_TITLES = { today: "今天", inbox: "收件箱", knowledge: "知识", todo: "待办", projects: "项目", timeline: "时间线", calendar: "日历" } as const;
const DiagnosticIdsContext = createContext<ReadonlySet<string>>(new Set());

function shortDate(value: string): string {
  try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value)); }
  catch { return value.slice(0, 10); }
}

function shortOptionText(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function kindLabel(kind: DocumentKind): string {
  return ({ capture: "收件内容", knowledge: "知识", todo: "待办", project: "项目" } as Record<DocumentKind, string>)[kind];
}

function localDateOffset(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function SectionCount({ value }: { value: number }): JSX.Element | null {
  return value > 0 ? <span className="sectionCount">{value}</span> : null;
}

function formatDate(value?: string): string {
  if (!value) return "未设置";
  try { return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)); }
  catch { return value; }
}

function stateLabel(value?: string): string {
  return ({ pending: "待处理", processed: "已处理", discarded: "已丢弃", open: "待完成", done: "已完成", canceled: "已取消", planned: "计划中", active: "进行中", paused: "已暂停", completed: "已完成" } as Record<string, string>)[value ?? ""] ?? value ?? "未设置";
}

function priorityLabel(value?: string): string {
  return ({ p0: "紧急", p1: "高", p2: "普通", p3: "低" } as Record<string, string>)[value ?? ""] ?? value ?? "普通";
}

function relationLabel(type: string): string {
  return ({ belongs_to: "所属项目", derived_from: "来源", related_to: "相关内容", produced: "产出" } as Record<string, string>)[type] ?? "关联";
}

function timelineSummary(summary: string): string {
  const match = summary.match(/^(capture|knowledge|todo|project) (created|updated|archived|restored): (.+)$/i);
  if (!match) return summary;
  const kind = kindLabel(match[1]!.toLowerCase() as DocumentKind);
  const action = ({ created: "新建", updated: "更新", archived: "归档", restored: "恢复" } as Record<string, string>)[match[2]!.toLowerCase()]!;
  return `${action} ${kind} · ${match[3]}`;
}

function compactTimelineSummary(summary: string): string {
  const characters = Array.from(timelineSummary(summary));
  return characters.length > 50 ? `${characters.slice(0, 50).join("")}...` : characters.join("");
}

function historySummary(summary: string): string {
  const match = summary.match(/^(Create|Update|Archive|Restore) (capture|knowledge|todo|project) \[[^\]]+\]: (.+)$/i);
  if (!match) return summary;
  return timelineSummary(`${match[2]} ${match[1]}d: ${match[3]}`);
}

function sourceLabel(source: string): string {
  return ({ ui: "界面", agent: "Agent", session: "会话", import: "导入", external: "外部" } as Record<string, string>)[source] ?? source;
}

function activitySource(actor: string, source: string): string {
  const actorText = ({ user: "本人", agent: "Agent", curator: "整理助手", import: "导入", external: "外部编辑" } as Record<string, string>)[actor] ?? actor;
  return `${actorText} · ${sourceLabel(source)}`;
}

function DocumentRow({ document, selected, onSelect, onTodoState }: { document: PersonalDocument; selected: boolean; onSelect: () => void; onTodoState?: ((state: "open" | "done" | "canceled") => void) | undefined }) {
  const diagnostic = useContext(DiagnosticIdsContext).has(document.id);
  return <div className="documentRowShell"><button type="button" aria-current={selected ? "true" : undefined} className={selected ? "documentRow selected" : "documentRow"} onClick={onSelect}>
      <span className={`kindDot ${document.kind}`} aria-hidden="true" />
      <span className="documentRowCopy"><strong>{document.title}</strong><span>{[document.state ? stateLabel(document.state) : undefined, document.priority ? priorityLabel(document.priority) : undefined, shortDate(document.updated_at)].filter(Boolean).join(" · ")}</span></span>
      {document.tags.length > 0 && <span className="documentTag">{document.tags[0]}</span>}
      {diagnostic && <span className="rowDiagnostic" title="这条 Markdown 有内容诊断">!</span>}
    </button>{document.kind === "todo" && onTodoState && <span className="todoQuickActions">{document.state === "open" ? <><button type="button" onClick={() => { onTodoState("done"); }}>完成</button><button type="button" onClick={() => { onTodoState("canceled"); }}>取消</button></> : <button type="button" onClick={() => { onTodoState("open"); }}>重开</button>}</span>}</div>;
}

function GroupedDocuments({ page, documents, activeId, select, updateTodoState }: { page: "inbox" | "knowledge" | "todo" | "projects"; documents: PersonalDocument[]; activeId?: string | undefined; select: (id: string) => void; updateTodoState: (document: PersonalDocument, state: "open" | "done" | "canceled") => void }) {
  if (page !== "todo" && page !== "projects") return <>{documents.map((document) => <DocumentRow key={document.id} document={document} selected={document.id === activeId} onSelect={() => { select(document.id); }} />)}</>;
  const today = new Date().toLocaleDateString("en-CA");
  const groups = page === "projects" ? ["active", "planned", "paused", "completed", "canceled"].map((name) => ({ name, items: documents.filter((item) => item.state === name) })) : [
    { name: "Today", items: documents.filter((item) => item.state === "open" && (item.start_date === today || Boolean(item.due_date && item.due_date <= today))) },
    { name: "Upcoming", items: documents.filter((item) => item.state === "open" && Boolean((item.due_date && item.due_date > today) || (item.start_date && item.start_date > today))) },
    { name: "No date", items: documents.filter((item) => item.state === "open" && !item.start_date && !item.due_date) },
    { name: "Completed", items: documents.filter((item) => item.state === "done" || item.state === "canceled") },
  ];
  const todoGroupLabels = { Today: "今天", Upcoming: "即将开始", "No date": "无日期", Completed: "已完成" } as Record<string, string>;
  return <>{groups.filter((group) => group.items.length > 0).map((group) => <section className="documentGroup" key={group.name}><div className="sectionTitle"><h2>{page === "projects" ? stateLabel(group.name) : todoGroupLabels[group.name] ?? group.name}</h2><SectionCount value={group.items.length} /></div>{group.items.map((document) => <DocumentRow key={document.id} document={document} selected={document.id === activeId} onSelect={() => { select(document.id); }} onTodoState={document.kind === "todo" ? (next) => { updateTodoState(document, next); } : undefined} />)}</section>)}</>;
}

function MarkdownPreview({ source }: { source: string }) {
  return <div className="focusPreview" aria-label="Markdown 预览">{source.trim() !== "" ? <MarkdownText text={source} /> : <p className="sectionEmpty">预览区 · 开始输入后实时渲染</p>}</div>;
}

function FocusEditor({ face, document, onClose, onChanged }: { face: PersonalOsViewFace; document: PersonalDocument; onClose: () => void; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(document.title);
  const [tags, setTags] = useState(document.tags.join(", "));
  const [body, setBody] = useState(document.body);
  const [zen, setZen] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [selectedText, setSelectedText] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const revisionRef = useRef(document.revision);
  const dirtyRef = useRef(false);
  const draftRef = useRef({ title, tags, body });
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const changeDraft = (next: { title?: string; tags?: string; body?: string }) => {
    if (next.title !== undefined) setTitle(next.title);
    if (next.tags !== undefined) setTags(next.tags);
    if (next.body !== undefined) setBody(next.body);
    dirtyRef.current = true;
    setSaveState("unsaved");
  };
  draftRef.current = { title, tags, body };
  const persist = useCallback(() => {
    if (!dirtyRef.current) return saveQueue.current;
    const draft = draftRef.current;
    if (draft.title.trim() === "") { setSaveState("error"); return Promise.resolve(); }
    dirtyRef.current = false;
    setSaveState("saving");
    saveQueue.current = saveQueue.current.then(async () => {
      const updated = await face.updateDocument(document.id, {
        title: draft.title.trim(), body: draft.body,
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      }, revisionRef.current);
      revisionRef.current = updated.revision;
      setSaveState(dirtyRef.current ? "unsaved" : "saved");
    }).catch(() => { dirtyRef.current = true; setSaveState("error"); });
    return saveQueue.current;
  }, [document.id, face]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => { void persist(); }, 800);
    return () => { window.clearTimeout(timer); };
  }, [title, tags, body, persist]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setZen((value) => !value); }
      else if (event.key === "Escape") { if (zen) setZen(false); else void persist().then(onChanged).then(onClose); }
    };
    window.addEventListener("keydown", keyboard);
    return () => { window.removeEventListener("keydown", keyboard); };
  }, [onChanged, onClose, persist, zen]);

  const exit = () => { void persist().then(onChanged).then(onClose); };
  const insertMarkdown = (value: string) => {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart; const end = textarea.selectionEnd;
    const next = `${body.slice(0, start)}${value}${body.slice(end)}`;
    changeDraft({ body: next }); setSlashOpen(false);
    window.setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + value.length, start + value.length); }, 0);
  };
  const askAgent = (action: string) => {
    const excerpt = selectedText || "当前知识全文";
    void face.prepareAgentInstruction(`请对 Personal OS 知识 ${document.id} 中的以下内容执行“${action}”：\n\n${excerpt}`);
  };
  const saveLabels = { saved: "已保存", saving: "保存中…", unsaved: "等待保存", error: "保存失败" } as const;

  return <section className={zen ? "focusEditor zen" : "focusEditor"} role="dialog" aria-modal="true" aria-labelledby="focus-editor-title">
    <header className="focusHeader"><button type="button" onClick={exit}>← 退出沉浸</button><span className={`saveState ${saveState}`} role="status" aria-live="polite">{saveLabels[saveState]}</span><div><button type="button" onClick={() => { setZen(!zen); }}>{zen ? "退出 Zen" : "Zen 模式"}</button><button type="button" className="focusSave" onClick={() => { void persist(); }}>保存</button></div></header>
    <main className="focusCanvas"><input id="focus-editor-title" className="focusTitle" aria-label="标题" value={title} onChange={(event) => { changeDraft({ title: event.target.value }); }} /><input className="focusTags" aria-label="标签" value={tags} placeholder="添加标签，用逗号分隔" onChange={(event) => { changeDraft({ tags: event.target.value }); }} /><div className="focusRule" />
      <div className="focusSplit"><div className="focusBodyWrap"><textarea ref={bodyRef} className="focusBody" aria-label="Markdown 正文" value={body} placeholder="开始写作…" onChange={(event) => { changeDraft({ body: event.target.value }); setSlashOpen(event.target.value.endsWith("/") || event.target.value.endsWith("\n/")); }} onSelect={(event) => { const target = event.currentTarget; setSelectedText(target.value.slice(target.selectionStart, target.selectionEnd)); }} />
        {selectedText && <div className="selectionActions"><span>Agent</span>{["改写", "精简", "展开", "提问"].map((action) => <button type="button" key={action} onClick={() => { askAgent(action); }}>{action}</button>)}</div>}
        {slashOpen && <div className="slashMenu"><button type="button" onClick={() => { insertMarkdown("# "); }}>标题</button><button type="button" onClick={() => { insertMarkdown("- [ ] "); }}>待办</button><button type="button" onClick={() => { insertMarkdown("> "); }}>引用</button><button type="button" onClick={() => { insertMarkdown("```\n\n```"); }}>代码</button><span />{["续写", "总结", "润色", "查找相关知识"].map((action) => <button type="button" key={action} onClick={() => { setSlashOpen(false); askAgent(action); }}>{`Agent · ${action}`}</button>)}</div>}
      </div><MarkdownPreview source={body} /></div>
    </main>
  </section>;
}

function Inspector({ face, document, documents, diagnostics, timeline, onChanged }: { face: PersonalOsViewFace; document: PersonalDocument; documents: PersonalDocument[]; diagnostics: ContentDiagnostic[]; timeline: Awaited<ReturnType<PersonalOsViewFace["getTimeline"]>>; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [focusEditing, setFocusEditing] = useState(false);
  const [showAdvancedProperties, setShowAdvancedProperties] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);
  const [tags, setTags] = useState(document.tags.join(", "));
  const [state, setState] = useState(document.state ?? "");
  const [priority, setPriority] = useState(document.priority ?? "p2");
  const [startDate, setStartDate] = useState(document.start_date ?? "");
  const [dueDate, setDueDate] = useState(document.due_date ?? "");
  const [targetDate, setTargetDate] = useState(document.target_date ?? "");
  const [propertiesText, setPropertiesText] = useState(JSON.stringify(document.properties ?? {}, null, 2));
  const [relationType, setRelationType] = useState("related_to");
  const [relationTarget, setRelationTarget] = useState("");
  const [showRelationComposer, setShowRelationComposer] = useState(false);
  const [showDetails, setShowDetails] = useState(document.kind !== "knowledge");
  const [showProperties, setShowProperties] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [agentInstruction, setAgentInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<PersonalOsViewFace["getHistory"]>>["entries"]>([]);

  useEffect(() => {
    setEditing(false); setShowAdvancedProperties(false); setTitle(document.title); setBody(document.body);
    setTags(document.tags.join(", ")); setState(document.state ?? ""); setPriority(document.priority ?? "p2");
    setStartDate(document.start_date ?? ""); setDueDate(document.due_date ?? ""); setTargetDate(document.target_date ?? "");
    setPropertiesText(JSON.stringify(document.properties ?? {}, null, 2)); setAgentInstruction(""); setShowRelationComposer(false); setShowProperties(false); setShowHistory(false); setError("");
  }, [document.id, document.revision]);
  useEffect(() => { setShowDetails(document.kind !== "knowledge"); }, [document.id, document.kind]);
  useEffect(() => { setFocusEditing(false); }, [document.id]);
  useEffect(() => { void face.getHistory().then((value) => { setHistory(value.entries); }).catch(() => { setHistory([]); }); }, [face, document.id, document.revision]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { if (showDetails && document.kind === "knowledge") setShowDetails(false); else if (editing) setEditing(false); else selectPersonalOsDocument(); } };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); };
  }, [editing]);

  const save = async () => {
    setSaving(true); setError("");
    try {
      const properties = JSON.parse(propertiesText) as unknown;
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) throw new Error("高级属性必须是 JSON 对象");
      await face.updateDocument(document.id, { title, body, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), properties: properties as Record<string, unknown>, ...(document.kind !== "knowledge" ? { state } : {}), ...(document.kind === "todo" ? { priority, start_date: startDate, due_date: dueDate } : {}), ...(document.kind === "project" ? { target_date: targetDate } : {}) }, document.revision);
      await onChanged(); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); }
  };
  const archive = async () => {
    setSaving(true); setError("");
    try { await face.archiveDocument(document.id, document.archived); selectPersonalOsDocument(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); }
  };
  const sendAgentInstruction = async () => {
    if (agentInstruction.trim() === "") return;
    setSaving(true); setError("");
    try { await face.prepareAgentInstruction(agentInstruction.trim()); setAgentInstruction(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const projectTodos = document.kind === "project" ? documents.filter((item) => item.kind === "todo" && item.relations.some((relation) => relation.type === "belongs_to" && relation.target === document.id)) : [];
  const projectCompleted = projectTodos.filter((item) => item.state === "done").length;
  const relevantHistory = history.filter((entry) => entry.summary.includes(`[${document.id}]`)).slice(0, 5);
  const incoming = documents.flatMap((source) => source.relations.filter((relation) => relation.target === document.id).map((relation) => ({ source, relation })));
  const propertyEntries = Object.entries(document.properties ?? {});
  const source = document.source ?? document.sources?.[0];
  const quickActions = document.kind === "knowledge"
    ? [{ label: "总结", instruction: `请总结 Personal OS 知识 ${document.id}，保留关键事实和来源。` }, { label: "生成待办", instruction: `基于 Personal OS 知识 ${document.id} 生成必要的待办，并建立来源关联。` }, { label: "关联项目", instruction: `为 Personal OS 知识 ${document.id} 找到合适的现有项目，并建议关联。` }]
    : document.kind === "todo"
      ? [{ label: "延期建议", instruction: `查看 Personal OS 待办 ${document.id} 的上下文，给出合理的延期建议，不要直接修改日期。` }, { label: "查找相关知识", instruction: `查找与 Personal OS 待办 ${document.id} 相关的知识。` }]
      : document.kind === "project"
        ? [{ label: "总结项目", instruction: `总结 Personal OS 项目 ${document.id} 的进展、未完成待办和最近知识。` }, { label: "查看未完成", instruction: `列出 Personal OS 项目 ${document.id} 的未完成待办，并建议下一步。` }]
        : [{ label: "整理收件内容", instruction: `请处理 Personal OS 收件内容 ${document.id}：读取内容，谨慎整理为知识、待办或项目，记录产出关联，并归档原收件内容。` }];

  return <>{focusEditing && <FocusEditor face={face} document={document} onClose={() => { setFocusEditing(false); }} onChanged={onChanged} />}<aside className="inspectorPane" aria-label="详情面板">
    <div className="inspectorHeader"><button type="button" className="inspectorBack" onClick={() => { selectPersonalOsDocument(); }} aria-label="返回列表">← <span>{kindLabel(document.kind)}</span></button><div className="headerActions"><button type="button" className="iconAction" title="打开 Markdown 文件" aria-label="打开 Markdown 文件" onClick={() => { void face.openPersonalDataDirectory(document.path); }}><IconFolderOpenOutline16 size={16} /></button><button type="button" className="iconAction inspectorClose" aria-label="关闭详情面板" onClick={() => { selectPersonalOsDocument(); }}><IconCloseOutline16 size={16} /></button></div></div>
    <div className="inspectorTitleBlock"><span className={`entityKind ${document.kind}`}>{kindLabel(document.kind)}{document.archived ? " · 已归档" : ""}</span><h1>{document.title}</h1><div className="entitySummary">{document.state && <span>{stateLabel(document.state)}</span>}{document.kind === "todo" && <span>{priorityLabel(document.priority)}优先级</span>}{document.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div></div>
    <div className="inspectorActions"><Button variant={editing ? "outline" : "primary"} size="sm" icon={<IconEditOutline16 size={16} />} onClick={() => { setEditing(!editing); }}>{editing ? "取消编辑" : document.kind === "knowledge" ? "快速编辑" : "编辑"}</Button>{document.kind === "knowledge" && !editing && <Button variant="outline" size="sm" onClick={() => { setFocusEditing(true); }}>沉浸编辑</Button>}{document.kind === "todo" && document.state === "open" && <Button variant="outline" size="sm" icon={<IconCheckOutline16 size={16} />} disabled={saving} onClick={() => { setSaving(true); void face.updateDocument(document.id, { state: "done" }, document.revision).then(onChanged).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { setSaving(false); }); }}>完成</Button>}<div className="actionRight">{!editing && document.kind === "knowledge" && <button type="button" className="plainAction metadataToggle" aria-expanded={showDetails} onClick={() => { setShowDetails(!showDetails); }}><span>更多信息</span><IconChevronDownOutline14 className={showDetails ? "open" : ""} /></button>}<button type="button" className="plainAction archiveAction" onClick={() => { void archive(); }} disabled={saving}><IconArchiveOutline20 size={16} />{document.archived ? "恢复" : "归档"}</button></div></div>
    {editing ? <div className="inspectorEditForm">
      <label className="fieldLabel">标题<input value={title} onChange={(event) => { setTitle(event.target.value); }} /></label>
      <label className="fieldLabel">标签<input value={tags} onChange={(event) => { setTags(event.target.value); }} placeholder="用逗号分隔" /></label>
      {document.kind !== "knowledge" && <label className="fieldLabel">状态<select value={state} onChange={(event) => { setState(event.target.value); }}>{(document.kind === "todo" ? ["open", "done", "canceled"] : document.kind === "project" ? ["planned", "active", "paused", "completed", "canceled"] : ["pending", "processed", "discarded"]).map((item) => <option key={item} value={item}>{stateLabel(item)}</option>)}</select></label>}
      {document.kind === "todo" && <div className="inlineFields"><label className="fieldLabel">优先级<select value={priority} onChange={(event) => { setPriority(event.target.value as typeof priority); }}>{["p0", "p1", "p2", "p3"].map((item) => <option key={item} value={item}>{priorityLabel(item)}</option>)}</select></label><label className="fieldLabel">开始<input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); }} /></label><label className="fieldLabel">截止<input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); }} /></label></div>}
      {document.kind === "project" && <label className="fieldLabel">目标日期<input type="date" value={targetDate} onChange={(event) => { setTargetDate(event.target.value); }} /></label>}
      <label className="fieldLabel grow">内容<textarea value={body} onChange={(event) => { setBody(event.target.value); }} /></label>
      <button type="button" className="advancedToggle" aria-expanded={showAdvancedProperties} onClick={() => { setShowAdvancedProperties(!showAdvancedProperties); }}>高级属性 {showAdvancedProperties ? "收起" : "展开"}</button>
      {showAdvancedProperties && <label className="fieldLabel propertiesEditor">JSON<textarea value={propertiesText} onChange={(event) => { setPropertiesText(event.target.value); }} spellCheck={false} /></label>}
      <div className="formActions"><Button variant="outline" onClick={() => { setEditing(false); }}>取消</Button><Button variant="primary" disabled={saving || title.trim() === ""} onClick={() => { void save(); }}>{saving ? "保存中…" : "保存"}</Button></div>
    </div> : <>
      <section className="inspectorSection documentContent"><h2>内容</h2>{document.body.trim() ? <div className="markdownBody"><MarkdownText text={document.body} /></div> : <p className="sectionEmpty">还没有正文。点击编辑补充内容。</p>}</section>
      {document.kind === "project" && <section className="inspectorSection projectOverview"><h2>概览</h2><div className="progressSummary"><strong>{projectTodos.length === 0 ? "—" : `${Math.round(projectCompleted / projectTodos.length * 100)}%`}</strong><span>{projectTodos.length === 0 ? "暂无直接待办" : `${projectCompleted}/${projectTodos.length} 个待办已完成`}</span></div>{projectTodos.length > 0 && <div className="progressTrack"><span style={{ width: `${Math.round(projectCompleted / projectTodos.length * 100)}%` }} /></div>}</section>}
    </>}
    {diagnostics.length > 0 && <section className="inspectorDiagnostics"><strong>! 这条 Markdown 需要确认</strong>{diagnostics.map((item, index) => <span key={`${item.code}-${index}`}><b>{item.code}</b><small>{item.message}</small></span>)}<div><button type="button" onClick={() => { void face.openPersonalDataDirectory(document.path); }}>打开源文件</button><button type="button" onClick={() => { setAgentInstruction(`请检查并修复 Personal OS 文档 ${document.id} 的内容诊断。先读取源文件，保留未知字段和有效正文，不要静默删除 Relation。`); }}>交给 Agent 修复</button></div></section>}
    {!editing && showDetails && <>{document.kind === "knowledge" && <div className="metadataBackdrop" onClick={() => { setShowDetails(false); }} />}<div className={document.kind === "knowledge" ? "metadataDropdown" : "metadataSections"}><section className="inspectorSection relationsEditor"><div className="sectionHeading"><h2>关联{(document.relations.length + incoming.length) > 0 && <span className="sectionCount">{document.relations.length + incoming.length}</span>}</h2><button type="button" className="sectionAdd" onClick={() => { setShowRelationComposer(!showRelationComposer); }}>{showRelationComposer ? "收起" : "+ 添加"}</button></div>{document.relations.map((relation) => <div className="relationRow" key={`${relation.type}-${relation.target}`}><button type="button" onClick={() => { selectPersonalOsDocument(relation.target); }}><span>{relationLabel(relation.type)}</span><strong>→ {documents.find((item) => item.id === relation.target)?.title ?? relation.target}</strong></button><button type="button" className="removeRelation" onClick={() => { void face.linkDocuments(document.id, relation, true).then(onChanged); }}>移除</button></div>)}{incoming.map(({ source: incomingSource, relation }) => <div className="relationRow incoming" key={`${incomingSource.id}-${relation.type}`}><button type="button" onClick={() => { selectPersonalOsDocument(incomingSource.id); }}><span>{relationLabel(relation.type)}</span><strong>← {incomingSource.title}</strong></button><button type="button" className="removeRelation" onClick={() => { void face.linkDocuments(incomingSource.id, relation, true).then(onChanged); }}>移除</button></div>)}{document.relations.length === 0 && incoming.length === 0 && <p className="sectionEmpty">还没有关联内容。</p>}{showRelationComposer && <div className="relationComposer"><IconLinkOutline16 size={16} /><select aria-label="关联类型" value={relationType} onChange={(event) => { setRelationType(event.target.value); }}><option value="belongs_to">所属项目</option><option value="derived_from">来源</option><option value="related_to">相关内容</option><option value="produced">产出</option></select><select aria-label="关联目标" value={relationTarget} onChange={(event) => { setRelationTarget(event.target.value); }}><option value="">关联到…</option>{documents.filter((item) => !item.archived && item.id !== document.id).map((item) => <option key={item.id} value={item.id}>{kindLabel(item.kind)} · {item.title}</option>)}</select><button type="button" disabled={!relationTarget} onClick={() => { void face.linkDocuments(document.id, { type: relationType as "belongs_to", target: relationTarget }).then(() => { setRelationTarget(""); setShowRelationComposer(false); return onChanged(); }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); }); }}>添加</button></div>}</section>
    <section className="inspectorSection propertiesPanel"><button type="button" className="sectionDisclosure" aria-expanded={showProperties} onClick={() => { setShowProperties(!showProperties); }}><h2>属性</h2><span>{showProperties ? "收起" : "展开"}</span></button>{showProperties && <div className="sectionDisclosureBody">{document.kind !== "knowledge" && <div><span>状态</span><strong>{stateLabel(document.state)}</strong></div>}{document.kind === "todo" && <><div><span>优先级</span><strong>{priorityLabel(document.priority)}</strong></div><div><span>开始</span><strong>{formatDate(document.start_date)}</strong></div><div><span>截止</span><strong>{formatDate(document.due_date)}</strong></div></>}{document.kind === "project" && <div><span>目标日期</span><strong>{formatDate(document.target_date)}</strong></div>}{source && <div><span>来源</span><strong>{source.kind === "conversation" ? "DSH 会话" : source.kind === "manual" ? "手动创建" : source.kind === "import" ? "导入" : "网页"}</strong></div>}{propertyEntries.map(([key, value]) => <div key={key}><span>{key}</span><strong>{typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value)}</strong></div>)}{document.kind === "knowledge" && !source && propertyEntries.length === 0 && <p className="sectionEmpty">没有额外属性。</p>}</div>}</section><section className="inspectorSection historyPanel"><button type="button" className="sectionDisclosure" aria-expanded={showHistory} onClick={() => { setShowHistory(!showHistory); }}><h2>历史</h2><span>{showHistory ? "收起" : "展开"}</span></button>{showHistory && <div className="sectionDisclosureBody">{history.length === 0 ? <p className="sectionEmpty">本地版本历史未启用。</p> : relevantHistory.length === 0 ? <p className="sectionEmpty">暂无这条内容的历史记录。</p> : relevantHistory.map((entry) => <span key={entry.id}><b>{historySummary(entry.summary)}</b><small>{shortDate(entry.at)}</small></span>)}</div>}</section></div></>}
    {!editing && document.kind === "project" && <section className="inspectorSection relatedItems"><h2>项目动态</h2>{timeline.filter((entry) => entry.projectId === document.id || entry.targetId === document.id).slice(0, 6).map((entry) => <button type="button" key={entry.id} onClick={() => { if (entry.targetId) selectPersonalOsDocument(entry.targetId); }}><strong>{timelineSummary(entry.summary)}</strong><small>{shortDate(entry.at)}</small></button>)}</section>}
    {!editing && <div className="agentInlineActions"><span>✦ Agent</span>{quickActions.map((action) => <button type="button" key={action.label} onClick={() => { setAgentInstruction(action.instruction); }}>{action.label}</button>)}</div>}
    {agentInstruction !== "" && <section className="agentHandoff"><strong>发送到当前 DSH 会话</strong><small>发送前可以检查和补充；执行过程与权限继续由 DSH 接管。</small><textarea value={agentInstruction} onChange={(event) => { setAgentInstruction(event.target.value); }} /><div><button type="button" onClick={() => { setAgentInstruction(""); }}>取消</button><button type="button" disabled={saving || agentInstruction.trim() === ""} onClick={() => { void sendAgentInstruction(); }}><IconSendOutline16 size={16} />发送</button></div></section>}
    <div className="inspectorMeta"><span>{document.id}</span><span>{shortDate(document.updated_at)}</span></div>
    {error && <div className="conflictError" role="alert"><p className="inlineError">! {error}</p>{error.includes("changed on disk") && <div><button type="button" onClick={() => { void onChanged(); }}>重新加载</button><button type="button" onClick={() => { setAgentInstruction(`请合并 Personal OS 文档 ${document.id} 的磁盘新版本与我的修改，先读取最新内容并保留双方有效信息。`); }}>交给 Agent 合并</button></div>}</div>}
  </aside></>;
}

function CreatePanel({ face, defaultKind, onCreated }: { face: PersonalOsViewFace; defaultKind: DocumentKind; onCreated: (document: PersonalDocument) => Promise<void> }) {
  const [kind, setKind] = useState<DocumentKind>(defaultKind); const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [tags, setTags] = useState(""); const [priority, setPriority] = useState("p2"); const [propertiesText, setPropertiesText] = useState("{}");
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [zenDraft, setZenDraft] = useState(false);
  const templateGeneration = useRef(0);
  useEffect(() => { setKind(defaultKind); }, [defaultKind]);
  useEffect(() => {
    const generation = ++templateGeneration.current;
    setError("");
    void face.getTemplateDraft(kind).then((template) => {
      if (generation === templateGeneration.current) { setBody(template.draft.body ?? ""); setTags((template.draft.tags ?? []).join(", ")); setPriority(template.draft.priority ?? "p2"); setPropertiesText(JSON.stringify(template.draft.properties ?? {}, null, 2)); }
    }).catch((cause) => { if (generation === templateGeneration.current) setError(cause instanceof Error ? cause.message : String(cause)); });
  }, [face, kind]);
  const create = async () => { setSaving(true); setError(""); try { const properties = JSON.parse(propertiesText) as unknown; if (typeof properties !== "object" || properties === null || Array.isArray(properties)) throw new Error("高级属性必须是 JSON 对象"); await onCreated(await face.createDocument({ kind, title, body, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), properties: properties as Record<string, unknown>, ...(kind === "todo" ? { priority: priority as "p0" | "p1" | "p2" | "p3" } : {}) })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); } };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") setZenDraft(false); };
    if (!zenDraft) return;
    window.addEventListener("keydown", keyboard);
    return () => { window.removeEventListener("keydown", keyboard); };
  }, [zenDraft]);
  if (zenDraft) return <div className="focusEditor zen" aria-label="沉浸式新建"><div className="focusHeader"><button type="button" onClick={() => { setZenDraft(false); }}>← <span>返回</span></button><span className="saveState">{kindLabel(kind)} · 草稿</span><div><button type="button" onClick={() => { setZenDraft(false); }}>取消</button><button type="button" className="focusSave" disabled={saving || title.trim() === ""} onClick={() => { void create(); }}>{saving ? "创建中…" : "创建"}</button></div></div><div className="focusCanvas"><input className="focusTitle" autoFocus value={title} onChange={(event) => { setTitle(event.target.value); }} placeholder="标题" /><input className="focusTags" value={tags} onChange={(event) => { setTags(event.target.value); }} placeholder="标签（逗号分隔）" /><div className="focusRule" /><div className="focusSplit"><div className="focusBodyWrap"><textarea className="focusBody" value={body} onChange={(event) => { setBody(event.target.value); }} placeholder="写下内容，稍后也可以让 Agent 继续整理…" /></div><MarkdownPreview source={body} /></div></div></div>;
  return <aside className="inspectorPane draftInspector" aria-label="新建内容"><div className="inspectorHeader"><button type="button" className="inspectorBack" onClick={() => { setPersonalOsMode("page"); }}>← <span>返回</span></button><div className="headerActions"><button type="button" className="plainAction" onClick={() => { setZenDraft(true); }}>↗ 沉浸式</button><button type="button" className="iconAction inspectorClose" aria-label="关闭新建面板" onClick={() => { setPersonalOsMode("page"); }}><IconCloseOutline16 size={16} /></button></div></div><h2>新建</h2><p className="draftDescription">先快速记下来，之后再通过详情面板补充关系和属性。</p>
    <div className="kindPicker">{(["capture", "knowledge", "todo", "project"] as const).map((item) => <button type="button" className={kind === item ? "active" : ""} key={item} onClick={() => { setKind(item); }}>{kindLabel(item)}</button>)}</div>
    <label className="fieldLabel">标题<input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); }} /></label>
    <label className="fieldLabel">标签<input value={tags} onChange={(event) => { setTags(event.target.value); }} placeholder="逗号分隔" /></label>
    {kind === "todo" && <label className="fieldLabel">优先级<select value={priority} onChange={(event) => { setPriority(event.target.value); }}>{["p0", "p1", "p2", "p3"].map((item) => <option key={item} value={item}>{priorityLabel(item)}</option>)}</select></label>}
    <label className="fieldLabel">内容<textarea rows={10} value={body} onChange={(event) => { setBody(event.target.value); }} placeholder="写下内容，稍后也可以让 Agent 继续整理…" /></label>
    {error && <p className="inlineError">! {error}</p>}<div className="formActions"><Button variant="outline" onClick={() => { setPersonalOsMode("page"); }}>取消</Button><Button variant="primary" disabled={saving || title.trim() === ""} onClick={() => { void create(); }}>{saving ? "创建中…" : "创建"}</Button></div>
  </aside>;
}

function RelationGraph({ nodes, edges, onSelect }: { nodes: Array<{ id: string; kind: DocumentKind; title: string }>; edges: Array<{ source: string; target: string; type: string }>; onSelect: (id: string) => void }) {
  const width = 720; const height = 480; const radius = Math.min(width, height) * 0.34;
  const positions = new Map(nodes.map((node, index) => [node.id, { x: width / 2 + Math.cos(index / Math.max(nodes.length, 1) * Math.PI * 2) * radius, y: height / 2 + Math.sin(index / Math.max(nodes.length, 1) * Math.PI * 2) * radius }]));
  return <div className="graphCanvas">{nodes.length === 0 ? <div className="emptyState"><h2>还没有关系</h2><p>只有明确建立的关联才会出现在图谱里。</p></div> : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Personal OS 关系图谱">
    {edges.map((edge) => { const a = positions.get(edge.source); const b = positions.get(edge.target); return a && b ? <g key={`${edge.source}-${edge.type}-${edge.target}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2}>{relationLabel(edge.type)}</text></g> : null; })}
    {nodes.map((node) => { const point = positions.get(node.id)!; return <g key={node.id} className={`graphNode ${node.kind}`} role="button" tabIndex={0} aria-label={node.title} onClick={() => { onSelect(node.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); } }}><circle cx={point.x} cy={point.y} r="31" /><text x={point.x} y={point.y + 50} textAnchor="middle">{node.title.slice(0, 16)}</text></g>; })}
  </svg>}</div>;
}

function CalendarView({ month, items, onMonth, onSelect }: { month: string; items: Awaited<ReturnType<PersonalOsViewFace["getCalendar"]>>; onMonth: (month: string) => void; onSelect: (id: string) => void }) {
  const now = new Date();
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const defaultDate = month === todayDate.slice(0, 7) ? todayDate : `${month}-01`;
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  useEffect(() => { setSelectedDate(month === todayDate.slice(0, 7) ? todayDate : `${month}-01`); }, [month, todayDate]);
  const [year, number] = month.split("-").map(Number); const days = new Date(year!, number!, 0).getDate(); const first = new Date(year!, number! - 1, 1).getDay();
  const shift = (delta: number) => { const next = new Date(year!, number! - 1 + delta, 1); onMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`); };
  const agenda = items.filter((item) => item.date === selectedDate);
  const roleLabels = { "todo-start": "待办开始", "todo-due": "待办截止", "project-target": "项目目标" } as const;
  return <div className="monthView"><div className="monthHeader"><button type="button" aria-label="上个月" onClick={() => { shift(-1); }}>‹</button><strong>{month}</strong><button type="button" aria-label="下个月" onClick={() => { shift(1); }}>›</button></div><div className="weekdayRow">{["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}</div><div className="monthGrid">{Array.from({ length: first }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, "0")}`; const count = items.filter((item) => item.date === date).length; return <button type="button" key={date} className={selectedDate === date ? "active" : ""} onClick={() => { setSelectedDate(date); }}><span>{index + 1}</span>{count > 0 && <i>{count}</i>}</button>; })}</div><section className="agenda"><div className="sectionTitle"><h2>{selectedDate}</h2><SectionCount value={agenda.length} /></div>{agenda.length === 0 ? <p className="quiet">这一天没有计划。</p> : agenda.map((item) => <button type="button" key={`${item.role}-${item.document.id}`} onClick={() => { onSelect(item.document.id); }}><span>{roleLabels[item.role]}</span><strong>{item.document.title}</strong></button>)}</section></div>;
}

function outcomeCandidateLabel(candidate: TaskOutcomeCandidate): string {
  return ({ update: "更新已有内容", activity: "完成记录", todo: "新建待办", knowledge: "沉淀知识", project: "新建项目", unresolved: "待澄清" } as Record<TaskOutcomeCandidate["kind"], string>)[candidate.kind];
}

function outcomeStatusLabel(status: TaskOutcomeProposal["status"]): string {
  return ({ draft: "草稿", ready_for_review: "待确认", applying: "应用中", applied: "已应用", dismissed: "已忽略", failed: "部分失败", undone: "已撤回" } as Record<TaskOutcomeProposal["status"], string>)[status];
}

function taskStatusLabel(status: TaskSpanView["status"]): string {
  return ({ active: "进行中", waiting_for_user: "等你回复", blocked: "已阻塞", completion_candidate: "正在整理结果", completed: "已完成" } as Record<TaskSpanView["status"], string>)[status];
}

function OutcomeReview({ face, outcomes, onChanged, showRecent = false }: { face: PersonalOsViewFace; outcomes: TaskOutcomeProposal[]; onChanged: () => Promise<void>; showRecent?: boolean }) {
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<{ candidateId: string; title: string; summary: string }>();
  const [reviewError, setReviewError] = useState("");
  const pending = outcomes.filter((outcome) => outcome.status === "ready_for_review" || outcome.status === "failed");
  const recent = showRecent ? outcomes.filter((outcome) => outcome.status === "applied" || outcome.status === "undone").slice(0, 3) : [];
  if (pending.length === 0 && recent.length === 0) return null;
  const review = async (outcomeId: string, action: TaskOutcomeReviewAction, candidateId?: string) => {
    const key = `${outcomeId}:${action}:${candidateId ?? ""}`;
    setBusy(key); setReviewError("");
    try {
      await face.reviewTaskOutcome({ outcomeId, action, ...(candidateId ? { candidateId } : {}) });
      await onChanged();
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  return <section className="outcomeReview" aria-label="任务结果确认">
    {reviewError && <p className="inlineError" role="alert">! {reviewError}</p>}
    {pending.length > 0 && <div className="outcomeReviewHeader"><div><span className="eyebrow">Agent · Task Outcome</span><h2>等待我确认</h2></div><span className="outcomeCount">{pending.length}</span></div>}
    {pending.map((outcome) => <article className="outcomeCard" key={outcome.id}>
      <header><div><span className="outcomeStatus">{outcomeStatusLabel(outcome.status)}</span><h3>{outcome.objective}</h3><p>{outcome.summary}</p></div><time>{shortDate(outcome.updatedAt)}</time></header>
      <div className="outcomeEvidence">{outcome.completionEvidence.slice(0, 3).map((evidence) => <span key={evidence}>{evidence}</span>)}</div>
      <div className="outcomeCandidates">{outcome.candidates.filter((candidate) => candidate.status === "pending" || candidate.status === "failed").map((candidate) => <div className="outcomeCandidate" key={candidate.id}>
        <div>{editing?.candidateId === candidate.id ? <div className="outcomeEdit"><label>标题<input value={editing.title} onChange={(event) => { setEditing({ ...editing, title: event.target.value }); }} /></label><label>结果<textarea rows={3} value={editing.summary} onChange={(event) => { setEditing({ ...editing, summary: event.target.value }); }} /></label></div> : <><span className={`outcomeKind ${candidate.confidence}`}>{outcomeCandidateLabel(candidate)} · {candidate.confidence === "high" ? "高置信度" : candidate.confidence === "medium" ? "待确认" : "低置信度"}</span><strong>{candidate.title}</strong><p>{candidate.summary}</p>{candidate.error && <small className="outcomeError">{candidate.error}</small>}</>}</div>
        <div className="outcomeCandidateActions">{editing?.candidateId === candidate.id ? <><button type="button" disabled={Boolean(busy) || !editing.title.trim() || !editing.summary.trim()} onClick={() => { const draft = editing; setBusy(`${outcome.id}:edit:${candidate.id}`); setReviewError(""); void face.reviewTaskOutcome({ outcomeId: outcome.id, action: "edit", candidateId: candidate.id, title: draft.title, summary: draft.summary }).then(() => { setEditing(undefined); return onChanged(); }).catch((cause) => { setReviewError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { setBusy(""); }); }}>保存</button><button type="button" className="quietAction" onClick={() => { setEditing(undefined); }}>取消</button></> : <>{candidate.kind !== "unresolved" && <button type="button" disabled={Boolean(busy)} onClick={() => { void review(outcome.id, candidate.status === "failed" ? "retry" : "accept", candidate.id); }}>{candidate.status === "failed" ? "重试" : "接受"}</button>}<button type="button" className="quietAction" disabled={Boolean(busy)} onClick={() => { setEditing({ candidateId: candidate.id, title: candidate.title, summary: candidate.summary }); }}>编辑</button><button type="button" className="quietAction" disabled={Boolean(busy)} onClick={() => { void review(outcome.id, "dismiss", candidate.id); }}>忽略</button></>}</div>
      </div>)}</div>
      {outcome.unresolved.length > 0 && <div className="outcomeUnresolved"><strong>还有待澄清内容</strong>{outcome.unresolved.map((item) => <div key={item}><span>{item}</span><span className="outcomeUnresolvedActions"><button type="button" disabled={Boolean(busy)} onClick={() => { void face.prepareAgentInstruction(`继续处理 Task Outcome ${outcome.id} 的待澄清内容：${item}`); }}>继续处理</button><button type="button" disabled={Boolean(busy)} onClick={() => { void face.reviewTaskOutcome({ outcomeId: outcome.id, action: "capture-unresolved", text: item }).then(onChanged).catch(() => undefined); }}>存入收件箱</button><button type="button" className="quietAction" disabled={Boolean(busy)} onClick={() => { void face.reviewTaskOutcome({ outcomeId: outcome.id, action: "dismiss-unresolved", text: item }).then(onChanged).catch(() => undefined); }}>不保留</button></span></div>)}</div>}
      <footer><button type="button" className="primaryAction" disabled={Boolean(busy)} onClick={() => { void review(outcome.id, "accept-all"); }}>接受全部</button><button type="button" className="quietAction" disabled={Boolean(busy)} onClick={() => { void review(outcome.id, "dismiss-proposal"); }}>忽略这次结果</button></footer>
    </article>)}
    {recent.length > 0 && <div className="outcomeRecent"><div className="sectionTitle"><h2>Agent 最近完成</h2><SectionCount value={recent.length} /></div>{recent.map((outcome) => <div className="outcomeRecentRow" key={outcome.id}><span className="outcomeStatus">{outcomeStatusLabel(outcome.status)}</span><strong>{outcome.summary}</strong><time>{shortDate(outcome.updatedAt)}</time>{outcome.status === "applied" && <button type="button" className="quietAction" disabled={Boolean(busy)} onClick={() => { void review(outcome.id, "undo"); }}>撤回</button>}</div>)}</div>}
  </section>;
}

function ActiveTaskSection({ face, tasks, onChanged }: { face: PersonalOsViewFace; tasks: TaskSpanView[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const active = tasks.filter((task) => task.status !== "completed");
  if (active.length === 0) return null;
  const correct = async (task: TaskSpanView, action: "split-latest" | "merge-previous") => {
    setBusy(`${task.id}:${action}`); setError("");
    try { await face.correctTaskBoundary(task.sessionId, action); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };
  return <section className="activeTasks" aria-label="继续进行的 Agent 任务">
    <div className="sectionTitle"><h2>继续进行</h2><SectionCount value={active.length} /></div>
    {error && <p className="inlineError" role="alert">! {error}</p>}
    {active.map((task) => <article className={`activeTaskCard ${task.status}`} key={task.id}>
      <header><span>{taskStatusLabel(task.status)}</span><time>{shortDate(task.updatedAt)}</time></header>
      <strong>{task.objective}</strong>
      <p>{task.transitionReason ?? "任务仍在进行中"}</p>
      <details><summary>为什么这样判断</summary><ul>{(task.boundaryReasons ?? []).map((reason) => <li key={reason}>{reason}</li>)}</ul><small>Session {task.sessionId.slice(0, 8)} · 事件 {task.seqFrom}–{task.seqTo}</small></details>
      <footer><button type="button" onClick={() => { void face.openSession(task.sessionId); }}>回到会话</button>{task.canSplit && <button type="button" className="quietAction" disabled={Boolean(busy)} onClick={() => { void correct(task, "split-latest"); }}>最近目标另成任务</button>}{task.canMerge && <button type="button" className="quietAction" disabled={Boolean(busy)} onClick={() => { void correct(task, "merge-previous"); }}>并入上一任务</button>}</footer>
    </article>)}
  </section>;
}

function TodayView({ face, tasks, onTasksChanged, today, inboxCount, projectCount, activeId, select, createTodo }: { face: PersonalOsViewFace; tasks: TaskSpanView[]; onTasksChanged: () => Promise<void>; today: Awaited<ReturnType<PersonalOsViewFace["getToday"]>> | undefined; inboxCount: number; projectCount: number; activeId?: string | undefined; select: (id: string) => void; createTodo: () => void }) {
  return <div className="todayGrid">
    <ActiveTaskSection face={face} tasks={tasks} onChanged={onTasksChanged} />
    <section className="todayFocus"><div className="sectionTitle"><h2>今天</h2><SectionCount value={today?.todos.length ?? 0} /></div>{today?.todos.map((document) => <DocumentRow key={document.id} document={document} selected={document.id === activeId} onSelect={() => { select(document.id); }} />)}{today?.todos.length === 0 && <p className="quiet">今天没有到期事项。</p>}<button type="button" className="addInline" onClick={createTodo}>＋ 添加待办</button></section>
    {today?.continue && <section className="continueSection"><div className="sectionTitle"><h2>继续处理</h2></div><button type="button" className="continueCard" disabled={!today.continue.targetId && !today.continue.projectId} onClick={() => { const target = today.continue?.targetId ?? today.continue?.projectId; if (target) select(target); }}><strong>{timelineSummary(today.continue.summary)}</strong><small>{shortDate(today.continue.at)}</small><span>继续 →</span></button></section>}
    <section className="todayOverview"><button type="button" onClick={() => { setPersonalOsPage("inbox"); }}><span>收件箱</span><strong>{inboxCount} 条</strong></button><button type="button" onClick={() => { setPersonalOsPage("projects"); }}><span>项目</span><strong>{projectCount} 个进行中</strong></button></section>
    <section><div className="sectionTitle"><h2>最近知识</h2><SectionCount value={today?.knowledge.length ?? 0} /></div>{today?.knowledge.slice(0, 5).map((document) => <DocumentRow key={document.id} document={document} selected={document.id === activeId} onSelect={() => { select(document.id); }} />)}{today?.knowledge.length === 0 && <p className="quiet">最近还没有知识。</p>}</section>
  </div>;
}

function PageEmpty({ page, create }: { page: "inbox" | "knowledge" | "todo" | "projects"; create: () => void }) {
  const copy = {
    inbox: ["收件箱是空的", "把一个想法、链接或待整理内容保存到这里。", "添加收件内容"],
    knowledge: ["还没有知识", "保存值得长期保留、以后还会用到的理解。", "创建知识"],
    todo: ["没有待办事项", "把下一件明确、可完成的事情记下来。", "添加待办"],
    projects: ["还没有项目", "用项目聚合一个持续推进的结果。", "创建项目"],
  }[page];
  return <div className="emptyState"><h2>{copy[0]}</h2><p>{copy[1]}</p><Button variant="primary" onClick={create}>{copy[2]}</Button></div>;
}

function Workspace({ face }: { face: PersonalOsViewFace }) {
  const view = usePersonalOsViewState();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sideBySide = window.matchMedia(CONVERSATION_INSET_BREAKPOINT);
    let observed: Element | null = null;
    let observer: ResizeObserver | undefined;
    // Track the live workspace edge so the native conversation stays aligned
    // when the Inspector changes the available width.
    const sync = () => {
      if (!sideBySide.matches) {
        applyConversationInset(0);
        return;
      }
      const surface = document.querySelector('[data-plugin="dsh-personal-os"][data-surface="workspace"]');
      if (surface !== observed) {
        observed = surface;
        observer?.disconnect();
        if (surface instanceof HTMLElement) {
          observer = new ResizeObserver(sync);
          observer.observe(surface);
        }
      }
      applyConversationInset(surface instanceof HTMLElement ? surface.getBoundingClientRect().width : 0, false);
    };
    sync();
    // The conversation host mounts and remounts on its own schedule; the
    // light idempotent poll re-attaches and re-applies after that happens.
    const timer = window.setInterval(sync, 800);
    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
      restoreConversationInset();
    };
  }, []);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<PersonalOsViewFace["getSnapshot"]>>>();
  const [today, setToday] = useState<Awaited<ReturnType<PersonalOsViewFace["getToday"]>>>();
  const [timeline, setTimeline] = useState<Awaited<ReturnType<PersonalOsViewFace["getTimeline"]>>>([]);
  const [calendar, setCalendar] = useState<Awaited<ReturnType<PersonalOsViewFace["getCalendar"]>>>([]);
  const [outcomes, setOutcomes] = useState<TaskOutcomeProposal[]>([]);
  const [tasks, setTasks] = useState<TaskSpanView[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date().toLocaleDateString("en-CA").slice(0, 7));
  const [graph, setGraph] = useState<Awaited<ReturnType<PersonalOsViewFace["getGraph"]>>>({ nodes: [], edges: [] });
  const [query, setQuery] = useState(""); const [results, setResults] = useState<Awaited<ReturnType<PersonalOsViewFace["searchDocuments"]>>>([]);
  const [searchKind, setSearchKind] = useState<DocumentKind | undefined>(); const [searchState, setSearchState] = useState(""); const [searchTag, setSearchTag] = useState(""); const [searchProject, setSearchProject] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false); const [pageTag, setPageTag] = useState("");
  const [timelineDate, setTimelineDate] = useState(() => localDateOffset(-2)); const [timelineProject, setTimelineProject] = useState(""); const [timelineWorkspace, setTimelineWorkspace] = useState(""); const [timelineSource, setTimelineSource] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [graphType, setGraphType] = useState(""); const [graphProject, setGraphProject] = useState(""); const [graphTag, setGraphTag] = useState(""); const [graphLocal, setGraphLocal] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const indexedRevision = useRef(0);
  const indexedScanning = useRef(false);
  const loadGeneration = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError("");
    try { if (refresh) await face.refreshDomain(); const [a, b, c, d, e, f, g] = await Promise.all([face.getSnapshot(), face.getToday(), face.getTimeline(), face.getCalendar(calendarMonth), face.getGraph(), face.listTaskOutcomes(), face.listTaskSpans()]); if (generation !== loadGeneration.current) return; indexedRevision.current = a.revision; indexedScanning.current = Boolean(a.indexing); setSnapshot(a); setToday(b); setTimeline(c); setCalendar(d); setGraph(e); setOutcomes(f); setTasks(g); }
    catch (cause) { if (generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : String(cause)); } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [face, calendarMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void face.getSnapshot().then((next) => { if (next.revision !== indexedRevision.current || Boolean(next.indexing) !== indexedScanning.current) return load(); }).catch(() => undefined); }, 900);
    return () => { window.clearInterval(timer); };
  }, [face, load]);
  useEffect(() => {
    if (view.page !== "today") return;
    const refreshTasks = () => { void Promise.all([face.listTaskOutcomes(), face.listTaskSpans()]).then(([nextOutcomes, nextTasks]) => { setOutcomes(nextOutcomes); setTasks(nextTasks); }).catch(() => undefined); };
    const timer = window.setInterval(refreshTasks, 1500);
    return () => { window.clearInterval(timer); };
  }, [face, view.page]);
  useEffect(() => { if (view.refreshRevision > 0) void load(true); }, [view.refreshRevision, load]);
  useEffect(() => { const timer = setTimeout(() => {
    const hasFilter = Boolean(searchKind || searchState || searchTag || searchProject || includeArchived);
    if (view.mode === "search" && (query.trim() !== "" || hasFilter)) void face.searchDocuments(query, {
      ...(searchKind ? { kinds: [searchKind] } : {}), ...(searchState ? { states: [searchState] } : {}),
      ...(searchTag ? { tags: [searchTag] } : {}), ...(searchProject ? { projectId: searchProject } : {}), includeArchived,
    }).then(setResults).catch(() => { setResults([]); }); else setResults([]);
  }, 180); return () => { clearTimeout(timer); }; }, [face, query, view.mode, searchKind, searchState, searchTag, searchProject, includeArchived, snapshot?.revision]);

  const active = snapshot?.documents.find((document) => document.id === view.selectedDocumentId);
  const diagnosticIds = useMemo(() => new Set((snapshot?.diagnostics ?? []).flatMap((item) => item.documentId ? [item.documentId] : [])), [snapshot?.revision]);
  const activeDiagnostics = (snapshot?.diagnostics ?? []).filter((item) => item.documentId === active?.id || item.path === active?.path);
  const pageDocuments = useMemo(() => (snapshot?.documents ?? []).filter((document) => !document.archived && (!pageTag || document.tags.includes(pageTag)) && (view.page === "inbox" ? document.kind === "capture" : view.page === "knowledge" ? document.kind === "knowledge" : view.page === "todo" ? document.kind === "todo" : view.page === "projects" ? document.kind === "project" : false)), [snapshot?.revision, view.page, pageTag]);
  const select = (id: string) => { selectPersonalOsDocument(id); }; const count = (kind: DocumentKind) => snapshot?.documents.filter((document) => !document.archived && document.kind === kind).length ?? 0;
  const updateTodoState = (document: PersonalDocument, state: "open" | "done" | "canceled") => { void face.updateDocument(document.id, { state }, document.revision).then(() => load()).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); }); };
  const afterCreated = async (document: PersonalDocument) => { await load(); select(document.id); setPersonalOsMode("page"); };
  const graphProjection = useMemo(() => {
    let allowed = new Set(graph.nodes.map((node) => node.id));
    if (graphProject) allowed = new Set((snapshot?.documents ?? []).filter((document) => document.id === graphProject || document.relations.some((relation) => relation.target === graphProject)).map((document) => document.id));
    if (graphTag) allowed = new Set((snapshot?.documents ?? []).filter((document) => allowed.has(document.id) && document.tags.includes(graphTag)).map((document) => document.id));
    let edges = graph.edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target) && (!graphType || edge.type === graphType));
    if (graphLocal && active) edges = edges.filter((edge) => edge.source === active.id || edge.target === active.id);
    const visible = graphLocal && active ? new Set([active.id, ...edges.flatMap((edge) => [edge.source, edge.target])]) : allowed;
    return { nodes: graph.nodes.filter((node) => visible.has(node.id)), edges };
  }, [graph, snapshot?.revision, graphType, graphProject, graphTag, graphLocal, active?.id]);

  const defaultCreateKind: DocumentKind = view.page === "inbox" ? "capture" : view.page === "todo" ? "todo" : view.page === "projects" ? "project" : "knowledge";
  const timelineToday = localDateOffset(0);
  const hasSearch = Boolean(query.trim() || searchKind || searchState || searchTag || searchProject || includeArchived);
  let content;
  if (view.mode === "create") content = <div className="emptyState draftHint"><h2>草稿已在详情面板打开</h2><p>模板只填入用户可编辑内容；保存时系统才会生成 ID、结构版本和时间戳。</p></div>;
  else if (view.mode === "search") content = <div className="searchPage"><div className="searchInput"><span>⌕</span><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="搜索标题、正文、标签、附件…" /></div><div className="searchFilters"><button type="button" className={!searchKind ? "active" : ""} onClick={() => { setSearchKind(undefined); }}>全部</button>{(["capture", "knowledge", "todo", "project"] as const).map((kind) => <button type="button" className={searchKind === kind ? "active" : ""} key={kind} onClick={() => { setSearchKind(kind); }}>{kindLabel(kind)}</button>)}<input value={searchTag} onChange={(event) => { setSearchTag(event.target.value); }} placeholder="标签" /><select value={searchState} onChange={(event) => { setSearchState(event.target.value); }}><option value="">全部状态</option>{["pending", "processed", "discarded", "open", "done", "canceled", "planned", "active", "paused", "completed"].map((item) => <option key={item} value={item}>{stateLabel(item)}</option>)}</select><select value={searchProject} onChange={(event) => { setSearchProject(event.target.value); }}><option value="">全部项目</option>{snapshot?.documents.filter((item) => item.kind === "project" && !item.archived).map((project) => <option key={project.id} value={project.id} title={project.title}>{shortOptionText(project.title)}</option>)}</select><label><input type="checkbox" checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); }} /> 包含已归档</label></div>{hasSearch && <p className="resultCount">{results.length} 个结果</p>}{results.map((result) => <div className="searchResult" key={result.document.id}><DocumentRow document={result.document} selected={result.document.id === active?.id} onSelect={() => { select(result.document.id); }} /><p>{result.context}</p></div>)}</div>;
  else if (view.mode === "graph") content = <div><div className="graphFilters"><select value={graphType} onChange={(event) => { setGraphType(event.target.value); }}><option value="">全部关联</option>{["belongs_to", "derived_from", "related_to", "produced"].map((type) => <option key={type} value={type}>{relationLabel(type)}</option>)}</select><select value={graphProject} onChange={(event) => { setGraphProject(event.target.value); }}><option value="">全部项目</option>{snapshot?.documents.filter((item) => item.kind === "project" && !item.archived).map((project) => <option key={project.id} value={project.id} title={project.title}>{shortOptionText(project.title)}</option>)}</select><input value={graphTag} onChange={(event) => { setGraphTag(event.target.value); }} placeholder="标签" /><label><input type="checkbox" checked={graphLocal} disabled={!active} onChange={(event) => { setGraphLocal(event.target.checked); }} /> 当前节点</label></div><RelationGraph nodes={graphProjection.nodes} edges={graphProjection.edges} onSelect={select} /></div>;
  else if (view.page === "today") content = <TodayView face={face} tasks={tasks} onTasksChanged={load} today={today} inboxCount={count("capture")} projectCount={today?.projects.length ?? 0} activeId={active?.id} select={select} createTodo={() => { setPersonalOsPage("todo"); setPersonalOsMode("create"); }} />;
  else if (["inbox", "knowledge", "todo", "projects"].includes(view.page)) content = <div className="documentList"><div className="listFilters"><input value={pageTag} onChange={(event) => { setPageTag(event.target.value); }} placeholder="按标签筛选" /><button type="button" onClick={() => { setPersonalOsMode("create"); }}>＋ 新建</button></div>{pageDocuments.length === 0 ? <PageEmpty page={view.page as "inbox" | "knowledge" | "todo" | "projects"} create={() => { setPersonalOsMode("create"); }} /> : <GroupedDocuments page={view.page as "inbox" | "knowledge" | "todo" | "projects"} documents={pageDocuments} activeId={active?.id} select={select} updateTodoState={updateTodoState} />}</div>;
  else if (view.page === "timeline") content = <div className="timelinePage"><div className="timelineFilters"><input type="date" aria-label="起始日期（默认近3天）" value={timelineDate} onChange={(event) => { setTimelineDate(event.target.value); }} /><select value={timelineProject} onChange={(event) => { setTimelineProject(event.target.value); }}><option value="">全部项目</option>{snapshot?.documents.filter((item) => item.kind === "project").map((project) => <option key={project.id} value={project.id} title={project.title}>{shortOptionText(project.title)}</option>)}</select><input value={timelineWorkspace} onChange={(event) => { setTimelineWorkspace(event.target.value); }} placeholder="工作区" /><select value={timelineSource} onChange={(event) => { setTimelineSource(event.target.value); }}><option value="">全部来源</option>{["ui", "agent", "session", "import", "external"].map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}</select></div><div className="timelineScroll"><div className="timelineList">{timeline.filter((entry) => (!timelineDate || (entry.at.slice(0, 10) >= timelineDate && entry.at.slice(0, 10) <= timelineToday)) && (!timelineProject || entry.projectId === timelineProject) && (!timelineWorkspace || entry.workspace?.includes(timelineWorkspace)) && (!timelineSource || entry.source === timelineSource)).map((entry) => { const summary = timelineSummary(entry.summary); const targetId = entry.targetId ?? entry.projectId; return <article key={entry.id}><time>{new Date(entry.at).toLocaleString()}</time><span className="timelineDot" /><div><button type="button" className={targetId ? "timelineAction" : "timelineAction passive"} disabled={!targetId} title={summary} aria-label={summary} onClick={() => { if (targetId) select(targetId); }}>{compactTimelineSummary(entry.summary)}</button><small>{activitySource(entry.actor, entry.source)}{entry.workspace ? ` · ${entry.workspace}` : ""}</small></div></article>; })}</div></div></div>;
  else content = <CalendarView month={calendarMonth} items={calendar} onMonth={setCalendarMonth} onSelect={select} />;

  const title = view.mode === "search" ? "全局搜索" : view.mode === "graph" ? "关系图谱" : view.mode === "create" ? "新建" : PAGE_TITLES[view.page];
  const inspectorOpen = isInspectorVisible(view.mode, active !== undefined);
  const subtitle = view.mode === "page" && view.page === "today" ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()) : undefined;
  return <DiagnosticIdsContext.Provider value={diagnosticIds}><section data-plugin="dsh-personal-os" data-surface="workspace" data-page={view.page} data-inspector={inspectorOpen ? "open" : "closed"}><main className="workspaceMain"><header className="workspaceHeader"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{snapshot && snapshot.diagnostics.length > 0 && <button type="button" className="diagnosticBadge" aria-expanded={showDiagnostics} onClick={() => { setShowDiagnostics(!showDiagnostics); }}>! {snapshot.diagnostics.length}</button>}</header>{showDiagnostics && snapshot && <section className="diagnosticsPanel"><strong>有些 Markdown 需要你确认</strong><p>系统没有自动修改这些文件，并会尽量保留最后一次有效内容。</p>{snapshot.diagnostics.map((item, index) => <div key={`${item.path}-${item.code}-${index}`}><span>!</span><p><strong>{item.code}</strong><small>{item.message}<br />{item.path}</small></p></div>)}</section>}{error && <p className="inlineError">! {error}</p>}{snapshot?.indexing ? <p className="quiet">正在后台建立 Markdown 索引，完成后会自动刷新…</p> : loading && !snapshot ? <div className="loadingState"><span /><span /><span /></div> : <><OutcomeReview face={face} outcomes={outcomes} onChanged={load} showRecent={view.page === "today" && view.mode === "page"} />{content}</>}</main>{view.mode === "create" ? <CreatePanel face={face} defaultKind={defaultCreateKind} onCreated={afterCreated} /> : active ? <Inspector face={face} document={active} documents={snapshot?.documents ?? []} diagnostics={activeDiagnostics} timeline={timeline} onChanged={load} /> : null}</section></DiagnosticIdsContext.Provider>;
}

export function TaskOutcomeDock({ face, outcomeSessionId }: TaskOutcomeDockProps) {
  const [taskContext, setTaskContext] = useState<Awaited<ReturnType<PersonalOsViewFace["getSessionTaskContext"]>>>();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => face.getSessionTaskContext(outcomeSessionId).then(setTaskContext).catch(() => { setTaskContext(undefined); }), [face, outcomeSessionId]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => { window.clearInterval(timer); };
  }, [refresh]);
  const outcome = taskContext?.outcome;
  const task = taskContext?.task;
  const pendingOutcome = outcome && (outcome.status === "ready_for_review" || outcome.status === "failed") ? outcome : undefined;
  if (!task && !outcome && (taskContext?.used.length ?? 0) === 0 && (taskContext?.proposed.length ?? 0) === 0) return null;
  const act = async (action: "accept-all" | "dismiss-proposal") => {
    if (!pendingOutcome) return;
    setBusy(true);
    try { await face.reviewTaskOutcome({ outcomeId: pendingOutcome.id, action }); await refresh(); }
    finally { setBusy(false); }
  };
  return <section data-plugin="dsh-personal-os" className="outcomeDock sessionContextDock" aria-label="本次任务使用的 Personal Context">
    <div className="sessionContextSummary"><span className="outcomeStatus">{pendingOutcome ? outcomeStatusLabel(pendingOutcome.status) : task ? taskStatusLabel(task.status) : "上下文"}</span><strong>{pendingOutcome?.summary ?? task?.objective ?? "本次会话的 Personal Context"}</strong><small>{pendingOutcome ? `${pendingOutcome.candidates.filter((candidate) => candidate.status === "pending" || candidate.status === "failed").length} 项结果等待确认` : task?.transitionReason ?? "展示 Agent 实际读取和准备更新的内容"}</small></div>
    {(taskContext?.used.length ?? 0) > 0 || (taskContext?.proposed.length ?? 0) > 0 ? <details className="sessionContextDetails"><summary>查看 Personal Context</summary>{taskContext!.used.length > 0 && <div><span>已使用</span>{taskContext!.used.slice(0, 6).map((item) => <strong key={item.document.id}>{item.document.title}</strong>)}</div>}{taskContext!.proposed.length > 0 && <div><span>将要更新</span>{taskContext!.proposed.slice(0, 6).map((item) => <strong key={item.candidate.id}>{item.document?.title ?? item.candidate.title}</strong>)}</div>}</details> : null}
    <div>{pendingOutcome && <button type="button" disabled={busy} onClick={() => { void act("accept-all"); }}>接受全部</button>}<button type="button" disabled={busy} onClick={() => { setSidebarTab("my"); setPersonalOsPage("today"); setPersonalOsMode("page"); }}>查看</button>{pendingOutcome && <button type="button" disabled={busy} className="quietAction" onClick={() => { void act("dismiss-proposal"); }}>忽略</button>}</div>
  </section>;
}

export function PersonalOsOverlay(props: PersonalOsOverlayProps) {
  const { t, ready, getSettings, choosePersonalDataDirectory } = props;
  const [settings, setSettings] = useState<PersonalOsSettings>(); const [loadingError, setLoadingError] = useState(false); const [choosing, setChoosing] = useState(false);
  const [finishingSetup, setFinishingSetup] = useState(false);
  const [setupImport, setSetupImport] = useState<Awaited<ReturnType<PersonalOsViewFace["preflightImport"]>>>();
  const [setupJob, setSetupJob] = useState<Awaited<ReturnType<PersonalOsViewFace["startImport"]>>>();
  const [setupMessage, setSetupMessage] = useState("");
  const reload = useCallback(async () => { setLoadingError(false); try { if (!ready()) throw new Error("not ready"); const next = await getSettings(); setSettings(next); setPersonalOsSetupState(next.personalDataDirectory === "" ? "needs-setup" : "configured"); } catch { setLoadingError(true); setPersonalOsSetupState("error"); } }, [ready, getSettings]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!setupJob || (setupJob.state !== "running" && setupJob.state !== "stopping")) return;
    let cancelled = false;
    const timer = window.setInterval(() => { void props.getImportJob(setupJob.id).then((next) => { if (!cancelled && next) setSetupJob(next); }).catch(() => { if (!cancelled) setLoadingError(true); }); }, 350);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [props.getImportJob, setupJob?.id, setupJob?.state]);
  useEffect(() => {
    if (!setupJob || setupJob.state === "running" || setupJob.state === "stopping") return;
    setChoosing(false);
    if (setupJob.state === "failed") { setLoadingError(true); setSetupMessage("导入失败；已完成的内容会在重试时自动跳过。"); }
    else if (setupJob.state === "canceled") setSetupMessage("导入已取消；预检结果已保留，可安全重试。");
    else { setSetupMessage(`导入完成：${setupJob.report?.imported ?? 0} 个，跳过 ${setupJob.report?.skipped ?? 0} 个。`); setSetupImport(undefined); }
  }, [setupJob?.id, setupJob?.state]);
  if (!settings || settings.personalDataDirectory === "" || finishingSetup) {
    const choose = async () => { setChoosing(true); try { if (await choosePersonalDataDirectory()) { const next = await getSettings(); setSettings(next); setFinishingSetup(true); } } catch { setLoadingError(true); } finally { setChoosing(false); } };
    const chooseVault = async () => { setChoosing(true); setSetupMessage(""); try { const source = await props.chooseImportDirectory(); if (source) setSetupImport(await props.preflightImport(source, "copy")); } catch { setLoadingError(true); } finally { setChoosing(false); } };
    const importVault = async () => { if (!setupImport) return; setChoosing(true); setLoadingError(false); setSetupMessage("正在后台复制知识库目录…"); try { setSetupJob(await props.startImport(setupImport.source, "copy")); } catch { setChoosing(false); setLoadingError(true); setSetupMessage("导入失败；已完成的内容会在重试时自动跳过。"); } };
    return <OnboardingSurface><main className="onboardingCard" data-plugin="dsh-personal-os" data-surface="onboarding"><PersonalOsBrand /><p className="eyebrow">{t("onboarding.eyebrow")}</p><h1>{settings ? t("onboarding.title") : t("onboarding.loading")}</h1><p className={loadingError ? "error" : "description"}>{loadingError ? t("onboarding.loadError") : t("onboarding.description")}</p>{settings?.personalDataDirectory ? <div className="setupOptions"><span className="setupPath">{settings.personalDataDirectory}</span><label><span><strong>本地版本历史</strong><small>使用隐藏的 Git 检查点，可随时回滚。</small></span><input type="checkbox" checked={settings.versionHistory} disabled={choosing} onChange={(event) => { void props.updatePreferences({ versionHistory: event.target.checked }).then(setSettings); }} /></label><label><span><strong>学习历史会话</strong><small>通过 DSH 会话事件谨慎提炼连续上下文。</small></span><input type="checkbox" checked={settings.historicalLearning} disabled={choosing} onChange={(event) => { void props.updatePreferences({ historicalLearning: event.target.checked }).then(setSettings); }} /></label><div className="setupImport"><span><strong>导入已有知识库目录</strong><small>可选。先预检，默认复制，不修改源目录。</small></span><Button variant="outline" disabled={choosing} onClick={() => { void chooseVault(); }}>选择知识库目录</Button></div>{setupImport && <div className="setupPreview"><span>{setupImport.markdown} 个 Markdown · {setupImport.attachments} 个附件 · {setupImport.conflicts} 个冲突</span><Button variant="primary" disabled={choosing} onClick={() => { void importVault(); }}>开始导入</Button></div>}{(setupJob?.state === "running" || setupJob?.state === "stopping") && <div className="setupPreview"><span>{setupJob.state === "stopping" ? "正在安全停止…" : `正在导入 ${setupJob.progress.completed}/${setupJob.progress.total}`}</span>{setupJob.state === "running" && <Button variant="outline" onClick={() => { void props.cancelImport(setupJob.id).then((next) => { if (next) setSetupJob(next); }); }}>取消</Button>}</div>}{setupMessage && <span className="setupMessage">{setupMessage}</span>}<Button variant="primary" disabled={choosing || setupJob?.state === "running" || setupJob?.state === "stopping"} onClick={() => { setFinishingSetup(false); setPersonalOsMode("page"); }}>进入今天</Button></div> : settings ? <Button variant="primary" disabled={choosing} icon={<IconFolderOpenOutline16 size={16} />} onClick={() => { void choose(); }}>{t(choosing ? "onboarding.choosing" : "onboarding.choose")}</Button> : loadingError && <Button variant="primary" onClick={() => { void reload(); }}>{t("onboarding.retry")}</Button>}</main></OnboardingSurface>;
  }
  if (getSidebarTab() !== "my") return null;
  return <Workspace face={props} />;
}
