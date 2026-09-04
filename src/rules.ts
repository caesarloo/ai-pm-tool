/**
 * 项目进展规则文件解析（01-AI-PM-TOOL规则文件.md，模板目录下）
 * - 插件读取该文件动态驱动：① 项目环节顺序 ② 进展弹窗四个展示区域（上下文区 / 环节时间轴 / 表单区 / 只读字段区）
 * - 文件为 Markdown 表格（Obsidian 内可直接编辑），约定格式（详见 00-README.md）：
 *   ## 一、项目环节：| 序号 | 环节 | frontmatter 邮件标志 | 可选 |
 *   ## 二、项目进展（4 个区域小节）：
 *     ### 2.1 上下文区：  | 序号 | 字段 | 来源（frontmatter） | 展示方式 |
 *     ### 2.2 环节时间轴：说明小节（由「一、项目环节」驱动，无独立表格）
 *     ### 2.3 表单区：    | 序号 | 字段 | 来源（frontmatter） | 控件 | 取值 / 格式 | 写入风格 |
 *     ### 2.4 只读字段区：| 序号 | 字段 | 来源（frontmatter） |
 * - 解析按小节标题 + 表头列名定位；文件缺失/解析失败时返回 null（调用方回退内置默认）
 */
import { App, TFile } from "obsidian";
import { log } from "./utils/logger";
import { PROJECT_STATUSES, REQUEST_STATUSES } from "./types";

/** 规则文件在模板目录下的固定文件名 */
export const RULES_FILE_NAME = "01-AI-PM-TOOL规则文件.md";

/** 环节（对应 frontmatter 邮件标志） */
export interface RuleStage {
  key: string; // frontmatter 邮件标志键，如 上线审核邮件
  label: string; // 环节展示名，如 上线审核
  optional: boolean; // 可选环节
}

/** 上下文区字段（弹窗顶部：项目名称/负责人/重点项目等） */
export interface ContextField {
  field: string; // 展示名
  source: string; // frontmatter 键（「文件名」= 笔记名）
  display: string; // 展示方式说明（链接/合并/标注等）
}

/** 表单区字段（可编辑，按行序生成控件） */
export interface FormField {
  field: string; // 展示名
  source: string; // frontmatter 键
  control: "select" | "date" | "textarea" | "text"; // 编辑控件
  values: string[]; // 枚举（下拉选项；日期/自由文本为空）
  style: "list" | "inline"; // frontmatter 写入风格
}

/** 只读字段区（frontmatter 只读展示，有值才显示） */
export interface ReadOnlyField {
  field: string;
  source: string;
}

/** 解析后的项目规则（四个展示区域） */
export interface ProjectRules {
  stages: RuleStage[]; // 一、项目环节（时间轴/徽标）
  context: ContextField[]; // 2.1 上下文区
  form: FormField[]; // 2.3 表单区（可编辑）
  readOnly: ReadOnlyField[]; // 2.4 只读字段区
}

/** 表格行 → 单元格（去掉首尾空单元格） */
function cellsOf(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
}

function isSepRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** 按表头列名定位列索引（找不到返回 -1） */
function colIndex(head: string[], names: string[]): number {
  return head.findIndex((h) => names.some((n) => h.includes(n)));
}

/** 控件列 → 控件类型（下拉/日期/多行文本/文本） */
function parseControl(c: string): FormField["control"] {
  if (c.includes("下拉")) return "select";
  if (c.includes("日期")) return "date";
  if (c.includes("多行")) return "textarea";
  return "text";
}

/** 取值/格式列 → 枚举数组（「 / 」分隔；自由文本/日期格式说明返回空） */
function parseValues(v: string): string[] {
  const s = v.trim();
  if (!s || /自由文本|YYYY-MM-DD|true \/ false/i.test(s)) return [];
  const parts = s.split(/[／/]/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [];
}

/** 写入风格列 → list/inline */
function parseStyle(st: string): FormField["style"] {
  if (st.includes("列表")) return "list";
  return "inline";
}

/** 当前小节类型 */
type Section = "none" | "stages" | "context" | "form" | "readonly";

function sectionOf(heading: string): Section {
  if (/项目环节/.test(heading)) return "stages";
  if (/上下文/.test(heading)) return "context";
  if (/表单/.test(heading)) return "form";
  if (/只读|其他字段/.test(heading)) return "readonly";
  return "none";
}

/**
 * 解析规则文件文本（4 区域结构）
 */
export function parseRules(text: string): ProjectRules {
  const rules: ProjectRules = { stages: [], context: [], form: [], readOnly: [] };
  let section: Section = "none";
  // 各小节列索引（表头识别后定位）
  const idx = { label: -1, key: -1, optional: -1, field: -1, source: -1, display: -1, control: -1, values: -1, style: -1 };
  const reset = (): void => {
    idx.label = idx.key = idx.optional = idx.field = idx.source = idx.display = idx.control = idx.values = idx.style = -1;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,6}\s+/.test(line)) {
      section = sectionOf(line.replace(/^#{1,6}\s+/, ""));
      reset();
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = cellsOf(line);
    if (cells.length < 2) continue;
    if (isSepRow(cells)) continue;

    if (section === "stages") {
      if (cells.includes("环节")) {
        idx.label = colIndex(cells, ["环节"]);
        idx.key = colIndex(cells, ["标志"]);
        idx.optional = colIndex(cells, ["可选"]);
        continue;
      }
      if (idx.label < 0 || idx.key < 0) continue;
      const label = cells[idx.label]?.trim() ?? "";
      const key = cells[idx.key]?.trim() ?? "";
      if (!label || !key) continue;
      const opt = idx.optional >= 0 ? cells[idx.optional] ?? "" : "";
      rules.stages.push({ key, label, optional: /可选|✅/.test(opt) });
    } else if (section === "context") {
      if (cells.includes("字段")) {
        idx.field = colIndex(cells, ["字段"]);
        idx.source = colIndex(cells, ["来源"]);
        idx.display = colIndex(cells, ["展示"]);
        continue;
      }
      if (idx.field < 0 || idx.source < 0) continue;
      const field = cells[idx.field]?.trim() ?? "";
      const source = cells[idx.source]?.trim() ?? "";
      if (!field || !source) continue;
      rules.context.push({
        field,
        source,
        display: idx.display >= 0 ? cells[idx.display]?.trim() ?? "" : "",
      });
    } else if (section === "form") {
      if (cells.includes("字段")) {
        idx.field = colIndex(cells, ["字段"]);
        idx.source = colIndex(cells, ["来源"]);
        idx.control = colIndex(cells, ["控件"]);
        idx.values = colIndex(cells, ["取值", "格式"]);
        idx.style = colIndex(cells, ["写入风格"]);
        continue;
      }
      if (idx.field < 0 || idx.source < 0) continue;
      const field = cells[idx.field]?.trim() ?? "";
      const source = cells[idx.source]?.trim() ?? "";
      if (!field || !source) continue;
      rules.form.push({
        field,
        source,
        control: idx.control >= 0 ? parseControl(cells[idx.control] ?? "") : "text",
        values: idx.values >= 0 ? parseValues(cells[idx.values] ?? "") : [],
        style: idx.style >= 0 ? parseStyle(cells[idx.style] ?? "") : "inline",
      });
    } else if (section === "readonly") {
      if (cells.includes("字段")) {
        idx.field = colIndex(cells, ["字段"]);
        idx.source = colIndex(cells, ["来源"]);
        continue;
      }
      if (idx.field < 0 || idx.source < 0) continue;
      const field = cells[idx.field]?.trim() ?? "";
      const source = cells[idx.source]?.trim() ?? "";
      if (!field || !source) continue;
      rules.readOnly.push({ field, source });
    }
  }
  return rules;
}

/**
 * 从模板目录读取规则文件（<模板目录>/01-AI-PM-TOOL规则文件.md）
 * - 模板目录留空 / 文件不存在 / 解析异常 → 返回 null（调用方回退内置默认）
 */
export async function loadRules(app: App, templateDir: string): Promise<ProjectRules | null> {
  const dir = templateDir?.trim().replace(/^\/+|\/+$/g, "");
  if (!dir) {
    log.debug("模板目录未配置，不使用规则文件（回退内置默认）");
    return null;
  }
  const p = `${dir}/${RULES_FILE_NAME}`;
  const f = app.vault.getAbstractFileByPath(p);
  if (!(f instanceof TFile)) {
    log.debug(`规则文件未找到：${p}（回退内置默认）`);
    return null;
  }
  try {
    const rules = parseRules(await app.vault.read(f));
    if (rules.stages.length === 0 && rules.form.length === 0 && rules.readOnly.length === 0) {
      log.warn(`规则文件解析为空：${p}（回退内置默认）`);
      return null;
    }
    log.debug(
      `规则文件已载入：${p}（环节 ${rules.stages.length} · 上下文 ${rules.context.length} · 表单 ${rules.form.length} · 只读 ${rules.readOnly.length}）`
    );
    return rules;
  } catch (e) {
    log.warn(`规则文件解析失败：${p}（${(e as Error).message}），回退内置默认`);
    return null;
  }
}

/** 内置默认规则：规则文件缺失/未配置模板目录时的兜底。
 *  只保留极简通用结构（1 个通用「上线审核」环节 + 通用字段），不预设公司流程、不预设业务字段；
 *  具体环节与字段一律由规则文件「一、项目环节」/「二、项目进展」驱动 */
export function builtinRules(): ProjectRules {
  return {
    stages: [{ key: "上线审核邮件", label: "上线审核", optional: false }],
    context: [
      { field: "项目名称", source: "文件名", display: "链接（点击打开笔记）" },
      { field: "负责人", source: "项目经理 / 产品经理 / 技术经理 / 业务对接人", display: "角色人员合并展示" },
    ],
    form: [
      { field: "项目状态", source: "项目状态", control: "select", values: [...PROJECT_STATUSES], style: "list" },
      { field: "需求状态", source: "需求状态", control: "select", values: [...REQUEST_STATUSES], style: "list" },
      { field: "进展说明", source: "进展说明", control: "textarea", values: [], style: "inline" },
      { field: "计划上线日期", source: "计划上线日期", control: "date", values: [], style: "inline" },
    ],
    readOnly: [
      { field: "需求背景简述", source: "需求背景简述" },
      { field: "需求名称", source: "需求名称" },
    ],
  };
}
