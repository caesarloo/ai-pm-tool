/**
 * 需求笔记解析（§4.1 / §6）
 * - 仅作用于 SVN 工作副本内的需求笔记
 * - frontmatter 为简化 YAML（支持 键:值 / 键: 列表 / 键: |- 多行块）
 * - 字段缺失容错：新格式 frontmatter（需求名称/需求编号、无项目状态）不报错，空值参与统计（§6.2 格式变体）
 */
import { STAKEHOLDER_ROLES } from "../types";
import type { RequirementNote } from "../types";

/** 从 Markdown 文本提取 frontmatter 区块（不含 --- 行），无则返回 null */
export function extractFrontmatterBlock(text: string): string | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : null;
}

/** 简化 YAML 解析：返回扁平对象（键 -> string | number | boolean | string[] | null） */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const block = extractFrontmatterBlock(text);
  if (!block) return {};
  const out: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^([^:#][^:]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1].trim();
    const val = m[2].trim();
    i++;

    if (val === "" || val === "null" || val === "~") {
      // 空值：可能是列表或块
      if (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const items: (string | number | boolean)[] = [];
        while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
          items.push(parseScalar(lines[i].replace(/^\s*-\s+/, "").trim()));
          i++;
        }
        out[key] = items;
      } else if (i < lines.length && /^\s*[|>][+-]?\s*$/.test(lines[i])) {
        // 多行块
        i++;
        const chunk: string[] = [];
        while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
          chunk.push(lines[i].trim());
          i++;
        }
        out[key] = chunk.join("\n");
      } else {
        out[key] = null;
      }
    } else if (/^\s*[|>][+-]?\s*$/.test(val)) {
      const chunk: string[] = [];
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
        chunk.push(lines[i].trim());
        i++;
      }
      out[key] = chunk.join("\n");
    } else if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
      // 日期（YYYY-MM-DD，可带时间）保持字符串，避免 Number() 产生 NaN
      out[key] = val;
    } else if (/^-?\d+$/.test(val)) {
      out[key] = Number(val);
    } else if (val === "true" || val === "false") {
      out[key] = val === "true";
    } else if (val.startsWith("[") && val.endsWith("]")) {
      // 内联列表写法：[a, b, c]（真实模板存在该风格）
      const inner = val.slice(1, -1);
      out[key] = inner
        .split(",")
        .map((s) => parseScalar(s.trim().replace(/^["']|["']$/g, "")))
        .filter((s) => s !== "");
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** 标量类型转换：布尔 / 数字 / 其余字符串（列表项与内联列表共用） */
function parseScalar(s: string): string | number | boolean {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s; // 日期保持字符串
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s === "true") return true;
  if (s === "false") return false;
  return s;
}

/** 取字段值（兼容标量 / 列表 / null），返回字符串或 null */
function scalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length > 0 ? String(v[0]) : null;
  return String(v);
}

/** 取列表值 */
function list(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

/** 布尔字段读取：兼容内联 `key: true` 与列表 `key:\n  - true`（邮件标志写入使用内联 boolean 风格） */
function booleanOf(v: unknown): boolean {
  if (v === true) return true;
  if (Array.isArray(v)) return v[0] === true;
  return false;
}

export function parseRequirementNote(path: string, content: string, mailKeys: readonly string[] = []): RequirementNote {
  const raw = parseFrontmatter(content);
  const name = path.replace(/\.md$/i, "").split("/").pop() ?? path;

  const roles: Record<string, string[]> = {};
  for (const r of STAKEHOLDER_ROLES) {
    roles[r] = list(raw[r]);
  }

  // 邮件环节标志：仅按传入的当前环节键集读取（环节由规则文件动态驱动，不内置固定键表）
  const mailFlags: Record<string, boolean> = {};
  for (const k of mailKeys) {
    mailFlags[k] = booleanOf(raw[k]);
  }

  return {
    path,
    name,
    requestStatus: scalar(raw["需求状态"]),
    projectStatus: scalar(raw["项目状态"]),
    roles,
    effort: scalar(raw["预估工作量"]),
    reviewDate: scalar(raw["需求评审日期"]),
    devStartDate: scalar(raw["开发投入日期"]),
    planOnlineDate: scalar(raw["计划上线日期"]),
    progress: scalar(raw["进展说明"]),
    keyProject: booleanOf(raw["重点项目"]),
    mailFlags,
    raw,
  };
}

/** 判断是否为「需求名称/需求编号」新格式变体（§6.2 格式变体） */
export function isNewFormatVariant(raw: Record<string, unknown>): boolean {
  return raw["需求名称"] !== undefined || raw["需求编号"] !== undefined;
}

// =====================================================================
// frontmatter 序列化（P1 · 0.1.0 ✨ 生成需求：骨架全字段写回/预览提交）
// - 键序与写入风格（列表/内联）以模板真实执行产物为准（scanFrontmatterLayout），
//   序列化按原风格写回，模板更新自动跟随（不重复内置字段清单，设计 §2）
// - 格式化细节与 ProgressModal.updateFrontmatter 共用（formatListValue/formatInlineValue）
// =====================================================================

/** 值 → 列表风格缩进行（多行值续行统一缩进两个空格；与 ProgressModal 内联实现一致，迁移共用） */
export function formatListValue(value: string): string {
  const cleaned = value.replace(/\r/g, "");
  const parts = cleaned.split("\n");
  return "\n" + parts.map((p, i) => (i === 0 ? `  - ${p}` : `  ${p}`)).join("\n");
}

/** 值 → 内联文本（单行 ` key: 值`；多行用 `|-` 块，仍是文本而非列表） */
export function formatInlineValue(value: string): string {
  const cleaned = value.replace(/\r/g, "");
  if (!cleaned.includes("\n")) return ` ${cleaned}`;
  const parts = cleaned.split("\n");
  return ` |-\n` + parts.map((p) => `  ${p}`).join("\n");
}

/** 拆分为 frontmatter 块内文本 + 正文（frontmatter 缺失时 fm=""、body=原文）；正文去掉前导空行 */
export function splitFrontmatter(content: string): { fm: string; body: string } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return { fm: "", body: content };
  return { fm: m[1], body: content.slice(m[0].length).replace(/^\r?\n+/, "") };
}

/**
 * 扫描 frontmatter 块内文本的键序与写入风格（列表/内联）
 * - 缩进行（列表项/块续行）跳过；`key:` 空值后跟 `- ` 项 → list；`[...]` 内联列表 → list
 * - 用于「生成需求」预览提交：按模板真实执行产物的原风格序列化写回（模板更新自动跟随）
 */
export function scanFrontmatterLayout(fmText: string): { key: string; style: "list" | "inline" }[] {
  const out: { key: string; style: "list" | "inline" }[] = [];
  const lines = fmText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue; // 缩进行（列表项/块续行）
    const m = /^([^:#][^:]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    let style: "list" | "inline" = "inline";
    if (val === "") {
      // 空值：下一行是 `- ` 列表项 → list；`|>` 块指令 → inline（多行文本块）
      const next = i + 1 < lines.length ? lines[i + 1] : "";
      if (/^\s*-\s+/.test(next)) style = "list";
    } else if (/^\[.*\]$/.test(val)) {
      style = "list"; // 内联列表写法 [a, b]
    } else if (/^[|>][+-]?\s*$/.test(val)) {
      style = "inline"; // 多行文本块指令
    }
    out.push({ key, style });
  }
  return out;
}

/** 序列化 frontmatter 块内文本（按 layout 的键序与风格写回 values；模板默认即初值，人工/LLM 修改后原风格落地） */
export function serializeFrontmatter(
  layout: { key: string; style: "list" | "inline" }[],
  values: Record<string, unknown>
): string {
  const singleLine = (s: string): string => s.replace(/\r?\n/g, " ").trim();
  const rows: string[] = [];
  for (const { key, style } of layout) {
    const raw = values[key];
    if (style === "list") {
      const items = Array.isArray(raw)
        ? raw.map(String)
        : raw === null || raw === undefined || raw === ""
          ? []
          : [String(raw)];
      rows.push(`${key}:`);
      for (const it of items) rows.push(`  - ${singleLine(it)}`);
    } else if (Array.isArray(raw)) {
      // 内联键但值为列表（模板/人工改写过）：按列表块写出，YAML 语义一致
      rows.push(`${key}:`);
      for (const it of raw) rows.push(`  - ${singleLine(it)}`);
    } else if (raw === null || raw === undefined || raw === "") {
      rows.push(`${key}:`);
    } else {
      const s = String(raw);
      if (s.includes("\n")) {
        rows.push(`${key}: |-`);
        for (const l of s.replace(/\r/g, "").split("\n")) rows.push(`  ${l}`);
      } else {
        rows.push(`${key}: ${s}`);
      }
    }
  }
  return rows.join("\n");
}
