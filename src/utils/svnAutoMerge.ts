/**
 * SVN 冲突的安全自动合并（结构感知三方合并）—— 纯函数，无 obsidian / 无 svn 依赖，可离线单测
 *
 * 设计前提（见《ZF03 冲突分析》§四 的目标结构）：
 * - 解决冲突**不是**「整文件选边」：`--accept mine-full/theirs-full/base` 会静默丢内容
 *   （本次事故里 `.mine` 是新格式记录、`.theirs` 是旧模板 + 项目准入段，选任何一边都错）；
 * - 这套文档是高度结构化的：frontmatter 是键值、正文是固定的 `## xxx邮件` 小节序列 ——
 *   于是把冲突判定放到**键 / 小节**这一粒度上，既能保住内容，又能给出明确取舍。
 *
 * 安全规则（fail-closed）：
 * - 每个单元（frontmatter 键 / 正文小节）做三态判定：两侧一致 → 取之；仅一侧改动 → 取改动侧；
 *   **两侧都改且不一致 → 拒绝自动合并**（交由人工），并在 conflicts 里列出具体单元；
 * - 合并结果若仍含冲突标记 → 拒绝（安全网）；
 * - 本地「缺失」某单元时保守保留仓库侧（缺失更可能是冲突标记解析产物，而非用户真删除）。
 */

// 冲突标记判据统一真源（与冲突守卫、回写护栏共用）
import { CONFLICT_MARKER_RE } from "./svnConflictText";

/** 换行归一（CRLF / 裸 CR → LF；插件既有写盘风格即 LF） */
export function normalizeEol(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** 单元内容归一：去行尾空白 + 去末尾空行（不 trim 行首，Markdown 缩进有意义） */
function normalizeUnit(s: string): string {
  return normalizeEol(s)
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/** frontmatter 块（含定界行）；无则 null */
const FM_RE = /^\uFEFF?---\n([\s\S]*?)\n---(?:\n|$)/;

export interface AutoMergeResult {
  ok: boolean;
  /** 合并结果（ok=true 时给出；永不含冲突标记） */
  merged?: string;
  /** 人类可读的取舍说明（逐单元） */
  decisions: string[];
  /** 需要人工决定的单元/键（ok=false 时非空） */
  conflicts: string[];
}

/**
 * 从含冲突标记的工作文件还原「本地侧 / 仓库侧」两版内容（不含标记行）
 *
 * 兼容两种真实形态：
 * - 标准形态：标记独占一行（`<<<<<<< .mine` / `=======` / `>>>>>>> .r123`）
 * - **粘连形态**：标记与内容挤在同一行（本次事故即是：`<<<<<<< .mine邮件发送时间：2026-09-28 17:00`）
 *   → 剥离标记（含 `.mine` / `.theirs` / `.r<rev>` 等后缀）后，**剩余内容保留在该侧**
 */
export function splitConflictVersions(working: string): { mine: string; theirs: string; blocks: number } {
  const lines = normalizeEol(working).split("\n");
  const mine: string[] = [];
  const theirs: string[] = [];
  let blocks = 0;
  let mode: "normal" | "mine" | "base" | "theirs" = "normal";
  for (const line of lines) {
    if (/^<{7}/.test(line)) {
      blocks++;
      mode = "mine";
      const rest = stripMarker(line);
      if (rest !== "") mine.push(rest);
      continue;
    }
    if (/^\|{7}/.test(line) && mode === "mine") {
      mode = "base"; // diff3 风格的 base 段：base 另有来源（svn cat -r BASE），此处丢弃
      continue;
    }
    if (/^={7}/.test(line) && (mode === "mine" || mode === "base")) {
      mode = "theirs";
      const rest = stripMarker(line);
      if (rest !== "") theirs.push(rest);
      continue;
    }
    if (/^>{7}/.test(line) && mode === "theirs") {
      mode = "normal";
      const rest = stripMarker(line);
      if (rest !== "") theirs.push(rest);
      continue;
    }
    if (mode === "normal") {
      mine.push(line);
      theirs.push(line);
    } else if (mode === "mine") {
      mine.push(line);
    } else if (mode === "theirs") {
      theirs.push(line);
    }
    // mode === "base"：丢弃
  }
  return { mine: mine.join("\n"), theirs: theirs.join("\n"), blocks };
}

/** 冲突标记行前缀（含可选后缀 token，如 `.mine` / `.theirs` / `.r123`）；仅用于标记行 */
const MARKER_PREFIX_RE = /^(?:<{7}|={7}|>{7}|\|{7})\s*(?:\.mine|\.theirs|\.working|\.r\d+|\.merge-(?:left|right)(?:\.\d+)?)?/;

/** 剥掉行首冲突标记（含后缀）后的剩余内容 */
function stripMarker(line: string): string {
  const m = MARKER_PREFIX_RE.exec(line);
  return m ? line.slice(m[0].length) : line;
}

/** 切出 frontmatter 块内文本与正文 */
function splitFm(text: string): { fm: string | null; body: string } {
  const m = FM_RE.exec(text);
  if (!m) return { fm: null, body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

/** frontmatter → 键单元（键行 + 其缩进续行）；保持原文本，便于未改动的键原样还原 */
function splitFmKeys(fm: string): { id: string; content: string }[] {
  const out: { id: string; content: string }[] = [];
  let cur: { id: string; content: string } | null = null;
  for (const line of normalizeEol(fm).split("\n")) {
    const m = /^([^\s:#][^:]*):/.exec(line);
    if (m) {
      cur = { id: m[1].trim(), content: line };
      out.push(cur);
    } else if (cur) {
      cur.content += "\n" + line;
    }
    // 首个键之前的杂行（罕见）：忽略
  }
  return out.map((e) => ({ id: e.id, content: normalizeUnit(e.content) }));
}

/** 正文 → 小节单元（`## ` 标题为单位；标题之前为 __prelude__） */
function splitSections(body: string): { id: string; content: string }[] {
  const out: { id: string; content: string }[] = [];
  let cur = { id: "__prelude__", content: "" };
  let started = false;
  for (const line of normalizeEol(body).split("\n")) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (started) out.push({ id: cur.id, content: normalizeUnit(cur.content) });
      cur = { id: `## ${m[1].trim()}`, content: line };
      started = true;
    } else {
      cur.content += (cur.content ? "\n" : "") + line;
    }
  }
  out.push({ id: cur.id, content: normalizeUnit(cur.content) });
  return out.filter((u) => u.id !== "__prelude__" || u.content !== "");
}

/** 单元三态判定（安全规则见文件头注释） */
function pickUnit(
  base: string | null,
  mine: string | null,
  theirs: string | null
): { value: string | null; conflict: boolean; how: string } {
  if (mine === theirs) return { value: mine, conflict: false, how: "两侧一致" };
  // 本地缺失：更可能是冲突标记解析产物而非真删除 → 保守保留仓库侧
  if (mine === null) {
    if (base === null) return { value: theirs, conflict: false, how: "仓库侧新增" };
    if (theirs === base) return { value: theirs, conflict: false, how: "本地缺失（按解析产物处理）→ 保留原单元" };
    return { value: null, conflict: true, how: "本地缺失 vs 仓库侧改动" };
  }
  // 仓库侧缺失
  if (theirs === null) {
    if (base === null) return { value: mine, conflict: false, how: "本地侧新增" };
    if (mine === base) return { value: mine, conflict: false, how: "仓库缺失（按解析产物处理）→ 保留原单元" };
    return { value: null, conflict: true, how: "仓库缺失 vs 本地侧改动" };
  }
  if (mine === base) return { value: theirs, conflict: false, how: "仅仓库侧改动 → 取仓库" };
  if (theirs === base) return { value: mine, conflict: false, how: "仅本地侧改动 → 取本地" };
  return { value: null, conflict: true, how: "两侧均改动且不一致" };
}

/** 单元顺序：以 base 顺序为骨架，本地/仓库侧新增单元插到其前驱之后 */
function mergeOrder(baseIds: string[], mineIds: string[], theirsIds: string[]): string[] {
  const order: string[] = [];
  const push = (id: string): void => {
    if (!order.includes(id)) order.push(id);
  };
  baseIds.forEach(push);
  const insertNew = (ids: string[]): void => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (order.includes(id)) continue;
      let anchor = -1;
      for (let j = i - 1; j >= 0; j--) {
        const k = order.indexOf(ids[j]);
        if (k >= 0) {
          anchor = k;
          break;
        }
      }
      if (anchor >= 0) order.splice(anchor + 1, 0, id);
      else order.unshift(id);
    }
  };
  insertNew(mineIds);
  insertNew(theirsIds);
  return order;
}

/** 逐单元三态合并（返回单元映射、顺序与冲突/取舍记录） */
function mergeUnits(
  baseUnits: { id: string; content: string }[],
  mineUnits: { id: string; content: string }[],
  theirsUnits: { id: string; content: string }[],
  label: string
): { text: string | null; decisions: string[]; conflicts: string[] } {
  const baseMap = new Map(baseUnits.map((u) => [u.id, u.content]));
  const mineMap = new Map(mineUnits.map((u) => [u.id, u.content]));
  const theirsMap = new Map(theirsUnits.map((u) => [u.id, u.content]));
  const order = mergeOrder(baseUnits.map((u) => u.id), mineUnits.map((u) => u.id), theirsUnits.map((u) => u.id));

  const decisions: string[] = [];
  const conflicts: string[] = [];
  const parts: string[] = [];
  for (const id of order) {
    const picked = pickUnit(
      baseMap.has(id) ? (baseMap.get(id) as string) : null,
      mineMap.has(id) ? (mineMap.get(id) as string) : null,
      theirsMap.has(id) ? (theirsMap.get(id) as string) : null
    );
    if (picked.conflict) {
      conflicts.push(`${label}「${id}」：${picked.how}`);
      continue;
    }
    if (picked.value === null || picked.value === "") continue;
    parts.push(picked.value);
    if (picked.how !== "两侧一致") decisions.push(`${label}「${id}」：${picked.how}`);
  }
  return { text: parts.join("\n"), decisions, conflicts };
}

/**
 * 三方结构合并（frontmatter 按键 + 正文按 `## ` 小节）
 * @param baseText `svn cat -r BASE` 或冲突残留 `.r<OLDREV>`
 * @param mineText 工作文件「本地侧」（可由 splitConflictVersions 还原）
 * @param theirsText 工作文件「仓库侧」（或 `svn cat -r HEAD`）
 */
export function autoMergeThreeWay(baseText: string, mineText: string, theirsText: string): AutoMergeResult {
  const baseFm = splitFm(normalizeEol(baseText));
  const mineFm = splitFm(normalizeEol(mineText));
  const theirsFm = splitFm(normalizeEol(theirsText));

  const decisions: string[] = [];

  // ① frontmatter：存在性不一致 → 拒绝自动（结构不明，交人工）
  const fmPresence = [baseFm.fm !== null, mineFm.fm !== null, theirsFm.fm !== null];
  const fmCount = fmPresence.filter(Boolean).length;
  if (fmCount !== 0 && fmCount !== 3) {
    return { ok: false, decisions, conflicts: ["frontmatter 结构不一致（有的版本有、有的没有）→ 需人工"] };
  }

  let fmText: string | null = null;
  if (fmCount === 3) {
    const fmMerge = mergeUnits(
      splitFmKeys(baseFm.fm as string),
      splitFmKeys(mineFm.fm as string),
      splitFmKeys(theirsFm.fm as string),
      "字段"
    );
    if (fmMerge.conflicts.length > 0) return { ok: false, decisions: fmMerge.decisions, conflicts: fmMerge.conflicts };
    fmText = fmMerge.text;
    decisions.push(...fmMerge.decisions);
  }

  // ② 正文小节
  const bodyMerge = mergeUnits(
    splitSections(baseFm.body),
    splitSections(mineFm.body),
    splitSections(theirsFm.body),
    "小节"
  );
  if (bodyMerge.conflicts.length > 0) {
    return { ok: false, decisions: [...decisions, ...bodyMerge.decisions], conflicts: bodyMerge.conflicts };
  }
  decisions.push(...bodyMerge.decisions);

  const body = bodyMerge.text ?? "";
  const merged = fmText === null ? body : `---\n${fmText}\n---\n${body}`;

  // ③ 安全网：结果仍含冲突标记 → 拒绝（绝不让标记流回版本库）
  if (normalizeEol(merged).split("\n").some((l) => CONFLICT_MARKER_RE.test(l))) {
    return { ok: false, decisions, conflicts: ["合并结果仍含冲突标记 → 拒绝自动合并"] };
  }
  return { ok: true, merged, decisions, conflicts: [] };
}
