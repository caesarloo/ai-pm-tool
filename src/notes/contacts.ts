/**
 * 通讯录名单解析（§4.6 收件人来源）
 * - 文件：设置项「通讯录名单路径」唯一指定（vault 相对路径）；
 *   留空 = 不加载通讯录（收件人按姓名匹配通讯录，未匹配时原样保留并在发送前提示补充邮箱）
 * - 「全体名单/收件人名单」表（姓名/邮箱）→ 姓名 → 邮箱；
 *   「公共邮箱/抄送邮箱」表（名称/邮箱）→ 部门邮件组公共邮箱（默认抄送）
 * - 邮箱列：取表格行中首个含 @ 的单元格——新格式两列「姓名|邮箱」即第二列；
 *   兼容旧版三列「姓名|工号|邮箱」：忽略工号列（不再按工号推导邮箱），无邮箱的行自动跳过
 */
import { App, TFile } from "obsidian";
import { log } from "../utils/logger";

/** 通讯录：姓名 → 邮箱 索引 + 公共邮箱列表 */
export interface ContactBook {
  byName: Map<string, string>; // 姓名 -> 邮箱
  byEmail: Map<string, string>; // 邮箱 -> 姓名（收件人「名称（邮箱）」展示反查）
  groupNames: Map<string, string>; // 公共邮箱 -> 名称（部门邮件组，展示用）
  groups: string[]; // 公共邮箱（部门邮件组），按出现顺序去重
}

export function emptyContactBook(): ContactBook {
  return { byName: new Map(), byEmail: new Map(), groupNames: new Map(), groups: [] };
}

/** 解析通讯录 Markdown：按小节识别表格；「公共邮箱」小节为 名称|邮箱，其余为 姓名|邮箱（兼容 姓名|工号|邮箱） */
export function parseContactBook(text: string): ContactBook {
  const book = emptyContactBook();
  let heading = "";
  const addGroup = (email: string): void => {
    const e = email.trim();
    if (e && !book.groups.includes(e)) book.groups.push(e);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,6}\s+/.test(line)) {
      heading = line.replace(/^#{1,6}\s+/, "");
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
    if (cells.length < 2) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 分隔行
    if (cells.some((c) => /^(姓名|工号|名称|邮箱|序号)$/.test(c))) continue; // 表头
    if (/公共邮箱|抄送/.test(heading)) {
      // 「公共邮箱」/「抄送邮箱」小节：名称|邮箱 表（部门邮件组 → 默认抄送）
      const gName = cells[0]?.trim() ?? "";
      const gEmail = cells[1]?.trim() ?? "";
      addGroup(gEmail);
      if (gEmail && gName && gName !== "待补充") book.groupNames.set(gEmail, gName);
      continue;
    }
    const name = cells[0]?.trim() ?? "";
    // 邮箱列：首个含 @ 的单元格（两列即第二列；旧三列忽略工号列，不再按工号推导邮箱）
    const email = cells.slice(1).find((c) => c.includes("@"))?.trim() ?? "";
    if (email && name && name !== "待补充") {
      book.byName.set(name, email);
      book.byEmail.set(email, name);
    }
  }
  return book;
}

/**
 * 收件人展示格式：通讯录可反查名称时输出「名称（邮箱）」（个人取 byEmail、公共邮箱取 groupNames）；
 * 无法反查（手动添加的陌生邮箱/中文姓名占位）时原样返回。
 */
export function formatRecipient(email: string, book: ContactBook | null | undefined): string {
  const e = (email ?? "").trim();
  if (!e) return email ?? "";
  const name = book?.byEmail.get(e) ?? book?.groupNames.get(e) ?? "";
  if (!name) return e;
  return `${name}（${e}）`;
}

/**
 * 将「姓名 → 邮箱」追加到通讯录「全体名单」表。
 * - 只追加到「公共邮箱」小节之前出现的表格（全体名单）；
 * - 新格式表（姓名|邮箱）追加两列行；旧三列表（姓名|工号|邮箱）追加「姓名|待补充|邮箱」保持列对齐；
 * - 找不到表格（无表可追加）时原样返回，由调用方决定是否落盘。
 */
export function appendContactToBook(text: string, name: string, email: string): string {
  const lines = text.split(/\r?\n/);
  let heading = "";
  let lastTableLine = -1;
  let lastHeaderLine = -1; // 最近的表头行（用于判断列格式）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,6}\s+/.test(line)) {
      heading = line.replace(/^#{1,6}\s+/, "");
      continue;
    }
    if (/公共邮箱|抄送/.test(heading)) break; // 已进入「公共邮箱/抄送邮箱」小节：只追加到「全体名单/收件人名单」
    if (line.startsWith("|")) {
      lastTableLine = i;
      if (line.split("|").some((c) => /^(姓名|工号|名称|邮箱|序号)$/.test(c.trim()))) lastHeaderLine = i;
    }
  }
  if (lastTableLine === -1) return text; // 无表可追加
  const hasIdCol = lastHeaderLine >= 0 && /工号/.test(lines[lastHeaderLine]);
  lines.splice(
    lastTableLine + 1,
    0,
    hasIdCol ? `| ${name.trim()} | 待补充 | ${email.trim()} |` : `| ${name.trim()} | ${email.trim()} |`
  );
  return lines.join("\n");
}

/**
 * 从仓库读取通讯录名单（仅当设置项「通讯录名单路径」非空）：
 * - 留空：不加载通讯录，返回空通讯录（收件人按姓名匹配通讯录，未匹配原样保留）；
 * - 非空：读取该 vault 相对路径，找不到/解析失败返回空通讯录（不自动回退其他位置）。
 */
export async function loadContactBook(app: App, explicitPath?: string): Promise<ContactBook> {
  const p = explicitPath?.trim();
  if (!p) {
    log.debug("通讯录名单路径未配置，跳过通讯录载入（收件人按姓名匹配）");
    return emptyContactBook();
  }
  const f = app.vault.getAbstractFileByPath(p);
  if (f instanceof TFile) {
    try {
      const book = parseContactBook(await app.vault.read(f));
      log.debug(`通讯录已载入：${p}（个人 ${book.byName.size} · 公共邮箱 ${book.groups.length}）`);
      return book;
    } catch (e) {
      log.warn(`通讯录解析失败：${p}（${(e as Error).message}）`);
    }
  } else {
    log.warn(`通讯录名单未找到：${p}（收件人按姓名匹配，未匹配原样保留）`);
  }
  return emptyContactBook();
}
