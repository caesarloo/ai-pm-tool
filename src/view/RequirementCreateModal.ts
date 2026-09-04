/**
 * ✨ 新增需求 / 📋 需求工作台（P1 · 0.1.0 · 设计 §1 / 原型 05）
 * - 规则双源（互不覆盖）：
 *   ① 需求内容生成 SKILL（设置「需求内容生成 SKILL 路径」指向的公司口径文件）：
 *      仅 create 的 LLM 生成（建议文件名=需求名称 + 字段）与 R 名称/列表校验；未配置时不回退审核 SKILL（02），
 *      命名指导用通用三段式文案、名称/列表 R 校验跳过
 *   ② 需求审核 SKILL（设置「需求审核 SKILL 路径」指向的审核规则文件）：
 *      预期价值 L 审核标准（valueRules）；规则宽松、不改动
 * - create（入口：项目总览头部「✨ 新增需求」）：① 输入（需求描述 + 预检）→
 *   ② Templater 以临时文件名真实执行模板创建骨架（工作副本未提交）→
 *   LLM 依据描述 + 内容生成规则自动生成建议文件名（= 需求名称）并填充 frontmatter →
 *   审核规则内容审核（预期价值/需求名称/业务分类，结果不落盘）→
 *   ③ 预览编辑（文件名 + frontmatter 全字段一张表 + 正文骨架，均可编辑）→
 *   ④ 提交 SVN（按最终文件名重命名 + autoAdd 新文件）→ 原地转入需求工作台（detail）
 * - detail（入口：状态总览卡片点击 / create 提交后）：默认展示「项目进展」（环节 / 邮件 / 进展）；
 *   标题行最右侧单一切换按钮「进入编辑」→ 全字段 + 审核规则（可再提交），按钮文案随视图互切
 * - 写入原则：相对打开时磁盘基线做「键级」写回（未改动的键保持磁盘原样，
 *   不覆盖进展页/邮件流程回写的字段）；未提交关闭（create/detail）一律保留文件不删除
 * - 字段集合与默认值来自模板真实执行产物（layout 扫描），不重复内置字段清单（设计 §2）
 */
import { App, Modal, Notice, setIcon, TFile, TFolder } from "obsidian";
import type AIPMTool from "../main";
import { PROJECT_STATUSES, REQUEST_STATUSES, type RequirementNote } from "../types";
import type { RuleStage } from "../rules";
import { parseFrontmatter, parseRequirementNote, scanFrontmatterLayout, serializeFrontmatter, splitFrontmatter } from "../notes/parser";
import { ProgressPanel } from "./ProgressModal";
import { loadReviewSkill, type ReviewSkill } from "../review/skill";
import {
  checkDateField,
  checkRequirementId,
  checkRequirementName,
  checkValuesInList,
  type CheckResult,
  type VLevel,
} from "../review/checks";
import { SvnClient } from "@caesarloo/simple-svn-client";
import { vaultBasePath } from "../utils/path";
import { log } from "../utils/logger";
import { runSvnSerialized } from "../utils/svnQueue";
import type { ChatMessage } from "../llm/gateway";
import { isRetryableLlmError } from "../llm/retry";

// =====================================================================
// 常量与纯函数
// =====================================================================

type FieldKind = "text" | "textarea" | "date" | "number" | "select" | "bool" | "list";
type FmStyle = "list" | "inline";

/** 文件名非法字符（Windows/Obsidian 路径）：`\/:*?"<>|` */
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;

/** 邮箱/编号等不可由 LLM 在批量填充阶段覆盖的保护键（模板默认即正确值 / 流程后补；需求名称走独立建议通道，不在此列）。
 *  邮件环节标志键不在此硬编码：由动态环节（plugin.stages()）在 llmFill 时按需保护 */
const PROTECTED_KEYS = new Set([
  "需求编号",
  "需求状态",
  "项目状态",
  "重点项目",
  "已批准",
  "已驳回",
]);

/** 正文性长文本键（内容类字段，单行放不下；无论当前值长短始终用多行 textarea 编辑/显示，写回时自动落盘为 |- 块） */
const LONG_TEXT_KEYS = new Set(["需求背景简述", "价值描述", "功能点", "进展说明", "备注"]);

/** 描述未提及时 LLM 也必须起草初稿的内容键（生成后标「LLM 起草·待确认」；量化数字用占位，不编造） */
const DRAFT_KEYS = new Set(["价值描述", "功能点"]);

/** 角色/人员类列表键（描述未提及时空值给 ▲ 建议补齐，文案按角色语义） */
const ROLE_LIST_KEYS = new Set([
  "业务对接人",
  "项目经理",
  "产品经理",
  "技术经理",
  "测试经理",
  "产研",
]);

/** LLM 生成总尝试次数上限（含首次；创建主流程）：偶发「模型空响应/超时」等可恢复错误自动重试，页面显示第 n/3 次 */
const LLM_MAX_ATTEMPTS = 3;
/** 自动重试间隔（ms）：给模型网关留缓冲，也让用户看到重试状态 */
const LLM_RETRY_DELAY_MS = 1000;
/** 第 1 次尝试超过该时长（ms）仍未完成 → 生成页展示当前调用次数（避免快速成功时无谓提示） */
const LLM_FIRST_ATTEMPT_SHOW_MS = 5000;

/** 从 LLM 文本提取 JSON 对象（首个 {...} 块），失败返回 null */
function parseJsonObj(text: string): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as unknown;
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 日期值 → YYYY-MM-DD（兼容 2026/9/4、2026年9月4日）；无法识别原样返回（date 控件显示为空） */
function toDateInput(s: string): string {
  const v = s.trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = /(\d{4})[年/.年./](\d{1,2})[月/.](\d{1,2})/.exec(v);
  return m2 ? `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}` : "";
}

/** 归一化 LLM 输出的优先级（其余保持模板默认） */
function normPriority(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (s === "高" || s === "中" || s === "低") return s;
  return null;
}

function textareaAutoGrow(ta: HTMLTextAreaElement): void {
  ta.setCssProps({ height: "auto" });
  ta.setCssProps({ height: Math.max(ta.scrollHeight + 2, 60) + "px" });
}

/** Templater 插件最小类型（仅声明用到的 API；create_new_note_from_template 真实执行模板） */
interface TemplaterPlugin {
  templater: {
    create_new_note_from_template(
      template: TFile,
      folder: string | TFolder | undefined,
      filename: string | undefined,
      open_new_leaf?: boolean
    ): Promise<TFile | null>;
  };
}

/** 字段意见（徽章 + 就地消息） */
interface Verdict {
  level: VLevel;
  source: "R" | "L";
  msgs: string[];
}

/** 预览字段条目（全部由模板执行产物驱动；kind/dflt/llm 由键名语义与值类型推断） */
interface FieldEntry {
  key: string;
  kind: FieldKind;
  style: FmStyle;
  options: string[]; // select 枚举
  text: string; // text/textarea/date/number/select 当前值
  bool: boolean; // bool
  list: string[]; // list chips
  dflt: string; // 列尾说明（= 文件名 / 模板默认·可改 / 邮件回写 / 待补 / 人天…）
  llm: boolean; // 行尾 ✏️（LLM 可重写该字段）
  ro: boolean; // 只读（邮件环节标志灰开关，键集随动态环节）
  initialRepr: string; // 模板产物初始快照（用于「值被改动」判断）
}

function reprOf(e: FieldEntry): string {
  if (e.kind === "list") return e.list.join("、");
  if (e.kind === "bool") return String(e.bool);
  return e.text;
}

/** 由键名语义与模板产物值推断字段类型（不内置字段清单；模板键变化自动跟随）。
 *  stages：当前动态环节（规则文件「一、项目环节」）；命中 key 的字段为「邮件流程回写」只读灰开关 */
function makeEntry(key: string, style: FmStyle, rawValue: unknown, stages: readonly RuleStage[] = []): FieldEntry {
  const mailNode = stages.find((s) => s.key === key);
  const isDate = key.endsWith("日期");
  let kind: FieldKind;
  let options: string[] = [];
  if (mailNode) kind = "bool";
  else if (key === "需求状态") {
    kind = "select";
    options = [...REQUEST_STATUSES];
  } else if (key === "项目状态") {
    kind = "select";
    options = [...PROJECT_STATUSES];
  } else if (key === "优先级") {
    kind = "select";
    options = ["高", "中", "低"];
  } else if (isDate) kind = "date";
  else if (key === "预估工作量") kind = "number";
  else if (key === "重点项目" || key === "已批准" || key === "已驳回") kind = "bool";
  else if (ROLE_LIST_KEYS.has(key) || style === "list" || Array.isArray(rawValue)) kind = "list";
  else if (LONG_TEXT_KEYS.has(key) || (typeof rawValue === "string" && rawValue.includes("\n"))) kind = "textarea";
  else kind = "text";

  let text = "";
  let bool = false;
  let list: string[] = [];
  if (kind === "date") text = toDateInput(rawValue == null ? "" : String(rawValue));
  else if (kind === "list") list = Array.isArray(rawValue) ? rawValue.map(String) : [];
  else if (kind === "bool") bool = rawValue === true || (Array.isArray(rawValue) && rawValue[0] === true);
  else text = rawValue == null ? "" : String(rawValue);

  let dflt = "";
  if (key === "需求名称") dflt = "= 文件名";
  else if (key === "需求编号") dflt = "待补";
  else if (mailNode) dflt = mailNode.optional ? "邮件回写·可选" : "邮件回写";
  else if (key === "预估工作量") dflt = "人天";
  else if (key === "需求状态" || key === "项目状态" || key === "优先级" || key === "重点项目" || key === "已批准" || key === "已驳回")
    dflt = "模板默认·可改";
  else if (isDate) dflt = "模板默认";
  else if (kind === "list" && list.length > 0) dflt = "模板默认";

  const llm =
    kind === "textarea" ||
    key === "需求名称" ||
    (kind === "text" && key !== "需求编号");
  return {
    key,
    kind,
    style,
    options,
    text,
    bool,
    list,
    dflt,
    llm,
    ro: !!mailNode,
    initialRepr: kind === "list" ? list.join("、") : kind === "bool" ? String(bool) : text,
  };
}

/** 转义 frontmatter 键名的正则特殊字符 */
function escapeFmKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 单个 frontmatter 键的段落行（空值只留 `key:`；多行文本用 |- 块） */
function fmKeyLines(key: string, raw: unknown, style: FmStyle): string[] {
  const single = (s: string): string => s.replace(/\r?\n/g, " ").trim();
  if (style === "list") {
    const items = Array.isArray(raw)
      ? raw.map(String)
      : raw === null || raw === undefined || raw === ""
        ? []
        : [String(raw)];
    return items.length === 0 ? [`${key}:`] : [`${key}:`, ...items.map((i) => `  - ${single(i)}`)];
  }
  if (Array.isArray(raw)) {
    // 内联键但值为数组（历史写法）：按列表块写回，YAML 语义一致
    const items = raw.map(String).filter(Boolean);
    return items.length === 0 ? [`${key}:`] : [`${key}:`, ...items.map((i) => `  - ${single(i)}`)];
  }
  if (raw === null || raw === undefined || raw === "") return [`${key}:`];
  const s = String(raw);
  if (s.includes("\n")) return [`${key}: |-`, ...s.replace(/\r/g, "").split("\n").map((l) => `  ${l}`)];
  return [`${key}: ${s}`];
}

/**
 * 键级替换 frontmatter 中单个键的值（保持其余内容与键序原样）：
 * - 无 frontmatter → 返回原文；键不存在 → 追加到 frontmatter 末尾（--- 前）
 * - 键段 = 键行 + 后续缩进行（列表项 / 多行块续行），整体替换
 */
function replaceFmKey(content: string, key: string, raw: unknown, style: FmStyle): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return content;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return content;
  const re = new RegExp(`^${escapeFmKey(key)}:\\s*`);
  let keyIdx = -1;
  for (let i = 1; i < end; i++) {
    if (re.test(lines[i])) {
      keyIdx = i;
      break;
    }
  }
  if (keyIdx < 0) {
    // 键不存在：frontmatter 末尾插入（--- 行之前）
    lines.splice(end, 0, ...fmKeyLines(key, raw, style));
    return lines.join("\n");
  }
  let j = keyIdx + 1;
  while (j < end && (/^\s+/.test(lines[j]) || /^\s*-\s+/.test(lines[j]))) {
    j++;
  }
  lines.splice(keyIdx, j - keyIdx, ...fmKeyLines(key, raw, style));
  return lines.join("\n");
}

// =====================================================================
// ✨ 新增需求 / 📋 需求工作台（P1 · 0.1.0）
// - create：输入描述 → Templater 骨架 → LLM 生成文件名与字段 → 审核 → 预览提交；
//   提交成功后原地切换为 detail（需求工作台），可继续改进展 / 发邮件
// - detail：打开既有需求笔记 → 默认「项目进展」（环节 / 邮件 / 进展提交）；
//   标题行右侧「➤ 进入编辑」按钮 → 全字段 + 审核规则（改动提交 SVN 生效），
//   按钮文案随视图互切（编辑中显示「← 返回进展」，点击返回项目进展）
// - 写入原则：相对打开时基线做「键级」写回（未改动的键保持磁盘原样），
//   未提交关闭（create/detail）一律保留文件不删除
// =====================================================================

export class RequirementCreateModal extends Modal {
  plugin: AIPMTool;
  onDone?: () => void; // 提交成功 / 进展提交后回调（如刷新状态总览）

  private mode: "create" | "detail" = "create";
  private detailNote: RequirementNote | null = null; // detail 模式：打开的需求笔记
  private panel: ProgressPanel | null = null; // detail「项目进展」页签面板

  // ① 输入（需求描述；文件名 = 需求名称，由 LLM 依描述与内容生成规则自动生成，预览可改，提交时按最终名重命名）
  private fileName = ""; // 当前（最终）文件名 = 需求名称：临时占位 → LLM 建议 → 预览可改
  private desc = "";
  // 生成结果 / 打开文件
  private file: TFile | null = null; // 骨架文件（create）/ 打开的需求笔记（detail）
  private layout: { key: string; style: FmStyle }[] = [];
  private entries: FieldEntry[] = [];
  private bodyText = "";
  private llmTouched = new Set<string>(); // 被 LLM 改写过的键（dflt 列标「依描述」等）
  // 磁盘基线（loadFromFile 快照；写入时与当前编辑比较，只写变化键，避免覆盖外部/进展页改动）
  private diskValues: Record<string, unknown> = {}; // 基线 frontmatter 值（变化判断基准）
  private baseBody = "";
  // 审核
  private skill: ReviewSkill | null = null; // 需求审核 SKILL（02 · 审核规则文件，规则宽松，不改动）
  private contentSkill: ReviewSkill | null = null; // 需求内容生成 SKILL（03 公司口径）；未配置 = 无公司口径（命名用通用三段式、名称/列表 R 校验跳过，不回退审核 SKILL）
  private skillLoaded = false; // 已尝试加载 SKILL（避免重复提示）
  private verdicts = new Map<string, Verdict>();
  private banners: string[] = []; // 页顶提示（SKILL 缺失 / LLM 失败 / 打开提示）
  // 状态
  private busy = false;
  private genFailMsg = ""; // 生成失败信息：回到输入页就地展示（可修改描述后再次点击「创建需求」重试）
  private llmWarn = "";

  constructor(app: App, plugin: AIPMTool, opts?: { onDone?: () => void; note?: RequirementNote }) {
    super(app);
    this.plugin = plugin;
    this.onDone = opts?.onDone;
    if (opts?.note) {
      this.mode = "detail";
      this.detailNote = opts.note;
    }
  }

  onOpen(): void {
    if (this.mode === "detail") {
      void this.initDetail();
      return;
    }
    this.titleEl.setText("✨ 新增需求");
    this.contentEl.empty();
    this.contentEl.addClass("ai-pm-req");
    this.modalEl.addClass("ai-pm-modal-wide");
    this.renderInputTab();
    this.showTab("input", "输入信息");
  }

  onClose(): void {
    // 未提交 SVN 而关闭：不删除——把当前编辑（相对基线）写回文件并保留；
    // detail：无改动则静默关闭；create：总是提示文件保留位置
    if (this.file) {
      void this.persistOnCancel(this.file);
    }
    this.panel = null; // 面板 DOM 随 contentEl 清理
    this.contentEl.empty();
  }

  // =================================================================
  // 详情模式：需求工作台（默认项目进展 + 标题行切换按钮进编辑）
  // =================================================================

  private async initDetail(): Promise<void> {
    const note = this.detailNote;
    if (!note) {
      this.close();
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) {
      new Notice(`需求笔记不存在：${note.path}`, 6000);
      this.close();
      return;
    }
    await this.openDetail(file, true);
  }

  /** 构建需求工作台（create 提交后转换 / detail 打开共用）：默认项目进展 + 标题行右侧切换按钮 */
  private async openDetail(file: TFile, runDeepReview: boolean): Promise<void> {
    this.mode = "detail";
    this.contentEl.empty();
    this.contentEl.addClass("ai-pm-req");
    this.modalEl.addClass("ai-pm-modal-wide");
    this.banners = [];
    this.genFailMsg = "";
    this.llmWarn = "";
    this.file = file;
    this.fileName = file.basename;
    this.workTab = "progress";
    this.buildTitleBar(file);
    try {
      await this.loadFromFile(file);
      await this.loadSkillIfNeeded();
      this.buildWorkLayout();
      this.banners.push(
        "默认展示「项目进展」（环节 / 邮件 / 进展提交）；标题行右侧「进入编辑」切换全字段编辑 + 内容审核，改动经「⬆️ 提交 SVN」生效（仅相对打开时基线的改动写回）"
      );
      this.renderPreviewTab(); // 编辑页 = 全字段一张表 + 审核 + 提交
      this.computeVerdicts();
      this.showWorkTab("progress");
      // 「项目进展」视图：挂载进展面板（提交/邮件回写后回调宿主同步）
      const note = parseRequirementNote(file.path, await this.app.vault.read(file), this.plugin.stages().map((s) => s.key));
      this.panel = new ProgressPanel(this.plugin, note, () => void this.handleProgressSubmitted());
      this.panel.setOnChange(() => void this.reloadReviewFromDisk());
      this.panel.mount(this.tabProgress);
      if (runDeepReview) {
        // 价值描述深度 LLM 审核（异步补徽章；不可用/失败静默降级为规则审核）
        void this.runValueReview()
          .then(() => {
            if (this.mode === "detail") this.updateAllRows();
          })
          .catch(() => undefined);
      }
    } catch (e) {
      log.warn(`打开需求工作台失败：${(e as Error).message}`);
      new Notice(`打开需求工作台失败：${(e as Error).message}`, 6000);
    }
  }

  /** 标题行：左侧需求名 + 最右侧单一切换按钮（展示项目进展 → 「➤ 进入编辑」；编辑中 → 「← 返回进展」） */
  private buildTitleBar(file: TFile): void {
    this.titleEl.empty();
    this.titleEl.addClass("ai-pm-work-title");
    this.titleEl.createSpan({ text: `📋 需求工作台 · ${file.basename}`, cls: "ai-pm-work-title-text" });
    this.switchBtn = this.titleEl.createEl("button", { cls: "ai-pm-work-switch" });
    this.renderSwitchBtn("progress");
    this.switchBtn.addEventListener("click", () => {
      this.showWorkTab(this.workTab === "progress" ? "edit" : "progress");
    });
  }

  /** 渲染切换按钮内容：图标（方向箭头）+ 动作文案（指向「点击后要去的视图」）+ 提示 */
  private renderSwitchBtn(tab: "progress" | "edit"): void {
    const goEdit = tab === "progress";
    this.switchBtn.empty();
    const ic = this.switchBtn.createSpan({ cls: "ai-pm-work-switch-ic" });
    setIcon(ic, goEdit ? "chevron-right" : "chevron-left");
    this.switchBtn.createSpan({ text: goEdit ? "进入编辑" : "返回进展" });
    this.switchBtn.title = goEdit
      ? "进入需求编辑（全字段 + 审核规则校验）"
      : "返回项目进展（环节 / 邮件 / 进展提交）";
  }

  /** detail 布局：进展视图(tabProgress，默认) + 编辑视图(tabPreview)；空占位其余 tab（防旧引用） */
  private buildWorkLayout(): void {
    const root = this.contentEl.createDiv({ cls: "ai-pm-req-body" });
    this.tabInput = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });
    this.tabGen = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });
    this.tabPreview = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });
    this.tabDone = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });
    this.tabProgress = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });
  }

  private switchBtn!: HTMLButtonElement;
  private workTab: "progress" | "edit" = "progress";

  /** 视图切换：按钮图标/文案始终指向「点击后要去的视图」（progress →「➤ 进入编辑」；edit →「← 返回进展」） */
  private showWorkTab(tab: "progress" | "edit"): void {
    this.workTab = tab;
    this.tabPreview.toggleClass("is-hidden", tab !== "edit");
    this.tabProgress.toggleClass("is-hidden", tab !== "progress");
    this.renderSwitchBtn(tab);
  }

  /** 进展页提交成功：刷新总览 + 评审区从磁盘重载（进展可能改了状态/日期等键） */
  private handleProgressSubmitted(): void {
    this.onDone?.();
    void this.reloadReviewFromDisk();
  }

  /** 评审区从磁盘同步（进展提交/邮件回写后调用）：
   *  - 评审区无未提交编辑 → 整页重载（entries 与磁盘一致）
   *  - 有未提交编辑 → 保留评审编辑，仅把「未被评审编辑」的键/正文推进为磁盘最新（避免后续写回覆盖进展成果，也不丢评审编辑） */
  private async reloadReviewFromDisk(): Promise<void> {
    if (this.mode !== "detail" || !this.file) return;
    try {
      const file = this.file;
      const content = await this.app.vault.read(file);
      const { body } = splitFrontmatter(content);
      const oldBase = this.diskValues;
      const oldBaseBody = this.baseBody;
      const dirty = this.entriesDirty() || this.bodyText !== oldBaseBody;
      if (!dirty) {
        this.diskValues = parseFrontmatter(content);
        this.baseBody = body;
        await this.loadFromFile(file); // 重建 entries（含进展改动后的值）
        this.computeVerdicts();
        this.renderPreviewTab();
        this.updateAllRows();
        return;
      }
      // 评审区存在未提交编辑：不整页重载（丢编辑）
      const newRaw = parseFrontmatter(content);
      for (const e of this.entries) {
        // 该键被评审编辑过（相对旧基线）→ 保留编辑，不随磁盘
        if (reprOf(e) !== makeEntry(e.key, e.style, oldBase[e.key]).initialRepr) continue;
        const u = makeEntry(e.key, e.style, newRaw[e.key]);
        if (e.kind === "list") e.list = u.list;
        else if (e.kind === "bool") e.bool = u.bool;
        else e.text = u.text;
        this.updateRow(e.key);
      }
      if (this.bodyText === oldBaseBody) this.bodyText = body; // 正文未编辑：随磁盘（正文编辑过则保留）
      this.diskValues = newRaw;
      this.baseBody = body;
      log.debug("评审区存在未提交修改：进展提交后同步未编辑键，保留评审编辑");
    } catch (e) {
      log.warn(`评审区同步失败：${(e as Error).message}`);
    }
  }

  /** 是否有相对打开基线的未提交修改（键值或正文） */
  private entriesDirty(): boolean {
    return this.entries.some((e) => reprOf(e) !== this.baseReprOf(e.key));
  }

  /** 变化键 → { key, style, raw }（与磁盘基线不同才写回，保持磁盘其余键原样） */
  private changedEntries(): { key: string; style: FmStyle; raw: unknown }[] {
    const out: { key: string; style: FmStyle; raw: unknown }[] = [];
    for (const e of this.entries) {
      if (reprOf(e) === this.baseReprOf(e.key)) continue;
      if (e.kind === "list") out.push({ key: e.key, style: e.style, raw: e.list });
      else if (e.kind === "bool") out.push({ key: e.key, style: e.style, raw: e.bool });
      else if (e.kind === "number" && e.text !== "" && Number.isFinite(Number(e.text))) {
        out.push({ key: e.key, style: e.style, raw: Number(e.text) });
      } else out.push({ key: e.key, style: e.style, raw: e.text });
    }
    return out;
  }

  /**
   * 将当前编辑写回文件（create/detail 共用；提交与关闭保留均走此路径）：
   * - 文件名变化（fileName）→ 先 vault 重命名（目标已存在时按 onTaken：notice 抛错 / keep 保留原名）
   * - frontmatter：仅写回相对基线被改动的键（键级段替换，未改键保持磁盘原样，避免覆盖进展/邮件回写）
   * - 正文：仅当相对基线变化时整段写回
   */
  private async writeDisk(opts: { onTaken: "notice" | "keep" }): Promise<{ file: TFile; renamed: boolean; changed: boolean }> {
    if (!this.file) throw new Error("尚未创建需求文件");
    const file = this.file;
    const dir = this.reqDir();
    const newName = this.fileName.trim();
    let renamed = false;
    if (newName && newName !== file.basename) {
      const target = `${dir}/${newName}.md`;
      if (this.app.vault.getAbstractFileByPath(target) instanceof TFile) {
        if (opts.onTaken === "notice") {
          throw new Error(`目标文件名已存在：${target}`);
        }
        log.debug(`关闭保留：目标文件名已存在，保持原名 ${file.basename}`);
      } else {
        await this.app.vault.rename(file, target);
        renamed = true;
        log.debug(`需求文件已重命名：${file.path}`);
      }
    }
    const changes = this.changedEntries();
    const bodyChanged = this.bodyText !== this.baseBody;
    let wrote = false;
    if (changes.length > 0 || bodyChanged) {
      let content = await this.app.vault.read(file);
      for (const c of changes) content = replaceFmKey(content, c.key, c.raw, c.style);
      if (bodyChanged) {
        const { fm } = splitFrontmatter(content);
        content = fm ? `---\n${fm}\n---\n\n${this.bodyText}` : content;
      }
      await this.app.vault.modify(file, content);
      wrote = true;
      // 推进基线：磁盘已等于当前编辑
      this.diskValues = parseFrontmatter(content);
      this.baseBody = this.bodyText;
    } else if (renamed) {
      const content = await this.app.vault.read(file);
      this.diskValues = parseFrontmatter(content);
    }
    return { file, renamed, changed: wrote };
  }

  /**
   * 未提交而关闭：将当前编辑写回并保留文件（不删、不提交 SVN）
   * - create：需求名称与占位文件名不同 → 重命名（目标已存在保留原名）；总是提示文件位置
   * - detail：无任何改动 → 静默关闭（文件保持原样）；有改动 → 写回并提示已保留
   */
  private async persistOnCancel(file: TFile): Promise<void> {
    try {
      const res = await this.writeDisk({ onTaken: "keep" });
      if (this.mode === "detail") {
        if (res.changed || res.renamed) {
          new Notice(`编辑需求的未提交修改已保留到文件：${res.file.path}（未提交 SVN，可在总览卡片重新打开继续）`, 8000);
        }
        return;
      }
      const target = res.renamed ? res.file.path : file.path;
      new Notice(`需求笔记未提交 SVN，已保留在：${target}（可在总览卡片 / 需求工作台中继续处理，或稍后手动提交）`, 8000);
    } catch (e) {
      log.warn(`关闭时保留需求笔记失败：${(e as Error).message}（文件未删除，保留原样：${file.path}）`);
      new Notice(`关闭时保留需求笔记失败：${(e as Error).message}（文件未删除，保留在 ${file.path}）`, 6000);
    }
  }

  // =================================================================
  // Tab 切换
  // =================================================================
  private tabInput!: HTMLElement;
  private tabGen!: HTMLElement;
  private tabPreview!: HTMLElement;
  private tabDone!: HTMLElement;
  private tabProgress!: HTMLElement;
  private stepEl!: HTMLElement;

  private showTab(tab: "input" | "gen" | "preview" | "done", stepName: string): void {
    this.tabInput.toggleClass("is-hidden", tab !== "input");
    this.tabGen.toggleClass("is-hidden", tab !== "gen");
    this.tabPreview.toggleClass("is-hidden", tab !== "preview");
    this.tabDone.toggleClass("is-hidden", tab !== "done");
    this.stepEl.setText(stepName);
  }

  // =================================================================
  // ① 输入信息（预检 + 需求描述；文件名由 LLM 依据描述与 SKILL 自动生成）
  // =================================================================
  private renderInputTab(preserveDesc = ""): void {
    this.contentEl.empty();
    this.fileName = ""; // 新会话：文件名待 LLM 生成（提交前按最终名重命名）
    this.desc = preserveDesc; // 生成失败返回输入页时保留已填描述（避免重输）
    const root = this.contentEl.createDiv({ cls: "ai-pm-req-body" });
    this.stepEl = root.createDiv({ cls: "ai-pm-req-step" });
    this.tabInput = root.createDiv({ cls: "ai-pm-req-tab" });
    this.tabGen = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });
    this.tabPreview = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });
    this.tabDone = root.createDiv({ cls: "ai-pm-req-tab is-hidden" });

    // ---- 需求描述表单（唯一输入；LLM 依据描述 + 内容生成规则自动生成文件名与字段）----
    const pad = this.tabInput.createDiv({ cls: "ai-pm-req-pad" });
    // 生成失败（就地提示，风格对齐邮件「重新生成」：留在当前页 + 错误说明 + 原操作可重试）
    if (this.genFailMsg) {
      const err = pad.createDiv({ cls: "ai-pm-req-err" });
      err.createDiv({ text: "⚠️ 需求生成失败，请修正后再次点击「创建需求」重试" });
      err.createDiv({ cls: "ai-pm-req-err-detail", text: this.genFailMsg });
      err.createDiv({ text: "（本次失败产生的临时骨架已移入回收站，可恢复；关闭窗口时未提交的笔记仍会保留）", cls: "ai-pm-req-err-note" });
    }
    pad.createDiv({
      cls: "ai-pm-req-lbl",
      text: "需求描述（背景 / 目标 / 功能点 / 预期价值 / 计划 / 负责人等——越具体，LLM 生成的需求名称与字段越准确）",
    }).createSpan({ text: " *", cls: "ai-pm-req-req" });
    const descTa = pad.createEl("textarea", {
      cls: "ai-pm-req-txt ai-pm-req-ta",
      attr: {
        rows: "6",
        placeholder:
          "例：某流程目前为逐条人工处理，量大且易出错、效率低。希望支持批量导入（含校验与错误回执），预计处理效率提升约 60%。计划 10 月上线，涉及技术经理：张三。",
      },
    });
    descTa.value = this.desc;
    descTa.addEventListener("input", () => {
      textareaAutoGrow(descTa);
      this.desc = descTa.value;
      this.refreshPrecheck();
    });
    textareaAutoGrow(descTa);
    pad.createDiv({
      cls: "ai-pm-req-desc-tip",
      text: "点击「创建需求」后：Templater 先以临时文件名创建模板骨架 → LLM 依据描述与「需求内容生成规则」（公司财务编码/产品线口径，规则全文来自内容生成 SKILL）自动生成建议文件名与各字段 → 审核规则校验 → 预览页核对 / 修改后提交",
    });

    // 预检区（实时）
    this.precheckEl = pad.createDiv({ cls: "ai-pm-req-precheck" });

    const foot = this.tabInput.createDiv({ cls: "ai-pm-req-foot" });
    this.createBtn = foot.createEl("button", { cls: "ai-pm-req-btn primary", text: "创建需求" });
    this.createBtn.addEventListener("click", () => void this.doCreate());
    this.refreshPrecheck(); // 初始 desc 为空 → 按钮禁用
    descTa.focus();
  }

  private precheckEl!: HTMLElement;
  private createBtn!: HTMLButtonElement;

  /** 临时占位文件名（Templater 创建骨架必需；LLM 不可用/失败时残留，预览页可改，提交时按最终名重命名） */
  private placeholderName(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, "0");
    return `新需求-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  /** 需求目录中是否已存在同名笔记（self 排除自身） */
  private nameTaken(name: string, self?: TFile): boolean {
    if (!name) return false;
    const f = this.app.vault.getAbstractFileByPath(`${this.reqDir()}/${name}.md`);
    return f instanceof TFile && (!self || f.path !== self.path);
  }

  private reqDir(): string {
    return this.plugin.settings.requirementDir.trim().replace(/^\/+|\/+$/g, "");
  }

  private templaterPlugin(): TemplaterPlugin | null {
    const p = (this.app as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("templater-obsidian");
    return (p as TemplaterPlugin | null) ?? null;
  }

  private prechecks(): { ok: boolean; text: string; title: string }[] {
    const provider = this.plugin.gateway?.getActiveProvider();
    const dir = this.reqDir();
    const templatePath = this.plugin.settings.requirementTemplatePath.trim();
    const dirExists = dir !== "" && this.app.vault.getAbstractFileByPath(dir) !== null;
    const templateFile = templatePath ? this.app.vault.getAbstractFileByPath(templatePath) : null;
    return [
      {
        ok: !!provider,
        title: "模型",
        text: provider
          ? `模型已启用：${provider.name} · ${provider.model}`
          : "未启用模型：需先在 设置 → 大模型（自定义模型）中启用一个（此功能强依赖 LLM）",
      },
      {
        ok: this.templaterPlugin() !== null,
        title: "Templater",
        text: this.templaterPlugin()
          ? `Templater 插件已启用（真实执行 ${templatePath || "（未配置模板路径）"}）`
          : "需安装并启用 Templater 插件（第三方插件 → 社区插件 → Templater）",
      },
      {
        ok: !!templateFile,
        title: "模板",
        text: templateFile
          ? `需求模板已找到：${templatePath}`
          : `模板文件缺失：请在 设置 → 需求笔记模板路径 中配置（当前：${templatePath || "（空）"}）`,
      },
      {
        ok: dirExists,
        title: "目录",
        text: dirExists
          ? `需求笔记目录：${dir}/（新笔记将自动命名并落在此目录）`
          : `需求笔记目录不存在或未配置：${dir || "（空）"}（请先在设置中配置）`,
      },
    ];
  }

  private refreshPrecheck(): void {
    if (!this.precheckEl) return;
    this.precheckEl.empty();
    for (const pc of this.prechecks()) {
      const row = this.precheckEl.createDiv({ cls: `ai-pm-req-pc ${pc.ok ? "ok" : "bad"}` });
      row.createSpan({ text: pc.ok ? "✅" : "❌", cls: "ai-pm-req-pc-ic" });
      row.createSpan({ text: pc.text });
    }
    const allOk = this.prechecks().every((p) => p.ok);
    const hasDesc = this.desc.trim() !== "";
    this.createBtn.disabled = !allOk || !hasDesc;
    this.createBtn.setAttr(
      "title",
      this.createBtn.disabled
        ? hasDesc
          ? "请先满足上方预检项（模型 / Templater / 模板 / 目录）"
          : "请先填写需求描述（LLM 将依据描述与审核规则自动生成文件名与字段）"
        : ""
    );
  }

  // =================================================================
  // ② 创建流程：Templater 骨架 → LLM 填充（内容生成规则）→ 内容审核
  //    生成规则 = 内容生成 SKILL（03 公司口径），缺失时命名用通用三段式（不回退 02）；价值 L 审核标准 = 审核 SKILL（02）
  // =================================================================
  private async doCreate(): Promise<void> {
    if (this.busy) return;
    if (!this.desc.trim()) {
      new Notice("请先填写需求描述（LLM 将依据描述与审核规则自动生成文件名与字段）", 5000);
      return;
    }
    const pc = this.prechecks();
    const bad = pc.find((p) => !p.ok);
    if (bad) {
      new Notice(`「${bad.title}」预检未通过：${bad.text}`, 6000);
      return;
    }
    // 临时占位文件名（Templater 创建骨架必需）；LLM 依描述生成建议名后，提交时按最终名重命名
    if (!this.fileName.trim()) this.fileName = this.placeholderName();
    const name = this.fileName.trim();
    this.busy = true;
    this.genFailMsg = "";
    this.llmWarn = "";
    this.banners = [];
    this.file = null;
    this.showTab("gen", "创建中（骨架 → 生成 → 审核）");
    this.renderGenTab();
    try {
      // ① Templater 真实执行模板创建骨架（工作副本未提交；临时文件名）
      this.setGenRow(0, "doing");
      const file = await this.createByTemplater(name);
      this.setGenRow(0, "done");
      this.file = file;

      // 补写 需求名称 = 文件名（模板无此键，需求提交流程使用）+ 布局重排（需求名称置顶）
      await this.applyNameKey(file, name);
      await this.loadFromFile(file);

      // ② SKILL 加载（命名规则注入 + 内容审核共用；缺失/不可用提示一次，不阻塞）→ LLM 生成文件名与字段
      this.setGenRow(1, "doing");
      await this.loadSkillIfNeeded();
      // LLM 自动重试（创建主流程）：偶发「模型空响应/超时」等可恢复错误自动重试，
      // 总尝试 ≤ LLM_MAX_ATTEMPTS（含首次）；不可重试错误（401/配置类）立即失败；生成页显示第 n/3 次
      let llmErr: unknown = null;
      let lastAttempt = 0; // 实际尝试次数（耗尽后 = LLM_MAX_ATTEMPTS；首试即败的不可重试错误 = 1）
      for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
        lastAttempt = attempt;
        this.showGenAttempt(attempt);
        try {
          await this.llmFill();
          llmErr = null;
          break;
        } catch (e) {
          llmErr = e;
          const retryable = isRetryableLlmError(e);
          log.warn(`LLM 生成第 ${attempt}/${LLM_MAX_ATTEMPTS} 次尝试失败：${(e as Error).message}（可重试=${retryable}）`);
          if (!retryable || attempt >= LLM_MAX_ATTEMPTS) break;
          await new Promise<void>((r) => window.setTimeout(r, LLM_RETRY_DELAY_MS));
        }
      }
      if (llmErr !== null) {
        // 尝试耗尽（或首试即败的不可重试错误）：按「第 n/3 次尝试失败」表述（不用「重试 N 次」），
        // 原因取底层 LlmError 消息（剥离业务层包装的「LLM 生成失败：…（已回到输入页…）」冗余），回输入页就地展示
        const causeMsg =
          ((llmErr as { cause?: { message?: string } }).cause?.message ?? "").trim() ||
          (llmErr as Error).message;
        throw new Error(
          (lastAttempt > 1 ? `第 ${lastAttempt}/${LLM_MAX_ATTEMPTS} 次尝试失败：${causeMsg}` : causeMsg),
          { cause: llmErr }
        );
      }
      this.setGenRow(1, "done");
      // LLM 建议文件名重名提醒（提交前仍会再次拦截）
      if (this.file && this.nameTaken(this.fileName, this.file)) {
        this.banners.push(`⚠️ 需求目录已存在同名笔记：${this.reqDir()}/${this.fileName}.md——请在预览页「需求名称」行改名后提交`);
      }

      // ③ 内容审核（审核规则校验；审核 SKILL 缺失/不可用跳过并提示一次，不阻塞）
      this.setGenRow(2, "doing");
      this.beginReviewHint(); // 状态行切换为「内容审核中」并重新计时（生成成功即清旧计时）
      await this.runValueReview();
      this.endGenAttempt(); // 审核结束（通过/降级均返回）：停止阶段计时
      this.computeVerdicts();
      this.setGenRow(2, "done");

      this.renderPreviewTab();
      this.showTab("preview", "预览需求内容");
    } catch (e) {
      this.genFailMsg = (e as Error).message;
      log.warn(`新增需求失败：${this.genFailMsg}`);
      // 失败产生的临时骨架（尚未预览、无用户内容）→ 移入回收站（可恢复），避免占位文件堆积；
      // 关闭窗口（未提交）保留文件的逻辑不受影响
      const failFile = this.file;
      this.file = null;
      if (failFile) void this.removeFailedSkeleton(failFile);
      // 停留在输入页：保留描述 + 就地展示错误，可再次点击「创建需求」重试
      this.renderInputTab(this.desc);
      this.showTab("input", "输入信息");
    } finally {
      this.busy = false;
      this.endGenAttempt(); // 清理尝试耗时时钟与状态标志（成功/失败/关闭弹窗均收尾）
    }
  }

  /** 生成失败产生的临时骨架（未预览、无用户内容）→ 移入回收站（可恢复），避免目录堆积占位文件 */
  private async removeFailedSkeleton(file: TFile): Promise<void> {
    try {
      await this.app.fileManager.trashFile(file);
      log.debug(`失败骨架已移入回收站：${file.path}`);
    } catch (e) {
      log.warn(`失败骨架清理失败：${file.path}（${(e as Error).message}，文件保留）`);
    }
  }

  private async createByTemplater(name: string): Promise<TFile> {
    const tpl = this.templaterPlugin();
    if (!tpl) throw new Error("Templater 插件不可用");
    const templatePath = this.plugin.settings.requirementTemplatePath.trim();
    const template = this.app.vault.getAbstractFileByPath(templatePath);
    if (!(template instanceof TFile)) throw new Error(`需求笔记模板不存在：${templatePath}`);
    const dir = this.reqDir();
    // 目录参数：优先 TFolder（旧版 Templater 要求对象），目录不存在时退回字符串路径
    const folderAbs = this.app.vault.getAbstractFileByPath(dir);
    const folderArg: TFolder | string = folderAbs instanceof TFolder ? folderAbs : dir;
    const file = await tpl.templater.create_new_note_from_template(template, folderArg, name, false);
    if (!file) throw new Error("Templater 未创建笔记（模板执行失败或返回为空）");
    const createdBase = file.basename;
    if (createdBase !== name) {
      new Notice(`目录中已存在同名文件，已自动命名为：${createdBase}`, 5000);
    }
    log.debug(`Templater 已创建骨架：${file.path}`);
    return file;
  }

  /** 补写 需求名称（= 文件名）+ frontmatter 键序重排（需求名称置顶；模板无需求编号则尾部补空键） */
  private async applyNameKey(file: TFile, name: string): Promise<void> {
    const content = await this.app.vault.read(file);
    const { fm, body } = splitFrontmatter(content);
    if (!fm) {
      // 模板产物无 frontmatter（异常）：保持原样不补（后续字段表为空，仍可预览正文）
      log.warn(`模板执行产物无 frontmatter：${file.path}`);
      return;
    }
    const layout = scanFrontmatterLayout(fm);
    const raw = parseFrontmatter(content);
    raw["需求名称"] = name;
    const nextLayout: { key: string; style: FmStyle }[] = [
      { key: "需求名称", style: "inline" },
      ...layout.filter((l) => l.key !== "需求名称" && l.key !== "需求编号"),
    ];
    if (!layout.some((l) => l.key === "需求编号")) {
      nextLayout.push({ key: "需求编号", style: "inline" });
    }
    const next = `---\n${serializeFrontmatter(nextLayout, raw)}\n---\n\n${body}`;
    await this.app.vault.modify(file, next);
  }

  /** 读取骨架产物 → 字段条目 + 正文（layout 为权威字段清单，模板更新自动跟随）；同时快照磁盘基线 */
  private async loadFromFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const { fm, body } = splitFrontmatter(content);
    this.layout = scanFrontmatterLayout(fm || "");
    this.bodyText = body;
    const raw = parseFrontmatter(content);
    this.entries = this.layout.map((l) => makeEntry(l.key, l.style, raw[l.key], this.plugin.stages()));
    this.llmTouched.clear();
    this.diskValues = raw;
    this.baseBody = body;
  }

  /** 磁盘基线中某键的规范化文本（与 FieldEntry.initialRepr 同一换算；供「相对基线是否变化」判断） */
  private baseReprOf(key: string): string {
    const l = this.layout.find((x) => x.key === key);
    return makeEntry(key, l?.style ?? "inline", this.diskValues[key]).initialRepr;
  }

  private genRowEls: HTMLElement[] = [];
  private genStatusEl: HTMLElement | null = null; // 当前阶段所挂环节行的行尾状态 span（0 骨架 / 1 生成 / 2 审核）
  private genAttemptClock: number | null = null; // 尝试耗时秒级刷新时钟（interval）
  private genAttemptActive = false; // 当前尝试是否仍在进行（时钟回调据此判断）
  private genAttemptStartedAt = 0; // 本次尝试开始时刻（Date.now()）
  private genAttemptNo = 0; // 当前尝试编号（1..LLM_MAX_ATTEMPTS）
  private genStage: "gen" | "review" = "gen"; // 状态行当前阶段：生成（n/3 次尝试）或审核（重新计时）

  private renderGenTab(): void {
    this.tabGen.empty();
    const gen = this.tabGen.createDiv({ cls: "ai-pm-req-gen" });
    gen.createDiv({ cls: "ai-pm-req-spinner" });
    this.genRowEls = [];
    this.genStatusEl = null;
    const defs = ["Templater 创建需求文件", "LLM 自动生成文件名与字段", "内容审核"];
    for (const d of defs) {
      const row = gen.createDiv({ cls: "ai-pm-req-grow" });
      const ic = row.createSpan({ cls: "ai-pm-req-gic" });
      row.createSpan({ text: d, cls: "ai-pm-req-gtext" });
      row.createSpan({ cls: "ai-pm-req-gstatus" }); // 环节行行尾状态（计时文案并入对应环节行，不再独立成行）
      ic.setText("○");
      this.genRowEls.push(row);
    }
  }

  private setGenRow(i: number, state: "doing" | "done"): void {
    const row = this.genRowEls[i];
    if (!row) return;
    const ic = row.querySelector<HTMLElement>(".ai-pm-req-gic");
    if (!ic) return;
    ic.setText(state === "done" ? "✓" : "⏳");
    ic.toggleClass("done", state === "done");
    ic.toggleClass("doing", state === "doing");
    if (state === "done") {
      const st = row.querySelector<HTMLElement>(".ai-pm-req-gstatus");
      if (st) st.setText(""); // 环节完成：行尾计时文案清空
      if (this.genStatusEl === st) this.genStatusEl = null;
    }
  }

  /** 状态计时挂到指定环节行的行尾（上一阶段行尾先清空）；环节索引：0 骨架 / 1 LLM 生成 / 2 审核 */
  private attachGenStatus(rowIdx: number): void {
    if (this.genStatusEl) this.genStatusEl.setText("");
    this.genStatusEl = this.genRowEls[rowIdx]?.querySelector<HTMLElement>(".ai-pm-req-gstatus") ?? null;
  }

  /** 生成页调用次数提示：第 1 次尝试前 5s 静默（快速成功不打扰），之后与第 ≥2 次尝试均实时展示实际耗时（秒级刷新） */
  private showGenAttempt(attempt: number): void {
    this.genStage = "gen";
    this.genAttemptActive = true;
    this.genAttemptNo = attempt;
    this.genAttemptStartedAt = Date.now();
    this.attachGenStatus(1); // 挂到「LLM 自动生成文件名与字段」行尾
    if (!this.genStatusEl) return;
    this.genStatusEl.setText("");
    if (this.genAttemptClock === null) {
      this.genAttemptClock = window.setInterval(() => this.refreshGenAttemptText(), 1000);
    }
    if (attempt >= 2) this.refreshGenAttemptText(); // 第 ≥2 次尝试立即展示（不等首个时钟拍）
  }

  /** 生成成功 → 审核开始：计时挂到「内容审核」行尾并重新计时（审核亦调用 LLM 且保留思考，耗时可见） */
  private beginReviewHint(): void {
    this.endGenAttempt(); // 清掉生成阶段的「第 n/3 次尝试」计时（幂等）
    this.attachGenStatus(2); // 挂到「内容审核」行尾（旧行尾已清空）
    if (!this.genStatusEl) return;
    this.genStage = "review";
    this.genAttemptActive = true;
    this.genAttemptNo = 0;
    this.genAttemptStartedAt = Date.now();
    this.genStatusEl.setText("");
    if (this.genAttemptClock === null) {
      this.genAttemptClock = window.setInterval(() => this.refreshGenAttemptText(), 1000);
    }
    this.refreshGenAttemptText(); // 立即刷新（5s 静默窗口内保持空，超时才显示）
  }

  /** 按当前尝试的实际耗时刷新状态行文本（第 1 次尝试未超 5s 时保持空，不打扰） */
  private refreshGenAttemptText(): void {
    if (!this.genAttemptActive || !this.genStatusEl) return;
    const elapsedMs = Date.now() - this.genAttemptStartedAt;
    const text = this.genAttemptText(this.genAttemptNo, elapsedMs);
    if (this.genStatusEl.getText() !== text) this.genStatusEl.setText(text);
  }

  /** 行尾状态文案（生成/审核统一）：常规态（第 1 次生成 / 审核）只显示「已耗时 N 秒」，
   *  生成重试（第 ≥2 次）才显示「⚠️ 第 n/3 次尝试 · 已耗时 N 秒」；5s 静默窗口内为空 */
  private genAttemptText(no: number, elapsedMs: number): string {
    if (elapsedMs < LLM_FIRST_ATTEMPT_SHOW_MS && (this.genStage === "review" || no <= 1)) return "";
    const sec = Math.max(1, Math.ceil(elapsedMs / 1000));
    if (this.genStage === "gen" && no >= 2) {
      return `⚠️ 第 ${no}/${LLM_MAX_ATTEMPTS} 次尝试 · 已耗时 ${sec} 秒`;
    }
    return `已耗时 ${sec} 秒`;
  }

  /** 结束阶段计时展示（清理耗时时钟与进行中标志并复位阶段；幂等，阶段切换与 doCreate 收尾调用） */
  private endGenAttempt(): void {
    this.genAttemptActive = false;
    this.genAttemptNo = 0;
    this.genAttemptStartedAt = 0;
    this.genStage = "gen";
    if (this.genAttemptClock !== null) {
      window.clearInterval(this.genAttemptClock);
      this.genAttemptClock = null;
    }
  }

  private async loadSkillIfNeeded(): Promise<void> {
    if (this.skillLoaded) return;
    this.skillLoaded = true;
    this.skill = await loadReviewSkill(this.app, this.plugin.settings.reviewSkillPath);
    if (!this.skill) {
      this.banners.push("内容审核已跳过：未配置需求审核 SKILL 或文件不可解析（设置 → 需求审核 SKILL 路径）。生成内容仍可预览、编辑与提交。");
    }
    // 内容生成 SKILL（03 公司口径）：配置但不可解析 → 提示一次；命名指导用通用三段式（不回退审核 SKILL）
    const cp = this.plugin.settings.contentSkillPath.trim();
    if (cp) {
      const gen = await loadReviewSkill(this.app, cp);
      if (gen) {
        this.contentSkill = gen;
      } else {
        this.banners.push("需求内容生成 SKILL 不可解析（设置 → 需求内容生成 SKILL 路径）：命名用通用三段式，可预览编辑后提交。");
      }
    }
  }

  /** LLM 需求名称（= 文件名）命名规则文本：内容生成 SKILL（03 公司口径）可用 → 注入其编码映射 + 分类清单 + 规则全文
   *  （03 ctx 命名规则自带格式与真实示例、需求名要点 → 不重复通用文案）；未配置 → 通用三段式说明（不回退审核 SKILL（02）的数据） */
  private buildNameGuidance(): string {
    const ns = this.contentSkill;
    const g: string[] = [];
    if (!ns) {
      // 无 03 公司口径：通用三段式命名指导（必出/起草不另设约束——模型按引导尽可能多填，预览可补）
      g.push(
        "三段式：首段编码 - 中段业务分类/产品线 - 尾段需求描述（格式示例：AA01-示例分类一-示例需求描述一）"
      );
    }
    if (ns) {
      if (ns.bearerByCode.size > 0) {
        g.push(
          `首段编码只取下列之一（原样完整，禁止省略编号或拼造）：${[...ns.bearerByCode.entries()]
            .map(([c, b]) => `${c}（${b}）`)
            .join("、")}`
        );
      }
      if (ns.bizCategories.length > 0) {
        g.push(
          `中段分类从下列允许列表取与「需求主体业务域」最贴切的一项（校验/审查/安全等环节词不改变主体分类）：${ns.bizCategories.join(
            "、"
          )}`
        );
      }
    }
    // 公司口径生成规则全文（内容生成 SKILL 03：命名规则/示例/部门→产品线映射/价值分类/生成输出要求），LLM 须遵守；
    // 产品线/部门允许列表小节已在 vault 侧随重复内容删除（数据含于命名规则第 2 条与部门映射表单行），注入无需剔除
    const ctx = this.contentSkill?.context.trim() ?? "";
    // 结构噪音清理：顶层场景标题冗余（小节标题已表达）、连续空行压平
    const cleanCtx = ctx
      .replace(/^#{1,2}\s*场景\d+\s*[:：][^\n]*\n+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (cleanCtx) {
      g.push(`——以下为公司口径生成规则（内容生成 SKILL），命名与字段值必须遵守——\n${cleanCtx}`);
    }
    if (!ns) {
      g.push("尾段为需求要点概述（避免 实现/开发/功能/优化 等冗余词；4-15 字，公司原例可短，如 4 字）");
    }
    return g.join("\n");
  }

  /** ② LLM 依据描述 + 内容生成规则（03 公司口径；缺失时命名按通用三段式，不回退审核 SKILL）生成「建议文件名（= 需求名称）」与需填写/修改的字段值 JSON（状态/标志/编号等保护键不输出） */
  private async llmFill(): Promise<void> {
    const gateway = this.plugin.gateway;
    const provider = gateway?.getActiveProvider();
    const desc = this.desc.trim();
    if (!provider || !gateway) {
      this.llmWarn = "未启用模型：文件名与字段保留模板默认/占位（可在设置中启用模型后重新生成）";
      return;
    }
    if (!desc) {
      this.llmWarn = "未提供需求描述：LLM 未生成文件名与字段（当前为临时占位文件名，可在预览页修改）";
      return;
    }
    // 邮件环节键集（动态）：规则文件「一、项目环节」的 frontmatter 邮件标志键；缺失回退内置单环节（应用侧兜底用）
    const mailKeys = new Set(this.plugin.stages().map((s) => s.key));
    // 骨架 frontmatter 剔除「保护键/邮件键」后全量送 LLM（其余键含内容三件照送）——
    // 保护键/邮件标志默认值即正确、由流程/邮件引擎维护，无需让模型决策
    const fmList = this.entries
      .filter((e) => !PROTECTED_KEYS.has(e.key) && !mailKeys.has(e.key))
      .map((e) => `${e.key}: ${reprOf(e) || "（空）"}`)
      .join("\n");
    const today = new Date().toISOString().slice(0, 10);
    const sys =
      "你是需求文档助理。模板骨架 frontmatter 已含正确默认值，" +
      "尽可能多地按用户描述与公司口径推断并填写字段值（描述明确 → 照用；可合理推断 → 填；两者皆无依据 → 留空），只输出一个 JSON 对象，无其它文字。规则：\n" +
      "1. 「需求名称」= 建议文件名（不带 .md/路径）。命名规则：\n" +
      this.buildNameGuidance() + "\n" +
      `2. 日期一律 YYYY-MM-DD（今天是 ${today}；描述中的相对时间按今天推算）。`;
    const messages: ChatMessage[] = [
      { role: "system", content: sys },
      { role: "user", content: `用户描述：\n${desc}\n\n--- 当前 frontmatter（模板骨架）---\n${fmList}\n---` },
    ];
    // prompt 构成诊断：定位慢请求的 token 大头（SKILL 03 上下文/规则/描述/frontmatter 各占比），为裁剪提供依据
    log.debug(
      `LLM 提示词构成：sys=${sys.length}字符 user=${messages[1].content.length}字符（描述=${desc.length} frontmatter=${fmList.length}）`
    );
    try {
      const res = await gateway.chat(messages, {
        temperature: 0.3,
        maxTokens: 16384, // 思考长度不稳定（曾 >4000 截断致空 content）：放大上限留足思考+答案空间（网关实测 ≥131072 可用）；同时使重试请求体变化、绕过网关缓存
      });
      const obj = parseJsonObj(res.text);
      if (!obj) {
        // 诊断日志：模型返回非空但非目标 JSON 的内容——截取原文片段便于定性（网关固定提示/模型拒绝话术/JSON 围栏包裹等）
        log.warn(`LLM 内容非 JSON：长度=${res.text.length} 片段=${res.text.slice(0, 200).replace(/\s+/g, " ")}`);
        throw new Error("模型返回非 JSON 内容");
      }
      let suggestedName = "";
      for (const [k, v] of Object.entries(obj)) {
        if (k === "需求名称") {
          suggestedName = String(v ?? "").trim(); // 文件名单独应用（含非法字符清洗）
          continue;
        }
        const e = this.entries.find((x) => x.key === k);
        if (!e) continue;
        if (PROTECTED_KEYS.has(k) || mailKeys.has(k)) continue; // 静态保护键 + 动态邮件环节键：模板默认即正确值，LLM 不覆盖
        this.applyLlmValue(e, v);
        this.llmTouched.add(k);
        if (DRAFT_KEYS.has(k) && reprOf(e).trim() !== "") e.dflt = "LLM 起草·待确认"; // 起草的初稿标「待人工确认」；值为空（LLM 漏出/纯空白）不标，交给 L 徽章提示补齐
      }
      // 建议文件名（= 需求名称）：去 .md 尾、清洗非法字符 → 应用到状态与「需求名称」行（提交时重命名）
      const cleanedName = suggestedName.replace(/\.md$/i, "").replace(ILLEGAL_CHARS, "").trim();
      if (cleanedName) {
        this.fileName = cleanedName;
        const nameEntry = this.entries.find((x) => x.key === "需求名称");
        if (nameEntry) {
          nameEntry.text = cleanedName;
          nameEntry.dflt = "LLM 依描述建议";
        }
      } else {
        this.banners.push("LLM 未返回可用的需求名称：当前文件名为临时占位名，请在预览页「需求名称」行点行尾 ✏️ 或直接编辑（提交时按最终名重命名）");
      }
      // 字段落盘诊断：列出每个被改写键的应用结果（空值定位：模型未给 / 值被白名单/日期过滤置空）
      const touchedDetail = [...this.llmTouched]
        .map((k) => {
          const fe = this.entries.find((x) => x.key === k);
          const r = fe ? reprOf(fe) : "";
          return r && r.trim() ? `${k}=${r.slice(0, 40)}` : `${k}=〔空〕`;
        })
        .join("；");
      log.debug(`LLM 生成完成：文件名=${this.fileName}，改写字段=${this.llmTouched.size}（${touchedDetail}）`);
    } catch (e) {
      // 生成失败不吞异常：由 doCreate 统一回收骨架并回到输入页——就地显示错误、保留描述，
      // 可修改描述后再次点击「创建需求」整体重试（不再带着空字段跳入预览页）；日志由 doCreate 统一记录
      throw new Error(`LLM 生成失败：${(e as Error).message}（已回到输入页，可修改描述后重新创建）`, { cause: e });
    }
  }

  private applyLlmValue(e: FieldEntry, v: unknown): void {
    if (e.kind === "date") {
      const d = toDateInput(v == null ? "" : String(v));
      e.text = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ""; // 非法日期置空（人工补）
      if (e.text) e.dflt = "依描述";
    } else if (e.kind === "number") {
      const n = Number(v);
      e.text = Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? String(Math.trunc(n)) : e.text;
    } else if (e.kind === "select") {
      if (e.key === "优先级") {
        const p = normPriority(v);
        if (p) {
          e.text = p;
          e.dflt = "依描述";
        }
      } else if (e.options.includes(String(v))) {
        e.text = String(v);
      }
    } else if (e.kind === "bool") {
      e.bool = v === true || v === "true";
    } else if (e.kind === "list") {
      const items = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
      e.list = items.filter((x) => x.trim() !== "");
    } else if (e.kind === "textarea") {
      // 模型偶尔把多行清单输出为数组：逐项换行拼接（保持功能点 1. 2. 3. 的可读性）；
      // 整体 trim：LLM 多行文本常带首尾空行（写回 |- 块会留脏空行），纯空白视为未填写（不标「依描述/待确认」）
      e.text = (Array.isArray(v)
        ? (v as unknown[]).map(String).filter((x) => x.trim() !== "").join("\n")
        : String(v ?? "")).trim();
    } else {
      e.text = String(v ?? "");
    }
    if (e.kind !== "date" && e.kind !== "select" && e.kind !== "number") {
      // 文本类/列表：改写即说明「依描述」（相对磁盘基线）
      if (reprOf(e) !== this.baseReprOf(e.key)) e.dflt = "依描述";
    }
  }

  /** ③a 预期价值审核（LLM · temperature 0.1 · SKILL 场景2 审核标准）——结果不落盘 */
  private async runValueReview(): Promise<void> {
    const vEntry = this.entries.find((e) => e.key === "价值描述");
    const gateway = this.plugin.gateway;
    if (!vEntry || !gateway?.getActiveProvider() || !this.skill?.valueRules) return;
    const value = vEntry.text.trim();
    if (!value) {
      this.setVerdict("价值描述", {
        level: "warn",
        source: "L",
        msgs: ["价值描述为空：需量化（历史基线 / 目标值 / 提升比例）或清晰说明业务痛点以证明必要性"],
      });
      return;
    }
    const bg = this.entries.find((e) => e.key === "需求背景简述")?.text.trim() ?? "";
    const fp = this.entries.find((e) => e.key === "功能点")?.text.trim() ?? "";
    const sys =
      "你是需求预期价值审核员（要求严格，按 SKILL 审核标准逐条判定）。只输出 JSON：\n" +
      '{"审核结果":"通过/不通过","不通过原因":["..."],"改进建议":["..."],"数据完整性检查":{"基线值":"有/无/不适用","目标值":"有/无/不适用","改善比例":"有/无/不适用","业务问题说明":"有/无"}}\n\n' +
      "审核标准：\n" + this.skill.valueRules;
    try {
      const res = await gateway.chat(
        [
          { role: "system", content: sys },
          {
            role: "user",
            content: `价值描述：${value}\n需求背景简述：${bg || "（无）"}\n功能点：${fp || "（无）"}`,
          },
        ],
        {
          temperature: 0.1,
          maxTokens: 16384, // 审核保留思考（判断类任务）：disableThinking:false 表达意图（网关未透传时同现状）；上限放大防思考截断（失败不阻塞创建）
          disableThinking: false,
        }
      );
      const obj = parseJsonObj(res.text);
      if (!obj) throw new Error("审核返回非 JSON");
      const result = String(obj["审核结果"] ?? "");
      const bad = /不通过|未通过|不合规|失败|不匹配/.test(result);
      const reasons = Array.isArray(obj["不通过原因"]) ? (obj["不通过原因"] as string[]).filter(Boolean) : [];
      const advices = Array.isArray(obj["改进建议"]) ? (obj["改进建议"] as string[]).filter(Boolean) : [];
      const integ = (obj["数据完整性检查"] as Record<string, string> | undefined) ?? {};
      const noRatio = integ["改善比例"] === "无";
      if (bad) {
        this.setVerdict("价值描述", {
          level: "fail",
          source: "L",
          msgs: [
            ...(reasons.length ? reasons.map((r) => `⚠️ ${r}`) : ["⚠️ 预期价值审核不通过（见 SKILL 审核标准）"]),
            ...(advices.length ? advices.map((a) => `建议：${a}`) : []),
          ],
        });
      } else if (noRatio) {
        // 宽容通过：基线+目标齐备但缺比例 → 提示补齐
        this.setVerdict("价值描述", {
          level: "warn",
          source: "L",
          msgs: [`▲ 宽容通过：已具备历史基线/目标值，但缺提升/下降比例，建议补齐（口径：与基线对比）`],
        });
      } else {
        this.setVerdict("价值描述", { level: "pass", source: "L", msgs: [] });
      }
    } catch (e) {
      this.llmWarn = `预期价值审核不可用：${(e as Error).message}`;
      log.warn(`预期价值审核失败：${(e as Error).message}`);
    }
  }

  private setVerdict(key: string, v: Verdict): void {
    this.verdicts.set(key, v);
  }

  // =================================================================
  // 审核意见（R 规则 + L 结果合并；结果不落盘，仅预览展示）
  // =================================================================
  private computeVerdicts(): void {
    this.verdicts.clear();
    const skill = this.contentSkill; // 名称/列表 R 校验：仅内容生成口径（03）；未配置跳过（不回退审核 SKILL）
    const dates: Record<string, string | undefined> = {};
    for (const e of this.entries) {
      if (e.kind === "date") dates[e.key] = e.text || undefined;
    }
    const code = this.fileName.split("-")[0] ?? "";

    for (const e of this.entries) {
      // ---- R：不依赖 SKILL 的即时规则（日期/编号）----
      if (e.kind === "date") {
        this.setVerdict(e.key, { level: checkDateField(e.key, e.text, dates).level, source: "R", msgs: checkDateField(e.key, e.text, dates).msgs });
      } else if (e.key === "需求编号") {
        const r = checkRequirementId(e.text);
        this.setVerdict(e.key, { level: r.level, source: "R", msgs: r.msgs });
      } else if (e.key === "需求名称") {
        if (skill) {
          const r: CheckResult = checkRequirementName(this.fileName, skill);
          this.setVerdict(e.key, { level: r.level, source: "R", msgs: r.msgs });
        } else {
          this.setVerdict(e.key, { level: "pass", source: "R", msgs: [] });
        }
        // 文件名首段可反推成本承担方（存在对应字段且为空 → 建议性 ▲）
        const bearer = skill?.bearerByCode.get(code);
        if (skill && bearer) {
          const kb = this.entries.find((x) => x.key === "需求归属" || x.key === "成本承担方");
          if (kb && reprOf(kb).trim() === "") {
            this.setVerdict(kb.key, {
              level: "warn",
              source: "R",
              msgs: [`由文件名首段「${code}」反推成本承担方：${bearer}（建议补充）`],
            });
          }
        }
      } else if (e.kind === "list" && skill && (e.key === "归属业务线" || e.key === "成本承担方" || e.key === "需求归属")) {
        // 分类/成本承担方列表值：仅当被改动（非磁盘基线）时校验，模板默认不打扰
        if (reprOf(e) !== this.baseReprOf(e.key)) {
          const allowed =
            e.key === "归属业务线" ? (skill.depts.length > 0 ? skill.depts : skill.bizCategories) : skill.costBearers;
          if (allowed.length > 0) {
            const r = checkValuesInList(e.key, e.list, allowed);
            this.setVerdict(e.key, { level: r.level, source: "R", msgs: r.msgs });
          }
        }
      }
    }

    // ---- L：LLM 填充后的字段说明/建议（仅 create：生成语境才有「依描述」语义；detail 只展示 R 规则审核）----
    // 门槛：任一 SKILL 已配置（02 审核口径或 03 内容生成口径均可；本区不读 SKILL 数据，仅需「有审核语境」）
    if (this.mode === "create" && (this.skill !== null || this.contentSkill !== null) && !this.llmWarn.startsWith("LLM 生成失败")) {
      for (const e of this.entries) {
        if (this.verdicts.has(e.key)) continue; // R 已有（日期/编号/名称）
        if (!e.llm && e.kind !== "list") continue;
        const filled = reprOf(e).trim() !== "";
        if (filled) {
          if (e.kind === "date" && this.llmTouched.has(e.key)) {
            this.setVerdict(e.key, { level: "pass", source: "L", msgs: ["LLM 依描述更新日期（原为模板计算默认值）"] });
          } else if (e.llm) {
            this.setVerdict(e.key, { level: "pass", source: "L", msgs: [] });
          }
        } else if (e.llm || ROLE_LIST_KEYS.has(e.key)) {
          const isRole = ROLE_LIST_KEYS.has(e.key);
          this.setVerdict(e.key, {
            level: "warn",
            source: "L",
            msgs: [
              isRole
                ? `描述未提及${e.key} → 可留空或 chips 添加${e.key === "技术经理" || e.key === "测试经理" ? "（相关阶段前补齐）" : ""}`
                : `描述未提及 → 可留空或点行尾 ✏️ 让 LLM 生成`,
            ],
          });
        }
      }
    }
  }

  // =================================================================
  // ③ 预览编辑：frontmatter 全字段一张表 + 正文
  // =================================================================
  private rowRefs = new Map<string, { badge: HTMLElement; msg: HTMLElement; dflt: HTMLElement; editEl: HTMLElement | null }>();

  private renderPreviewTab(): void {
    this.tabPreview.empty();
    this.rowRefs.clear();
    const pad = this.tabPreview.createDiv({ cls: "ai-pm-req-pad" });

    // 页顶横幅（SKILL 缺失 / LLM 失败等提示一次）
    for (const b of this.banners) {
      pad.createDiv({ cls: "ai-pm-req-banner", text: `ℹ️ ${b}` });
    }
    if (this.llmWarn && !this.banners.some((x) => x.includes("未启用模型"))) {
      pad.createDiv({ cls: "ai-pm-req-banner warn", text: `⚠️ ${this.llmWarn}` });
    }

    // ---- 区域一：frontmatter 全字段一张表 ----
    const sec1 = pad.createDiv({ cls: "ai-pm-req-sec" });
    sec1.createSpan({ cls: "ai-pm-req-sec-t", text: "📄 frontmatter · 全字段一张表" });
    sec1.createSpan({
      cls: "ai-pm-req-sec-cn",
      text: "✓ 通过 / ▲ 建议 / ✕ 不通过 · R=规则 · L=LLM · 文本字段 ✏️ LLM 生成 · 列表 chips 直编",
    });
    const table = pad.createDiv({ cls: "ai-pm-req-fields" });
    for (const e of this.entries) {
      this.buildFieldRow(table, e);
    }

    // ---- 区域二：正文（create = Templater 模板骨架；detail = 笔记正文，均可编辑）----
    const sec2 = pad.createDiv({ cls: "ai-pm-req-sec" });
    sec2.createSpan({
      cls: "ai-pm-req-sec-t",
      text: this.mode === "create" ? "📝 正文 = Templater 模板骨架（LLM 不生成正文）" : "📝 正文（需求笔记内容）",
    });
    sec2.createSpan({
      cls: "ai-pm-req-sec-cn",
      text: this.mode === "create" ? "模板真实执行产物 · 可直接编辑" : "可直接编辑 · 相对打开时基线变化才写回",
    });
    const bodyTa = pad.createEl("textarea", { cls: "ai-pm-req-body-ta" });
    bodyTa.value = this.bodyText;
    bodyTa.addEventListener("input", () => {
      textareaAutoGrow(bodyTa);
      this.bodyText = bodyTa.value;
    });
    textareaAutoGrow(bodyTa);

    // ---- 底部：提示 + 提交 ----
    const foot = this.tabPreview.createDiv({ cls: "ai-pm-req-foot" });
    foot.createSpan({
      cls: "ai-pm-req-foot-hint",
      text: "✕/▲ 需处理时：点字段行尾 ✏️ → 输入提示词 → ⚡ 生成（LLM 重写该字段并自动重审 · 结果不落盘）",
    });
    const submit = foot.createEl("button", { cls: "ai-pm-req-btn primary", text: "⬆️ 提交 SVN" });
    submit.addEventListener("click", () => void this.submit());

    this.updateAllRows();
  }

  /** 构建一个字段行：键名 / 值控件 / 默认说明 / 徽章 / 操作（✏️） */
  private buildFieldRow(parent: HTMLElement, e: FieldEntry): void {
    const row = parent.createDiv({ cls: "ai-pm-req-field" });
    const fm = row.createDiv({ cls: "ai-pm-req-fm" });
    fm.createSpan({ cls: "ai-pm-req-k", text: e.key });
    const vEl = fm.createDiv({ cls: "ai-pm-req-v" });

    // 值控件（一次性构建；list/bool 结构变更时重建本行值区）
    const buildControl = (): void => {
      vEl.empty();
      if (e.kind === "select") {
        const sel = vEl.createEl("select");
        for (const o of e.options) {
          sel.createEl("option", { value: o, text: o });
        }
        sel.value = e.text || "";
        sel.addEventListener("change", () => {
          e.text = sel.value;
          this.onFieldEdited(e, true);
        });
      } else if (e.kind === "date") {
        const inp = vEl.createEl("input", { cls: "ai-pm-req-ctl", attr: { type: "date" } });
        inp.value = e.text;
        inp.addEventListener("change", () => {
          e.text = inp.value;
          this.onFieldEdited(e, false);
        });
      } else if (e.kind === "number") {
        const inp = vEl.createEl("input", { cls: "ai-pm-req-ctl", attr: { type: "number", min: "0", step: "1" } });
        inp.value = e.text;
        inp.addEventListener("input", () => {
          e.text = inp.value;
          this.onFieldEdited(e, false);
        });
      } else if (e.kind === "bool") {
        const box = vEl.createDiv({ cls: "ai-pm-req-bool" });
        if (e.ro) {
          // 邮件环节标志：只读灰开关（由邮件发送流程回写，人工不改）
          box.createDiv({ cls: `ai-pm-req-tg ${e.bool ? "on" : ""}` });
        } else {
          const tg = box.createDiv({ cls: `ai-pm-req-tg tgl ${e.bool ? "on" : ""}` });
          tg.addEventListener("click", () => {
            e.bool = !e.bool;
            buildControl();
            this.onFieldEdited(e, false);
          });
        }
      } else if (e.kind === "list") {
        this.renderChips(vEl, e, buildControl);
      } else if (e.kind === "textarea") {
        const ta = vEl.createEl("textarea", { cls: "ai-pm-req-ctl ai-pm-req-ctl-ta" });
        ta.value = e.text;
        ta.addEventListener("input", () => {
          e.text = ta.value;
          textareaAutoGrow(ta);
          this.onFieldEdited(e, false);
        });
        textareaAutoGrow(ta);
      } else {
        const inp = vEl.createEl("input", { cls: "ai-pm-req-ctl", attr: { type: "text" } });
        if (e.key === "需求编号") inp.setAttr("placeholder", "留空 · 提交流程后人工补填");
        inp.value = e.text;
        inp.addEventListener("input", () => {
          e.text = inp.value;
          // 需求名称 = 文件名：同步（提交时重命名文件）
          if (e.key === "需求名称") this.fileName = e.text.trim();
          this.onFieldEdited(e, false);
        });
      }
    };
    buildControl();

    const dfltEl = fm.createSpan({ cls: "ai-pm-req-dflt", text: e.dflt });
    const badge = fm.createSpan({ cls: "ai-pm-req-badge" });
    const op = fm.createDiv({ cls: "ai-pm-req-op" });
    if (e.llm) {
      const btn = op.createEl("button", { cls: "ai-pm-req-mod", text: "✏️", attr: { title: `LLM 重写「${e.key}」` } });
      btn.addEventListener("click", () => this.toggleEditPanel(row, e));
    }
    const msgEl = row.createDiv({ cls: "ai-pm-req-msg" });

    this.rowRefs.set(e.key, { badge, msg: msgEl, dflt: dfltEl, editEl: null });
  }

  /** 列表字段（Obsidian list 属性 · 多值 chips）：chips + + 添加（回车提交/失焦提交/× 删除） */
  private renderChips(vEl: HTMLElement, e: FieldEntry, rebuild: () => void): void {
    vEl.empty();
    const lst = vEl.createDiv({ cls: "ai-pm-req-lst" });
    for (const [i, item] of e.list.entries()) {
      const chip = lst.createSpan({ cls: "ai-pm-req-chip" });
      chip.createSpan({ text: item });
      const x = chip.createEl("button", { cls: "ai-pm-req-chip-x", attr: { title: "移除" }, text: "×" });
      x.addEventListener("click", () => {
        e.list.splice(i, 1);
        rebuild();
        this.onFieldEdited(e, false);
      });
    }
    const add = lst.createEl("button", { cls: "ai-pm-req-add", text: "+ 添加" });
    const startAdd = (): void => {
      const inp = lst.createEl("input", { cls: "ai-pm-req-add-input", attr: { type: "text", placeholder: "输入后回车" } });
      add.replaceWith(inp);
      inp.focus();
      let done = false;
      const commit = (): void => {
        if (done) return;
        done = true;
        const v = inp.value.trim();
        if (v) e.list.push(v.replace(/[<>&"]/g, ""));
        rebuild();
        this.onFieldEdited(e, false);
      };
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") commit();
        else if (ev.key === "Escape") {
          inp.value = "";
          commit();
        }
      });
      inp.addEventListener("blur", commit);
    };
    add.addEventListener("click", startAdd);
  }

  /** 字段值变化：重算该字段轻量 R 校验并刷新行 UI */
  private onFieldEdited(e: FieldEntry, rerunAll: boolean): void {
    if (e.kind === "date") {
      const dates: Record<string, string | undefined> = {};
      for (const x of this.entries) {
        if (x.kind === "date") dates[x.key] = x.text || undefined;
      }
      const r = checkDateField(e.key, e.text, dates);
      this.setVerdict(e.key, { level: r.level, source: "R", msgs: r.msgs });
    } else if (e.key === "需求编号") {
      const r = checkRequirementId(e.text);
      this.setVerdict(e.key, { level: r.level, source: "R", msgs: r.msgs });
    } else if (e.key === "需求名称") {
      // 名称编辑 → 文件名同步（已在上层处理）
      const ns = this.contentSkill;
      const r = ns ? checkRequirementName(this.fileName, ns) : null;
      if (r) this.setVerdict(e.key, { level: r.level, source: "R", msgs: r.msgs });
    } else if (e.kind === "list" && this.contentSkill && (e.key === "归属业务线" || e.key === "成本承担方" || e.key === "需求归属")) {
      const ns = this.contentSkill;
      const allowed =
        e.key === "归属业务线" ? (ns.depts.length > 0 ? ns.depts : ns.bizCategories) : ns.costBearers;
      if (allowed.length > 0) {
        const r = checkValuesInList(e.key, e.list, allowed);
        this.setVerdict(e.key, { level: r.level, source: "R", msgs: r.msgs });
      } else {
        this.verdicts.delete(e.key);
      }
    } else {
      // 其余字段手改：无 R 规则 → 清除旧意见（保留 L 徽章语义由 ⚡ 生成后重审）
      this.verdicts.delete(e.key);
    }
    if (rerunAll) this.updateAllRows();
    else this.updateRow(e.key);
  }

  /** 整表行 UI 刷新（徽章 + 意见 + dflt） */
  private updateAllRows(): void {
    for (const e of this.entries) this.updateRow(e.key);
  }

  private updateRow(key: string): void {
    const refs = this.rowRefs.get(key);
    if (!refs) return;
    const v = this.verdicts.get(key);
    if (v) {
      refs.badge.setText(`${v.level === "pass" ? "✓" : v.level === "warn" ? "▲" : "✕"}${v.source}`);
      refs.badge.setAttr("class", `ai-pm-req-badge ${v.level}`);
      refs.msg.empty();
      for (const m of v.msgs) {
        const line = refs.msg.createDiv({ cls: `ai-pm-req-msg-line ${v.level}` });
        line.setText(m);
      }
      refs.msg.toggleClass("is-hidden", v.msgs.length === 0);
    } else {
      refs.badge.setText("");
      refs.msg.addClass("is-hidden");
    }
    const entry = this.entries.find((e) => e.key === key);
    if (entry) refs.dflt.setText(entry.dflt);
  }

  // ---- ✏️ 修改面板：提示词 → ⚡ 生成（LLM 重写该字段 → 自动重审，结果不落盘）----
  private toggleEditPanel(row: HTMLElement, e: FieldEntry): void {
    // 同一时间只展开一个面板
    for (const r of this.rowRefs.values()) {
      if (r.editEl) {
        r.editEl.remove();
        r.editEl = null;
      }
    }
    const refs = this.rowRefs.get(e.key);
    if (!refs) return;
    const ed = row.createDiv({ cls: "ai-pm-req-edit" });
    const er = ed.createDiv({ cls: "ai-pm-req-edit-row" });
    const inp = er.createEl("input", {
      cls: "ai-pm-req-edit-in",
      attr: { type: "text", placeholder: `提示词：如何用 LLM 修改「${e.key}」…（如：补充基线值并说明口径）` },
    });
    const gen = er.createEl("button", { cls: "ai-pm-req-btn acc", text: "⚡ 生成" });
    gen.addEventListener("click", () => {
      const req = inp.value.trim();
      if (!req) {
        inp.focus();
        return;
      }
      gen.setText("⏳ 生成中…");
      void this.regenerateField(e, req).finally(() => {
        gen.setText("⚡ 生成");
      });
    });
    er.createEl("button", { cls: "ai-pm-req-btn", text: "取消" }).addEventListener("click", () => {
      ed.remove();
      refs.editEl = null;
    });
    ed.createDiv({
      cls: "ai-pm-req-edit-hint",
      text: "提示词驱动 LLM 重写本字段 → 自动重新审核（R 规则字段重跑规则）；结果不落盘，提交时才写入",
    });
    refs.editEl = ed;
    inp.focus();
  }

  /** 生成/重写字段时的需求上下文：create 用原始描述；detail 无描述时回退到背景简述与功能点 */
  private fieldContext(): string {
    if (this.desc.trim()) return this.desc.trim();
    const bg = this.entries.find((e) => e.key === "需求背景简述")?.text.trim();
    const fp = this.entries.find((e) => e.key === "功能点")?.text.trim();
    const ctx = [bg, fp].filter(Boolean).join("\n");
    return ctx || "（无原始描述：请仅依据字段名与当前值改写）";
  }

  /** ⚡ 单字段 LLM 重写：以提示词修改当前值 → 应用到字段 → 自动重审（R 即时规则 / L 价值审核） */
  private async regenerateField(e: FieldEntry, req: string): Promise<void> {
    const gateway = this.plugin.gateway;
    if (!gateway?.getActiveProvider()) {
      new Notice("未启用模型：无法生成（请先在 设置 → 大模型 中启用）", 6000);
      return;
    }
    try {
      const res = await gateway.chat(
        [
          {
            role: "system",
            content:
              "你是需求文档字段编辑助手。根据用户提示词与需求上下文，重写指定字段值；只输出 JSON：" +
              '{"value": <新值>}。列表/多值字段输出字符串数组；日期输出 YYYY-MM-DD；不要输出其它文字。',
          },
          {
            role: "user",
            content:
              `字段：${e.key}\n当前值：${reprOf(e) || "（空）"}\n需求上下文：${this.fieldContext()}\n` +
              `提示词：${req}\n需求名称：${this.fileName}`,
          },
        ],
        {
          temperature: 0.3,
          maxTokens: 16384, // 单字段重写：900 曾同隐患 → 统一放大（思考关闭由网关层常量控制，此值仅为防截断兜底）
        }
      );
      const obj = parseJsonObj(res.text);
      if (!obj || !("value" in obj)) throw new Error("模型返回非 JSON");
      const v = obj["value"];
      if (e.key === "需求名称") {
        // LLM 重写需求名称：联动文件名（提交时重命名文件）
        const cleaned = String(v ?? "").replace(ILLEGAL_CHARS, "").trim();
        if (cleaned) {
          e.text = cleaned;
          this.fileName = cleaned;
          const target = `${this.reqDir()}/${cleaned}.md`;
          if (this.app.vault.getAbstractFileByPath(target) instanceof TFile && this.file?.path !== target) {
            new Notice("目标文件名已存在，需求名称未应用", 5000);
          } else {
            const ns = this.contentSkill;
            const r = ns ? checkRequirementName(cleaned, ns) : null;
            if (r) this.setVerdict("需求名称", { level: r.level, source: "R", msgs: r.msgs });
            this.updateRow("需求名称");
            const inp = this.rowRefs.get("需求名称")?.badge.parentElement?.querySelector<HTMLInputElement>("input");
            if (inp) inp.value = cleaned;
          }
        }
        return;
      }
      this.applyLlmValue(e, v);
      this.llmTouched.add(e.key);
      // 自动重审：日期/编号 R 即时规则；价值描述重新 L 审核
      if (e.key === "价值描述") {
        await this.runValueReview();
        this.updateRow("价值描述");
      } else {
        this.onFieldEdited(e, false);
      }
      this.updateRow(e.key);
      new Notice(`已按提示词更新「${e.key}」并重新审核`, 3000);
    } catch (err) {
      new Notice(`生成失败：${(err as Error).message}`, 8000);
    }
  }

  // =================================================================
  // ④ 提交 SVN（autoAdd 新文件；rename 旧路径 svn delete）→ create 转入工作台 / detail 刷新
  // =================================================================
  private async submit(): Promise<void> {
    if (this.busy || !this.file) return;
    this.busy = true;
    const file = this.file;
    try {
      const newName = this.fileName.trim();
      if (!newName) {
        new Notice("文件名（需求名称）不能为空", 4000);
        return;
      }
      // 重命名目标预检（writeDisk 的 notice 抛错兜底；此处先给友好提示）
      const dir = this.reqDir();
      const currentBase = file.basename;
      let oldPath = "";
      if (newName !== currentBase) {
        const target = `${dir}/${newName}.md`;
        if (this.app.vault.getAbstractFileByPath(target) instanceof TFile) {
          new Notice(`目标文件名已存在：${target}`, 5000);
          return;
        }
        oldPath = file.path;
      }
      // 写回：rename（若变）+ 键级写变化键 + 正文（若变）
      const res = await this.writeDisk({ onTaken: "notice" });
      const f = res.file;
      if (res.renamed && oldPath) {
        // 旧路径曾纳入版本控制（svn 记录 missing）→ 标记删除随本次提交；未版本化时报错忽略
        const pre = new SvnClient(vaultBasePath(this.app));
        if (await pre.isAvailable()) {
          try {
            await runSvnSerialized(() => pre.delete([oldPath]));
          } catch {
            log.debug(`旧路径未纳入版本控制，无需 svn delete：${oldPath}`);
          }
        }
      }
      // svn commit（运行于装有 svn 的主机；新文件 autoAdd；重命名时一并提交旧路径删除）
      const cwd = vaultBasePath(this.app);
      const client = new SvnClient(cwd);
      const paths = res.renamed ? [f.path, oldPath] : [f.path];
      const msg = this.mode === "create" ? `新增需求：${newName}` : `更新需求：${newName}`;
      if (await client.isAvailable()) {
        try {
          await runSvnSerialized(() => client.commit(paths, msg, { autoAdd: true }));
          log.debug(`需求已提交 SVN：${f.path}`);
          new Notice(`已提交 SVN：${f.path}`, 4000);
          await this.afterCommitOk(f);
        } catch (e) {
          const m = (e as Error).message;
          log.warn(`需求 SVN 提交失败：${m.slice(0, 300)}`);
          new Notice(`笔记已写入但 SVN 提交失败：${m.slice(0, 300)}（可稍后在评审页重试或手动提交）`, 8000);
          await this.afterCommitOk(f); // 内容已落盘：仍转入工作台（编辑视图可再点提交重试）
        }
      } else {
        log.warn("未检测到 svn 命令，跳过提交");
        new Notice("笔记已写入；本机未检测到 SVN 命令，未提交 SVN（需在装有 SVN 的主机运行）", 8000);
        await this.afterCommitOk(f);
      }
    } catch (e) {
      log.error("需求提交异常", e);
      new Notice(`提交失败：${(e as Error).message}`, 8000);
    } finally {
      this.busy = false;
    }
  }

  /** 内容已落盘后的统一收尾：create → 原地转入需求工作台（detail）；detail → 刷新面板（评审提交可能改了文件名） */
  private async afterCommitOk(file: TFile): Promise<void> {
    if (this.mode === "create") {
      this.onDone?.();
      await this.openDetail(file, false);
      return;
    }
    this.onDone?.();
    if (this.panel) {
      this.panel = null;
      this.tabProgress.empty();
    }
    try {
      const content = await this.app.vault.read(file);
      const note = parseRequirementNote(file.path, content, this.plugin.stages().map((s) => s.key));
      this.panel = new ProgressPanel(this.plugin, note, () => void this.handleProgressSubmitted());
      this.panel.setOnChange(() => void this.reloadReviewFromDisk());
      this.panel.mount(this.tabProgress);
    } catch (e) {
      log.warn(`评审提交后刷新进展面板失败：${(e as Error).message}`);
    }
  }
}
