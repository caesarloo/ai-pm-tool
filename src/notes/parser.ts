/**
 * 需求笔记解析（§4.1 / §6）
 * - 仅作用于 SVN 工作副本内的需求笔记
 * - frontmatter 为简化 YAML（支持 键:值 / 键: 列表 / 键: |- 多行块）
 * - 字段缺失容错：新格式 frontmatter（需求名称/需求编号、无项目状态）不报错，空值参与统计（§6.2 格式变体）
 */
import { MAIL_NODES, STAKEHOLDER_ROLES } from "../types";
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

export function parseRequirementNote(path: string, content: string): RequirementNote {
  const raw = parseFrontmatter(content);
  const name = path.replace(/\.md$/i, "").split("/").pop() ?? path;

  const roles: Record<string, string[]> = {};
  for (const r of STAKEHOLDER_ROLES) {
    roles[r] = list(raw[r]);
  }

  const mailFlags: Record<string, boolean> = {};
  for (const n of MAIL_NODES) {
    mailFlags[n.key] = booleanOf(raw[n.key]);
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
