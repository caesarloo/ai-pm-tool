/**
 * 需求笔记正文「邮件发送记录」小节的回写（§4.6）
 * - 纯字符串逻辑（不依赖 obsidian），与 notes/parser.ts、notes/contacts.ts 同层，便于冒烟测试
 * - 回写内容里的表格必须能在 Obsidian 中正常渲染：Markdown 要求表格前留一个空行，
 *   否则整段会退化成普通文本行（邮件正文带表格时最常见，如审核结论表）
 * - 邮件正文以 Obsidian 引用块（`> ` 前缀）存档：正文与元信息（时间/收件人/主题）在视觉上分层，
 *   引用块内的表格同样要求前置空行，故先补空行再逐行加前缀（见 toObsidianQuote）
 */

/** 表格行判定：形如 `| a | b |`（首尾竖线，至少两列；分隔行 `| --- | --- |` 同样命中） */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

/**
 * 表格前补空行（Markdown 硬性要求，否则 Obsidian 不渲染表格）：
 * - 只在一段「连续表格行」的首行前补，块内不插空行
 * - 跳过 ``` / ~~~ 围栏代码块内部（那里的 `|` 不是表格）
 * - 上文已是空行或本身就是表格行时不重复补；文本开头无须补
 */
export function ensureBlankLineBeforeTables(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let fence = ""; // 打开的围栏标记（``` 或 ~~~），空字符串 = 不在代码块内
  for (const line of lines) {
    const m = /^(```|~~~)/.exec(line.trim());
    if (m) {
      if (fence === "") fence = m[1];
      else if (line.trim().startsWith(fence)) fence = "";
      out.push(line);
      continue;
    }
    if (fence === "" && isTableRow(line)) {
      const prev = out.length > 0 ? out[out.length - 1] : undefined;
      if (prev !== undefined && prev.trim() !== "" && !isTableRow(prev)) out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * 邮件正文 → Obsidian 引用块（`> ` 前缀），供回写留痕使用（§4.6）：
 * - 空行写成 `>`（不带尾空格）：维持引用块连续，否则会被空行截断成多个引用块
 * - 引用块内的表格同样要求前置空行（Obsidian 不渲染紧贴文字的表格），故**先补空行再逐行加前缀**；
 *   补出的空行随即变成 `>`，即引用块内的前置空行；正文首行即表格时额外在块首补一个 `>` 空行
 * - 返回带首尾空行的块：与元信息行（时间/收件人/主题）、附件行隔开，避免引用块边界产生解析歧义
 * - 正文为空（或全空白）时返回空字符串：不产出空的引用条
 */
export function toObsidianQuote(text: string): string {
  // 先归一换行（裸 \r 不被 ensureBlankLineBeforeTables 的 split 处理），再去掉尾部空行
  const normalized = ensureBlankLineBeforeTables(text.replace(/\r\n?/g, "\n").trimEnd());
  if (normalized.trim() === "") return "";
  const lines = normalized.split("\n");
  if (isTableRow(lines[0])) lines.unshift(""); // 引用块首行即表格 → 也要有前置空引用行
  const quoted = lines.map((l) => (l.trim() === "" ? ">" : `> ${l}`)).join("\n");
  return `\n${quoted}\n`;
}

/**
 * 将邮件发送记录写入需求笔记正文（替换或新增）：
 * - 已存在对应小节（## <label>邮件 / ## <label>（邮件发送记录），label 尾部「（…）」忽略）→ 替换该小节内容（标题行保留）
 * - 无对应小节 → 文末新增「## <label>邮件」小节
 * - 记录正文内表格之前留空行（Markdown 表格渲染要求；正文首行即表格时，标题行之后同样留空行）
 * @returns replaced=true 表示替换了原有小节（用于变更预览「已有发送记录」）
 */
export function upsertMailRecord(content: string, nodeLabel: string, body: string): { content: string; replaced: boolean } {
  const lines = content.split(/\r?\n/);
  const baseLabel = nodeLabel.replace(/（[^）]*）$/, ""); // 项目准入（开发准入）→ 项目准入
  const record = ensureBlankLineBeforeTables(body.trimEnd());
  const titleVariants = [
    `## ${nodeLabel}邮件`,
    `## ${nodeLabel}（邮件发送记录）`,
    `## ${baseLabel}邮件`,
    `## ${baseLabel}（邮件发送记录）`,
  ];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (titleVariants.includes(t)) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    // 无对应小节 → 文末新增（标题用 <label>邮件，与模板小节命名一致）
    const block = `\n${ensureBlankLineBeforeTables(`## ${baseLabel}邮件\n${record}`)}\n`;
    return { content: content.trimEnd() + block, replaced: false };
  }
  // 替换小节内容：保留标题行，范围到下一个「邮件记录小节标题」（## <label>邮件 类，避免被记录正文内的 ## 正文标题截断，发布审核 P1-5）或文末
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##\s+.+邮件/.test(t) && (i === start + 1 || lines[i - 1].trim() === "")) {
      end = i;
      break;
    }
  }
  const section = ensureBlankLineBeforeTables(`${lines[start].trimEnd()}\n${record}`);
  // 被替换区间末尾原本是「下一小节前的空行」时补回：否则小节之间失去空行，
  // 下轮替换的边界判定（下一小节标题前须空行）失效，会把后续小节连同正文一起吞掉
  const tail: string[] = end < lines.length && lines[end - 1].trim() === "" ? [""] : [];
  lines.splice(start, end - start, ...section.split("\n"), ...tail);
  return { content: lines.join("\n"), replaced: true };
}
