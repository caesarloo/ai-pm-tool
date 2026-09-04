/**
 * 需求审核 SKILL 章节提取器（P1 · 0.1.0 ✨ 生成需求 · 设计 §1 ④ / §5）
 * - 审核规则源 = 设置项「需求审核 SKILL 路径」指向的 vault 审核规则文件
 * - 读取后仅提取审核相关章节（需求名称生成 / 预期价值审核 / 业务需求分类校验 / 手工审核清单）作为审核上下文，
 *   其余流程/工具相关场景忽略——文件更新自动生效
 * - 解析「需求归属 → 财务编码映射表」（成本承担方 → 编码）、「允许的产品线/需求分类列表」（55 项）、
 *   「成本承担方可选项」列表，供规则校验（R）使用
 * - 章节定位按标题关键词（不依赖场景编号，SKILL 更新/编号变化不受影响）；提取失败返回 null（调用方跳过审核并提示一次，不阻塞创建）
 */
import { App, TFile } from "obsidian";
import { log } from "../utils/logger";

/** SKILL 解析结果：审核上下文 + 规则数据 */
export interface ReviewSkill {
  /** 提取的审核章节文本（需求名称生成/业务分类校验/手工审核清单等，供名称纠偏与人工复核参考） */
  context: string;
  /** 预期价值审核章节（场景2：通过/不通过条件 + 输出格式，供 LLM 价值审核专用上下文） */
  valueRules: string;
  /** 需求归属（成本承担方，归一化）→ 需求命名财务编码 */
  codeByBearer: Map<string, string>;
  /** 财务编码 → 成本承担方（反查） */
  bearerByCode: Map<string, string>;
  /** 允许的产品线/需求分类列表（55 项） */
  bizCategories: string[];
  /** 允许的业务部门列表（公司口径 SKILL 的「归属业务线」字段取值；审核口径 SKILL 无此区段 → 空） */
  depts: string[];
  /** 成本承担方可选项（24/25 项） */
  costBearers: string[];
}

/** 标题关键词 → 是否审核相关章节（design：需求名称生成 / 预期价值审核 / 业务需求分类校验 / 手工审核清单） */
const SECTION_KEYWORDS: { key: string; match: RegExp }[] = [
  { key: "name", match: /^场景\s*\d+\s*[:：]\s*需求名称/ },
  { key: "value", match: /^场景\s*\d+\s*[:：]\s*预期价值/ },
  { key: "category", match: /^场景\s*\d+\s*[:：]\s*业务需求分类/ },
  { key: "manual", match: /^场景\s*\d+\s*[:：]\s*手工审核/ },
];

/** 归一化：忽略大小写、空格及中英文标点/括号/连字符差异（如「示例分类甲」=「示例-分类甲」、「示例分类乙（试行）」=「示例-分类乙（试行）」） */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-—–·（()）【】[\]{}<>"':：,，。.、/\\|《》「」]/g, "");
}

/** 标题级别（# 数量）；非标题返回 0 */
function headingLevel(line: string): number {
  const m = /^(#{1,6})\s+/.exec(line.trim());
  return m ? m[1].length : 0;
}

/** 行是否为场景标题（##/### 场景N: …） */
function isScenarioHeading(line: string): boolean {
  const lv = headingLevel(line);
  if (lv === 0) return false;
  return /^场景\s*\d+\s*[:：]/.test(line.trim().replace(/^#{1,6}\s+/, ""));
}

/** 取「从 startIdx（含）到下一个同级或更高级标题前」的文本块（用于列表/映射表小节：子标题均同级，后随短段落） */
function sliceToNextHeading(lines: string[], startIdx: number, level: number): string {
  const parts: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const lv = headingLevel(lines[i]);
    if (lv > 0 && lv <= level) break;
    parts.push(lines[i]);
  }
  return parts.join("\n").trim();
}

/** 找首个匹配文本（大小写不敏感）的行索引；未命中返回 -1 */
function findLine(lines: string[], needle: string, from = 0): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i;
  }
  return -1;
}

/** 表格行 → 单元格（去掉首尾空单元格） */
function cellsOf(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
}

/** 段落列表：切分顿号/逗号分隔项，过滤空值与说明性行 */
function parseListBlock(block: string): string[] {
  const items = block
    .split(/\r?\n/)
    .flatMap((line) => {
      const t = line.trim();
      if (!t || /^[#|]/.test(t) || /[:：]/.test(t) || /^```/.test(t)) return [];
      return t.split(/[、，,]/).map((x) => x.trim());
    })
    .filter((x) => x && !/^\d+[.、]/.test(x) && !/^[-*]\s/.test(x));
  return [...new Set(items)];
}

/**
 * 解析 SKILL 文本：提取审核章节 + 编码映射/允许列表/成本承担方可选项
 * - 场景块边界：到下一个「场景N:」标题为止（场景内子标题级别相同，不截断）；
 *   块内的「### 触发条件」段落为场景复用文案（非审核规则），裁剪掉
 */
export function parseReviewSkill(text: string): ReviewSkill | null {
  const skill: ReviewSkill = {
    context: "",
    valueRules: "",
    codeByBearer: new Map(),
    bearerByCode: new Map(),
    bizCategories: [],
    depts: [],
    costBearers: [],
  };
  const lines = text.split(/\r?\n/);
  const sections: { key: string; text: string }[] = [];
  let anySection = false;

  for (let i = 0; i < lines.length; i++) {
    if (!isScenarioHeading(lines[i])) continue;
    const lv = headingLevel(lines[i]);
    const title = lines[i].trim().replace(/^#{1,6}\s+/, "");
    const hit = SECTION_KEYWORDS.find((s) => s.match.test(title));
    if (!hit) continue;
    anySection = true;
    // 收集到下一个场景标题前；跳过块内「触发条件」复用段落
    const parts: string[] = [];
    let skipUntilHeading = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (headingLevel(lines[j]) > 0 && isScenarioHeading(lines[j])) break;
      if (skipUntilHeading) {
        if (headingLevel(lines[j]) > 0) skipUntilHeading = false;
        else continue;
      }
      if (/^#{2,4}\s*触发条件/.test(lines[j].trim())) {
        skipUntilHeading = true;
        continue;
      }
      parts.push(lines[j]);
    }
    sections.push({ key: hit.key, text: `# ${title}\n\n${parts.join("\n").trim()}` });
    void lv;
  }
  if (!anySection) {
    // 一个审核章节都未提取到（结构变化）→ 视为提取失败（null），由调用方跳过审核并提示一次
    return null;
  }
  skill.context = sections.map((s) => s.text).join("\n\n---\n\n");
  const valueSec = sections.find((s) => s.key === "value");
  if (valueSec) skill.valueRules = valueSec.text;

  // ② 需求归属 → 财务编码映射表（表格行：| 成本承担方 | 编码 |）
  const mapTitleIdx = findLine(lines, "需求归属 → 财务编码映射表");
  if (mapTitleIdx >= 0) {
    const block = sliceToNextHeading(lines, mapTitleIdx, headingLevel(lines[mapTitleIdx]));
    for (const row of block.split(/\r?\n/)) {
      if (!row.trim().startsWith("|")) continue;
      const c = cellsOf(row);
      if (c.length < 2) continue;
      const bearer = c[0].trim();
      const code = c[1].trim();
      if (!bearer || !/^[A-Za-z0-9]+$/.test(code)) continue;
      skill.codeByBearer.set(normText(bearer), code);
      skill.bearerByCode.set(code, bearer);
    }
  }

  // ③ 允许的产品线/需求分类列表（55 项）
  const catIdx = findLine(lines, "允许的产品线/需求分类列表");
  if (catIdx >= 0) {
    skill.bizCategories = parseListBlock(sliceToNextHeading(lines, catIdx, headingLevel(lines[catIdx])));
  }

  // ③b 允许的业务部门列表（公司口径「归属业务线」字段；02 审核版无此区段 → 空）
  const deptIdx = findLine(lines, "允许的业务部门列表");
  if (deptIdx >= 0) {
    skill.depts = parseListBlock(sliceToNextHeading(lines, deptIdx, headingLevel(lines[deptIdx])));
  }

  // ④ 成本承担方可选项（24/25 项）
  const cbIdx = findLine(lines, "成本承担方可选项");
  if (cbIdx >= 0) {
    skill.costBearers = parseListBlock(sliceToNextHeading(lines, cbIdx, headingLevel(lines[cbIdx])));
  }

  log.debug(
    `SKILL 解析完成：审核章节=${sections.length} 编码映射=${skill.codeByBearer.size} 分类列表=${skill.bizCategories.length} 业务部门=${skill.depts.length} 成本承担方=${skill.costBearers.length}`
  );
  return skill;
}

/**
 * 从 vault 读取并解析需求审核 SKILL
 * - 路径留空 / 文件缺失 / 解析失败 → null（调用方跳过审核并提示一次，不阻塞创建）
 */
export async function loadReviewSkill(app: App, path: string): Promise<ReviewSkill | null> {
  const p = path?.trim() ?? "";
  if (!p) {
    log.debug("未配置需求审核 SKILL 路径，跳过内容审核");
    return null;
  }
  const f = app.vault.getAbstractFileByPath(p);
  if (!(f instanceof TFile)) {
    log.warn(`需求审核 SKILL 未找到：${p}（跳过内容审核）`);
    return null;
  }
  try {
    const skill = parseReviewSkill(await app.vault.read(f));
    if (!skill) log.warn(`需求审核 SKILL 章节提取失败（无审核相关章节）：${p}（跳过内容审核）`);
    return skill;
  } catch (e) {
    log.warn(`需求审核 SKILL 解析失败：${p}（${(e as Error).message}，跳过内容审核）`);
    return null;
  }
}
