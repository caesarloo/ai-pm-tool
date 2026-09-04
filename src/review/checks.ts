/**
 * 生成需求 · 规则校验（R，纯函数，不依赖 Obsidian DOM）
 * - 需求名称三段式：`[财务编码]-[业务需求分类]-[需求描述][标识]`（SKILL 场景1）
 * - 日期：YYYY-MM-DD 格式 + 评审 ≤ 开发投入 ≤ 计划上线 先后
 * - 需求编号：提交流程后回填（创建时留空为预期状态）
 * - 列表值 ∈ 允许列表（业务需求分类 55 项 / 成本承担方可选项）
 * - SKILL 缺失时（skill=null）名称/分类类校验跳过 → pass（调用方在 UI 顶部一次性提示「内容审核已跳过」）
 */
import { normText, type ReviewSkill } from "./skill";

export type VLevel = "pass" | "warn" | "fail";

export interface CheckResult {
  level: VLevel;
  msgs: string[]; // 意见行（就地展示；空 = 无说明）
}

export function passResult(msgs: string[] = []): CheckResult {
  return { level: "pass", msgs };
}
export function warnResult(msgs: string[]): CheckResult {
  return { level: "warn", msgs };
}
export function failResult(msgs: string[]): CheckResult {
  return { level: "fail", msgs };
}

/** 合并级别（fail > warn > pass） */
export function worstLevel(...levels: VLevel[]): VLevel {
  if (levels.includes("fail")) return "fail";
  if (levels.includes("warn")) return "warn";
  return "pass";
}

/** 需求描述段冗余词（去冗余，SKILL：如「实现」「开发」「功能」等） */
const REDUNDANT_WORDS = /实现|开发|功能|优化/;

/** 中文字数（含 ASCII 按字符计） */
function charLen(s: string): number {
  return s.length;
}

/**
 * 需求名称三段式校验（R）：
 * 首段 ∈ 财务编码映射（忽略大小写/空格/标点差异）→ 反推成本承担方；中段 ∈ 产品线/需求分类允许列表；
 * 描述段 4-15 字（宽容：规则常见 8-15，公司原例尾段可短，<4 或 >15 仅 ▲ 提示）；
 * 不足三段/映射不识别/分类不在列表 → fail
 */
export function checkRequirementName(name: string, skill: ReviewSkill | null): CheckResult {
  // SKILL 缺失或未解析出编码/分类数据 → 三段式校验不可用（调用方在 UI 顶部提示「内容审核已跳过」，不阻塞）
  if (!skill || (skill.codeByBearer.size === 0 && skill.bizCategories.length === 0)) {
    return passResult(["SKILL 未配置/未提供编码与分类数据：需求名称未做三段式校验"]);
  }
  const segs = name.split("-");
  if (segs.length < 3) {
    return failResult([
      `需求名称需为三段式：财务编码-业务需求分类-需求描述（如 AA01-示例分类一-示例需求描述一）`,
    ]);
  }
  const [code, cat, ...rest] = segs;
  const desc = rest.join("-");
  const msgs: string[] = [];
  let level: VLevel = "pass";

  // ① 首段财务编码：精确（忽略大小写）；仓库命名常用「编码+流水号」（如 AA01），回退最长前缀 + 纯数字尾匹配（AA01 → AA）
  if (skill.bearerByCode.size > 0) {
    const codes = [...skill.bearerByCode.keys()];
    const norm = normText(code);
    let matched = codes.find((c) => normText(c) === norm) ?? null;
    if (matched === null) {
      const cands = codes
        .filter((c) => {
          const n = normText(c);
          return n.length >= 2 && norm.startsWith(n) && /^\d*$/.test(norm.slice(n.length));
        })
        .sort((a, b) => normText(b).length - normText(a).length);
      if (cands.length > 0) matched = cands[0];
    }
    if (matched === null) {
      msgs.push(`首段「${code}」不在财务编码映射中（财务编码/需求归属对照以 SKILL 映射表为准）`);
      level = "fail";
    } else {
      const bearer = skill.bearerByCode.get(matched);
      msgs.push(`${code} → ${bearer ?? "（映射表）"}（财务编码映射 ✓）`);
    }
  } else {
    msgs.push(`${code}-${cat}（SKILL 未提供编码映射）`);
  }

  // ② 中段业务需求分类（允许列表）
  if (skill && skill.bizCategories.length > 0) {
    const normCat = normText(cat);
    const hit = skill.bizCategories.find((c) => normText(c) === normCat);
    if (!hit) {
      const samples = skill.bizCategories.slice(0, 3).join("/");
      msgs.push(`中段「${cat}」不在允许的产品线/需求分类列表内（列表含 ${skill.bizCategories.length} 项，如 ${samples}${skill.bizCategories.length > 3 ? "…" : ""}）`);
      level = "fail";
    } else {
      msgs.push(`「${cat}」 ∈ 允许列表 ✓`);
    }
  }

  // ③ 描述段长度（宽容区间 4-15 字：规则常见 8-15，公司原例尾段可短（如 4 字），R 只提示不硬卡）
  const len = charLen(desc);
  const hasRedundant = REDUNDANT_WORDS.test(desc);
  if (len < 4) {
    msgs.push(`描述「${desc}」${len} 字过短，建议补充核心业务/技术术语（4-15 字）`);
    level = worstLevel(level, "warn");
  } else if (len > 15) {
    msgs.push(`描述「${desc}」${len} 字超过 15 字，建议精简至 15 字以内（去除「实现/开发/功能」等冗余词）`);
    level = worstLevel(level, "warn");
  } else {
    msgs.push(`描述 ${len} 字 ∈ 4-15 ✓`);
    if (hasRedundant) {
      msgs.push(`描述含冗余词（实现/开发/功能/优化），建议精简`);
      level = worstLevel(level, "warn");
    }
  }
  if (level === "pass") {
    return passResult([`三段式校验通过：${msgs.join(" · ")}`]);
  }
  // fail/warn：附纠偏建议
  msgs.push(`建议命名：${segs[0]}-${segs[1]}-（8-15 字核心描述）`);
  return { level, msgs };
}

/** 日期字段校验（R）：YYYY-MM-DD 格式 + 评审 ≤ 开发投入 ≤ 计划上线 先后（非法/空值仅提示，人工补） */
export function checkDateField(
  key: string,
  value: string,
  others: Record<string, string | undefined>
): CheckResult {
  const msgs: string[] = [];
  let level: VLevel = "pass";
  const fmt = /^\d{4}-\d{2}-\d{2}$/;
  if (value && !fmt.test(value)) {
    msgs.push(`「${key}」格式应为 YYYY-MM-DD（当前：${value}）`);
    level = "fail";
  } else if (!value) {
    msgs.push(`「${key}」为空：可留空或手动补填日期`);
    level = "warn";
  }
  // 先后：需求评审 ≤ 开发投入 ≤ 计划上线（可比时才校验）
  const seq: { k: string; v: string | undefined }[] = [
    { k: "需求评审日期", v: others["需求评审日期"] },
    { k: "开发投入日期", v: others["开发投入日期"] },
    { k: "计划上线日期", v: others["计划上线日期"] },
  ];
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i];
    const b = seq[i + 1];
    if (!a.v || !b.v || !fmt.test(a.v) || !fmt.test(b.v)) continue;
    if (a.v > b.v) {
      msgs.push(`${a.k}（${a.v}）晚于 ${b.k}（${b.v}）：请确认日期先后`);
      level = worstLevel(level, "warn");
    }
  }
  return { level, msgs };
}

/** 需求编号字段（R）：创建阶段留空为预期状态（提交流程后回填）；填写后仅做格式提示 */
export function checkRequirementId(value: string): CheckResult {
  if (!value) {
    return warnResult(["需求编号留空为预期状态：提交流程后回填"]);
  }
  if (!/^[A-Za-z0-9-]+$/.test(value.trim())) {
    return warnResult(["需求编号建议为提交流程返回的编码（字母数字与 -）"]);
  }
  return passResult(["需求编号已填写（提交流程后人工回填确认）"]);
}

/** 列表值 ∈ 允许列表（业务分类 55 项 / 成本承担方可选项；逐项提示不在列表的值） */
export function checkValuesInList(key: string, values: string[], allowed: string[]): CheckResult {
  const bad = values.filter((v) => v && !allowed.some((a) => normText(a) === normText(v)));
  if (bad.length === 0) return passResult();
  const maxShow = bad.length > 3 ? bad.slice(0, 3).join("、") + ` 等 ${bad.length} 项` : bad.join("、");
  return warnResult([`「${key}」值「${maxShow}」不在允许列表内（建议核对；列表含 ${allowed.length} 项）`]);
}
