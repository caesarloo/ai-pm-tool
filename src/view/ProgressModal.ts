/**
 * 进展更新（§4.5 主动录入）
 * - 从状态总览卡片点击进入，需求由上下文带入
 * - 项目环节时间轴（规则文件驱动：✅ 已完成 / ▶ 当前 / ○ 待进行）；当前节点可「✉️ 发起邮件」进入邮件引擎（§4.6）
 * - 表单（规则文件「可编辑」字段：控件/枚举/写入风格动态生成）→ 变更预览（旧→新）→「⬆️ 提交SVN」
 * - 纯人工录入，无 LLM 建议；写入 frontmatter 并 svn commit（§4.5）
 */
import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type AIPMTool from "../main";
import { type RequirementNote } from "../types";
import { parseRequirementNote } from "../notes/parser";
import { SvnClient, type SvnDiff } from "@caesarloo/simple-svn-client";
import { vaultBasePath } from "../utils/path";
import { log } from "../utils/logger";
import { MailModal } from "./MailModal";
import { loadSvnDiff, renderSvnDiffBox } from "./svnDiffPreview";
import { runSvnSerialized } from "../utils/svnQueue";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 规范化为 <input type="date"> 可接受的 YYYY-MM-DD；非标准格式（如 2026/9/4）尝试转换，失败保持原样（控件显示为空） */
function toDateInputValue(s: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = /(\d{4})[年/.](\d{1,2})[月/.](\d{1,2})/.exec(s);
  return m2 ? `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}` : s;
}

/** 按字段来源读取需求笔记值：「文件名」→ 名称；数组取首项；否则字符串化 */
function rawValue(note: RequirementNote, source: string): string {
  if (source === "文件名") return note.name;
  const v = note.raw[source];
  if (v === undefined || v === null) return "";
  return Array.isArray(v) ? String(v[0] ?? "") : String(v);
}

/**
 * 更新 frontmatter 键值
 * - style: "list"（默认，模板列表风格 `key:\n  - 值`，用于项目状态/需求状态等枚举字段）
 * - style: "inline"（模板内联文本 `key: 值`，用于进展说明/日期等文本字段）
 * 兼容内联与列表两种写法；键不存在时插入；无 frontmatter 时创建
 * - 多行列表：替换该键下全部 `- ` 项为单个新值（避免旧行残留）
 * - 多行值：续行统一缩进，避免破坏 frontmatter 结构
 */
export function updateFrontmatter(content: string, key: string, value: string, style: "list" | "inline" = "list"): string {
  const lines = content.split(/\r?\n/);
  let start = -1;
  let end = -1;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
    if (end > 0) start = 0;
  }
  const formatValue = style === "inline" ? formatInlineValue : formatListValue;
  if (start < 0) {
    const block = `---\n${key}:${formatValue(value)}\n---\n\n`;
    return block + content.replace(/^\uFEFF?/, "");
  }
  const re = new RegExp(`^(${escapeRegex(key)}):\\s*(.*)$`);
  let keyIdx = -1;
  for (let i = start + 1; i < end; i++) {
    if (re.test(lines[i])) {
      keyIdx = i;
      break;
    }
  }
  if (keyIdx < 0) {
    lines.splice(end, 0, `${key}:${formatValue(value)}`);
  } else {
    // 删除该键下的全部列表项/续行（多行块/后续项），再插入新值
    let j = keyIdx + 1;
    const isListItem = (l: string) => /^\s*-\s+/.test(l);
    while (j < end && (isListItem(lines[j]) || /^\s+/.test(lines[j]))) {
      j++;
    }
    const replaced: string[] = [`${key}:${formatValue(value)}`];
    lines.splice(keyIdx, j - keyIdx, ...replaced);
  }
  return lines.join("\n");
}

/** 值 → 列表风格缩进行（多行值续行统一缩进两个空格） */
function formatListValue(value: string): string {
  const cleaned = value.replace(/\r/g, "");
  const parts = cleaned.split("\n");
  return "\n" + parts.map((p, i) => (i === 0 ? `  - ${p}` : `  ${p}`)).join("\n");
}

/** 值 → 内联文本（单行 ` key: 值`；多行用 `|-` 块，仍是文本而非列表） */
function formatInlineValue(value: string): string {
  const cleaned = value.replace(/\r/g, "");
  if (!cleaned.includes("\n")) return ` ${cleaned}`;
  const parts = cleaned.split("\n");
  return ` |-\n` + parts.map((p) => `  ${p}`).join("\n");
}

/** 读取正文「邮件发送时间」（§4.5 时间轴数据：邮件标志位 + 正文发送时间）；
 *  先定位本节点小节标题行，再在其后到下一个 `## ` 独立标题（或文末）的范围内匹配，避免跨节取到后续节点的时间 */
function readMailSendTime(content: string, nodeLabel: string): string | null {
  const lines = content.split(/\r?\n/);
  // 兼容小节标题两种写法：<label>邮件 / <label>（邮件发送记录）；label 带括号时兼容去括号 baseLabel（如 项目准入（开发准入）→ 项目准入）
  const baseLabel = nodeLabel.replace(/（[^）]*）$/, "");
  const titleRe = new RegExp(`^##\\s*(?:${escapeRegex(nodeLabel)}|${escapeRegex(baseLabel)})(?:邮件|（[^）]*）)?\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (titleRe.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const tm = /邮件发送时间：\s*([^\r\n]+)/.exec(lines.slice(start, end).join("\n"));
  return tm ? tm[1].trim() : null;
}

export class ProgressModal extends Modal {
  plugin: AIPMTool;
  note: RequirementNote;
  onSubmitted?: () => void; // 提交成功后回调（如刷新状态总览）
  /** 可编辑字段当前值（source → 值，由规则文件字段驱动） */
  private formValues = new Map<string, string>();
  private submitting = false;
  private svnDiff: SvnDiff | null = null; // 未提交变更（svn diff 真实结果）
  private svnDiffLoaded = false; // diff 是否已尝试加载（区分加载中/不可用）
  private svnDiffSeq = 0; // diff 加载序号：并发加载时只保留最新请求的结果（丢弃过期覆盖）
  private mailNodeLabel = ""; // 最近发起邮件的节点名（完成提示展示具体环节）

  constructor(app: App, plugin: AIPMTool, note: RequirementNote, onSubmitted?: () => void) {
    super(app);
    this.plugin = plugin;
    this.note = note;
    this.onSubmitted = onSubmitted;
    // 按规则「2.3 表单区」字段初始化表单值（来源取 frontmatter 原值）
    for (const f of plugin.rulesOrBuiltin().form) {
      this.formValues.set(f.source, rawValue(note, f.source));
    }
  }

  onOpen(): void {
    const { titleEl } = this;
    titleEl.setText("✎ 项目进展");
    this.contentEl.empty();
    this.contentEl.addClass("ai-pm-progress");
    // 弹窗加宽（Modal 非侧边栏，可容纳时间轴与表单）
    this.modalEl.addClass("ai-pm-modal-wide");
    void this.renderAsync();
  }

  /** 渲染代次：refreshNote 触发新一轮渲染时，旧一轮未完成的渲染不再继续 append（防重复 DOM） */
  private renderSeq = 0;

  /** 每次打开先重读规则文件（修改即时生效），再渲染四个展示区域 */
  private async renderAsync(): Promise<void> {
    const seq = ++this.renderSeq;
    try {
      await this.plugin.loadRulesOnce();
    } catch (e) {
      log.warn(`规则文件读取异常：${(e as Error).message}，使用内置默认`);
      this.plugin.rules = null;
    }
    if (seq !== this.renderSeq) return; // 已被更新的渲染取代：丢弃
    this.contentEl.empty(); // 防重入：刷新时清空旧内容
    const contentEl = this.contentEl;
    const rules = this.plugin.rulesOrBuiltin();
    const rolesText = Object.entries(this.note.roles)
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${k}：${v.join("、")}`)
      .join(" · ");
    const pick = contentEl.createDiv({ cls: "ai-pm-pick" });
    for (const f of rules.context) {
      const src = f.source;
      if (src === "文件名") {
        const nameLink = pick.createEl("a", { cls: "ai-pm-pick-name", text: this.note.name, href: "#" });
        nameLink.title = "打开需求笔记";
        nameLink.addEventListener("click", (e) => {
          e.preventDefault();
          this.openNoteFile();
        });
      } else if (src.includes("负责人") || src.includes("项目经理")) {
        pick.createDiv({ cls: "ai-pm-pick-cur", text: rolesText || "无角色信息" });
      } else if (src.includes("重点项目")) {
        if (this.note.keyProject) pick.createDiv({ cls: "ai-pm-pick-cur", text: "重点项目" });
      } else {
        const v = rawValue(this.note, src);
        if (v) pick.createDiv({ cls: "ai-pm-pick-cur", text: `${f.field}：${v}` });
      }
    }

    // ===== 项目环节时间轴（规则文件驱动，§4.5） =====
    const stages = this.plugin.stages();
    const stagesBox = contentEl.createDiv({ cls: "ai-pm-stages" });
    stagesBox.createDiv({ cls: "ai-pm-stages-t", text: `项目环节（${stages.length} 节点生命周期）` });
    const tl = stagesBox.createDiv({ cls: "ai-pm-tl" });
    // 当前环节 = 第一个未完成节点
    let current = 0;
    for (const [i, m] of stages.entries()) {
      if (!this.note.mailFlags[m.key]) {
        current = i;
        break;
      }
    }
    stages.forEach((m, i) => {
      const st = tl.createDiv({
        cls: `ai-pm-st${this.note.mailFlags[m.key] ? " done" : i === current ? " current" : ""}`,
      });
      st.createSpan({ cls: "ai-pm-st-nm", text: `${i + 1} ${m.label}` });
      if (m.optional) st.createSpan({ cls: "ai-pm-st-opt", text: "可选" });
      if (this.note.mailFlags[m.key]) {
        st.createSpan({ cls: "ai-pm-st-date", text: "✅" }); // 时间由 fillStageDates 异步补充
      } else if (i === current) {
        st.createSpan({ cls: "ai-pm-st-date", text: "▶ 当前" });
        const btn = st.createEl("button", { cls: "ai-pm-st-btn", text: "✉️ 发起邮件" });
        btn.addEventListener("click", () => {
          this.mailNodeLabel = m.label;
          // onDone：邮件回写后刷新弹窗；onCommitted：邮件页 SVN 提交成功后重新加载未提交变更（提交后自动关闭返回本弹窗）
          new MailModal(this.app, this.plugin, this.note, i, () => void this.refreshNote(), () => this.refreshSvnDiff()).open();
        });
      } else {
        st.createSpan({ cls: "ai-pm-st-date", text: "○" });
      }
    });
    // 异步补充正文「邮件发送时间」
    this.fillStageDates(tl, stages);

    // ===== 只读字段区（规则 2.4 只读字段区字段驱动；有值才显示，不修改） =====
    const extras: { label: string; value: string }[] = [];
    for (const f of rules.readOnly) {
      const v = this.note.raw[f.source];
      if (v === undefined || v === null) continue;
      extras.push({ label: f.field, value: Array.isArray(v) ? v.join("、") : String(v) });
    }
    if (extras.length > 0) {
      const extra = contentEl.createDiv({ cls: "ai-pm-extra-box" });
      extra.createDiv({ cls: "ai-pm-extra-t", text: "其他字段（frontmatter 只读）" });
      const tbl = extra.createEl("table");
      for (const e of extras) {
        const tr = tbl.createEl("tr");
        tr.createEl("td", { text: e.label, cls: "ai-pm-extra-k" });
        tr.createEl("td", { text: e.value, cls: "ai-pm-extra-v" });
      }
    }

    // ===== 表单区（规则 2.3 表单区字段驱动：控件/枚举/写入风格，按行序生成） =====
    for (const f of rules.form) {
      const s = new Setting(contentEl).setName(f.field);
      const apply = (v: string): void => {
        this.formValues.set(f.source, v);
        this.renderPreview();
      };
      if (f.control === "select") {
        s.addDropdown((d) => {
          for (const v of f.values) d.addOption(v, v);
          d.setValue(this.formValues.get(f.source) ?? "");
          d.onChange(apply);
        });
      } else if (f.control === "date") {
        s.addText((t) => {
          t.inputEl.type = "date"; // 浏览器原生日期选择控件
          t.setValue(toDateInputValue(this.formValues.get(f.source) ?? ""));
          t.onChange((v) => apply(v.trim()));
        });
      } else if (f.control === "textarea") {
        s.addTextArea((t) => {
          t.setValue(this.formValues.get(f.source) ?? "").onChange(apply);
          t.inputEl.addClass("ai-pm-progress-ta"); // 加宽样式（styles.css）
        });
        s.settingEl.addClass("ai-pm-progress-ta-row");
      } else {
        s.addText((t) => {
          t.setValue(this.formValues.get(f.source) ?? "").onChange(apply);
        });
      }
    }

    // ===== 变更预览（旧值 → 新值） =====
    const preview = contentEl.createDiv({ cls: "ai-pm-preview" });
    preview.createDiv({ cls: "ai-pm-preview-t", text: "变更预览（与 SVN 基线对比）" });
    this.previewEl = preview.createDiv({ cls: "ai-pm-preview-rows" });
    this.renderPreview();

    // ===== 底部按钮（关闭走右上角 ✕，与「返回/取消」行为相同，避免重复） =====
    const foot = contentEl.createDiv({ cls: "ai-pm-modal-foot" });
    const submit = foot.createEl("button", { cls: "ai-pm-btn primary", text: "⬆️ 提交SVN" });
    submit.addEventListener("click", () => this.submit());

    // 异步加载 SVN 未提交变更（svn diff），预览展示真实差异
    void this.loadSvnDiff();
  }

  /** 加载 SVN 未提交变更（svn diff 工作副本 vs BASE），预览展示真实差异；svn 不可用时提示 */
  private async loadSvnDiff(): Promise<void> {
    if (this.svnDiffLoaded) return;
    this.svnDiffLoaded = true;
    const seq = ++this.svnDiffSeq;
    const diff = await loadSvnDiff(this.app, this.note.path);
    // 加载期间又发起了新的 diff 请求（如邮件页 SVN 提交后的刷新）：丢弃本次过期结果，
    // 防止旧 diff（提交前读取）晚到并覆盖新 diff（提交后为空）——svn 工作副本锁会使旧 diff 被 commit 阻塞、完成更晚
    if (seq !== this.svnDiffSeq) return;
    this.svnDiff = diff;
    if (!this.svnDiff) log.warn("未检测到 svn 命令，变更预览仅显示表单编辑差异");
    this.renderPreview();
  }

  /** 重新加载 SVN 未提交变更（外部变更后调用，如邮件页 SVN 提交成功）：清除缓存 → 重新 diff → 刷新预览 */
  refreshSvnDiff(): void {
    this.svnDiff = null;
    this.svnDiffLoaded = false;
    void this.loadSvnDiff();
  }

  /** 打开当前需求笔记文件（文件名链接） */
  private openNoteFile(): void {
    const file = this.app.vault.getAbstractFileByPath(this.note.path);
    if (file instanceof TFile) {
      this.app.workspace.getLeaf(false).openFile(file);
    } else {
      new Notice("找不到笔记文件", 3000);
    }
  }

  private previewEl: HTMLElement | null = null;

  private renderPreview(): void {
    if (!this.previewEl) return;
    this.previewEl.empty();
    const rows: { label: string; old: string; neu: string }[] = [];
    // ① 表单字段编辑差异（当前文件值 → 表单当前值；未保存，提交时才写入）
    for (const f of this.plugin.rulesOrBuiltin().form) {
      const oldV = rawValue(this.note, f.source);
      const neuV = this.formValues.get(f.source) ?? "";
      if (oldV === neuV) continue;
      rows.push({ label: f.field, old: oldV, neu: neuV });
    }
    for (const r of rows) {
      const d = this.previewEl.createDiv({ cls: "ai-pm-preview-row" });
      d.createSpan({ text: `${r.label}：`, cls: "ai-pm-preview-label" });
      d.createSpan({ text: r.old || "（空）", cls: "ai-pm-preview-old" });
      d.createSpan({ text: " → ", cls: "ai-pm-preview-arrow" });
      d.createSpan({ text: r.neu || "（空）", cls: "ai-pm-preview-new" });
    }
    // ② SVN 未提交变更（svn diff 真实结果，与发送邮件结果页共用逻辑）
    renderSvnDiffBox(this.previewEl, this.svnDiff, this.svnDiffLoaded);
    if (this.previewEl.children.length === 0) {
      this.previewEl.createSpan({ text: "无变更", cls: "ai-pm-muted" });
    }
  }

  /** 补充时间轴各已完成节点的正文「邮件发送时间」（异步读取文件） */
  private async fillStageDates(tl: HTMLElement, stages: readonly { key: string; label: string }[]): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.note.path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    const items = tl.querySelectorAll(".ai-pm-st");
    stages.forEach((m, i) => {
      if (this.note.mailFlags[m.key]) {
        const t = readMailSendTime(content, m.label);
        const dateEl = items[i]?.querySelector(".ai-pm-st-date");
        if (dateEl && t) dateEl.textContent = `✅ ${t}`;
      }
    });
  }

  /** 提交：写入 frontmatter → svn commit（§4.5） */
  private async submit(): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const file = this.app.vault.getAbstractFileByPath(this.note.path);
    if (!(file instanceof TFile)) {
      new Notice("找不到需求笔记文件", 5000);
      this.submitting = false;
      return;
    }
    try {
      let content = await this.app.vault.read(file);
      // 按规则「2.3 表单区」字段写入（写入风格：列表/内联；仅写入发生变化的字段）
      for (const f of this.plugin.rulesOrBuiltin().form) {
        const newV = this.formValues.get(f.source) ?? "";
        const oldV = rawValue(this.note, f.source);
        if (newV === oldV) continue;
        content = updateFrontmatter(content, f.source, newV, f.style === "list" ? "list" : "inline");
      }
      await this.app.vault.modify(file, content);
      log.debug(`进展已写入笔记 ${this.note.path}`);

      // svn commit（运行于装有 svn 的主机；不可用时提示但不回滚笔记写入）；经全局单飞队列串行执行
      const cwd = vaultBasePath(this.app);
      log.debug(`准备 svn commit，cwd=${cwd} path=${this.note.path}`);
      const client = new SvnClient(cwd);
      if (await client.isAvailable()) {
        try {
          await runSvnSerialized(() => client.commit([this.note.path], `更新进展：${this.note.name}`, { autoAdd: true }));
          log.debug(`svn commit 成功：${this.note.path}`);
          new Notice(`已提交 SVN：${this.note.path}`, 4000);
        } catch (e) {
          const msg = (e as Error).message;
          log.warn(`SVN 提交失败：${msg.slice(0, 300)}`);
          new Notice(`笔记已写入但 SVN 提交失败：${msg.slice(0, 300)}`, 8000);
        }
      } else {
        log.warn("未检测到 svn 命令，跳过提交");
        new Notice("笔记已写入；本机未检测到 SVN 命令，未提交 SVN（需在装有 SVN 的主机运行）", 8000);
      }
      this.onSubmitted?.();
      this.close();
    } catch (e) {
      log.error("进展提交异常", e);
      new Notice(`提交失败：${(e as Error).message}`, 8000);
    } finally {
      this.submitting = false;
    }
  }

  /** 邮件发送回写后刷新本弹窗（节点标志、时间轴、当前环节变化；SVN 变更预览重新加载） */
  private async refreshNote(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.note.path);
    if (!(file instanceof TFile)) return;
    try {
      const content = await this.app.vault.read(file);
      this.note = { ...this.note, ...pickFresh(this.note.path, content) };
      // 邮件回写产生了新的未提交变更：清除 svn diff 缓存，重绘时重新加载（否则预览停留在打开时的旧 diff）
      this.svnDiff = null;
      this.svnDiffLoaded = false;
      // 重绘当前视图（renderAsync 内部有代次守卫 + empty，防并发渲染重复 DOM）
      void this.renderAsync();
      new Notice(`「${this.mailNodeLabel}」邮件已完成，环节已推进`, 3000);
    } catch (e) {
      log.warn(`邮件后刷新进展失败：${(e as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 刷新时重新解析需求笔记（仅取邮件标志等轻量字段） */
function pickFresh(
  path: string,
  content: string
): Pick<
  RequirementNote,
  "mailFlags" | "projectStatus" | "progress" | "planOnlineDate" | "requestStatus" | "reviewDate" | "devStartDate"
> {
  const fresh = parseRequirementNote(path, content);
  return {
    mailFlags: fresh.mailFlags,
    projectStatus: fresh.projectStatus,
    progress: fresh.progress,
    planOnlineDate: fresh.planOnlineDate,
    requestStatus: fresh.requestStatus,
    reviewDate: fresh.reviewDate,
    devStartDate: fresh.devStartDate,
  };
}
