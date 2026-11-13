/**
 * 正文图片引用 → 邮件内嵌图（按 Obsidian 的图片引用语义）
 *
 * 背景（2026-11 缺陷修复）：邮件正文编辑框是 contenteditable 的 Markdown 预览，
 * 直接把图片粘进正文无法进入 `draft.body`（预览 DOM→Markdown 的转换器只处理文本类元素），
 * 结果是邮件里永远没有图、且全程不报错。0.3.0 起改用 Obsidian 原生做法：
 * - 粘贴/拖入图片 → 存进 vault（Obsidian 附件目录）→ 正文插入 `![[附件/xxx.png]]` 引用（见 MailModal）
 * - 发送时本模块解析这些引用 → 从 vault 读二进制 → 生成 Content-ID → 正文替换为占位 token，
 *   由 smtp 组装 multipart/related 把图片内嵌进邮件正文（不是附件）
 *
 * 可内嵌：`![[path]]`（支持 vault 相对/绝对路径、`|别名` 与 `#锚点`）与 `![](vault 相对路径)`
 * 不内嵌（原样保留、计入 skipped）：外链（http/https/data/app/file/obsidian）、非图片扩展名、找不到的文件
 */
import type { App, TFile } from "obsidian";
import type { InlineMailImage } from "../types";

/** 允许内嵌的图片扩展名 → MIME */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export interface CollectInlineResult {
  /** 已把可内嵌引用替换为 token 的正文（发送用） */
  body: string;
  /** 内嵌图片（含 token / cid / 二进制） */
  images: InlineMailImage[];
  /** 未能内嵌的引用原文（外链 / 非图片 / 文件不存在），发送时提示用 */
  skipped: string[];
}

/** 扩展名 → 图片 MIME；非图片返回 null */
export function imageMimeByPath(path: string): string | null {
  const clean = path.split("?")[0].split("#")[0];
  const ext = (clean.split(".").pop() ?? "").toLowerCase();
  return IMAGE_MIME[ext] ?? null;
}

/** 去掉 Markdown 图片目标的尖括号 / 标题 / URL 编码；外链返回 null（不内嵌） */
export function normalizeImageTarget(raw: string): string | null {
  let t = raw.trim();
  if (t.startsWith("<") && t.endsWith(">")) t = t.slice(1, -1).trim();
  t = t.replace(/\s+["'][^"']*["']\s*$/, "").trim(); // ![alt](path "title")
  if (!t) return null;
  if (/^(https?:|data:|app:|file:|obsidian:|mailto:)/i.test(t)) return null;
  try {
    t = decodeURIComponent(t);
  } catch {
    /* 非法百分号编码：保持原样 */
  }
  return t.replace(/^\/+/, ""); // 以 / 开头按 vault 根处理
}

/** 判定是否 vault 内文件（鸭子类型，避免运行时依赖 obsidian 模块） */
function asVaultFile(app: App, target: string, sourcePath: string): TFile | null {
  const isFile = (f: unknown): f is TFile => {
    const o = f as { path?: unknown; extension?: unknown } | null;
    return !!o && typeof o.path === "string" && typeof o.extension === "string";
  };
  const direct = app.vault.getAbstractFileByPath(target);
  if (isFile(direct)) return direct;
  // Obsidian 链接解析（最短路径 / 同名笔记）
  const link = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  if (isFile(link)) return link;
  // `./`、`../` 相对当前笔记目录的写法（Obsidian 的 getFirstLinkpathDest 也能解析，这里兜底）
  if (target.startsWith("./") || target.startsWith("../")) {
    const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    const stack: string[] = [];
    for (const p of (dir ? `${dir}/${target}` : target).split("/")) {
      if (!p || p === ".") continue;
      if (p === "..") stack.pop();
      else stack.push(p);
    }
    const rel = app.vault.getAbstractFileByPath(stack.join("/"));
    if (isFile(rel)) return rel;
  }
  return null;
}

/** `![[附件/xxx.png]]` / `![[xxx.png|别名]]` / `![[xxx.png#锚点]]` */
const WIKI_IMG_RE = /!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
/** `![alt](path)` / `![alt](<path>)` */
const MD_IMG_RE = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;

/**
 * 解析正文里的图片引用：可内嵌的替换为 token 并读出二进制；其余原样保留并记入 skipped。
 * 同一张图被多次引用时复用同一个 token / Content-ID（不重复内嵌字节）。
 */
export async function collectInlineImages(app: App, body: string, sourcePath: string): Promise<CollectInlineResult> {
  const images: InlineMailImage[] = [];
  const skipped: string[] = [];
  const cache = new Map<string, { token: string; cid: string }>();
  let seq = 0;
  const nextToken = (): string => {
    let t = `@@AI_PM_IMG_${seq++}@@`;
    while (body.includes(t)) t = `@@AI_PM_IMG_${seq++}@@`;
    return t;
  };
  const makeCid = (): string => `ai-pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@ai-pm-tool`;

  /** 处理单个引用：返回替换文本（token），不可内嵌返回 null */
  const handle = async (rawTarget: string, source: string): Promise<string | null> => {
    const target = normalizeImageTarget(rawTarget);
    const mime = target ? imageMimeByPath(target) : null;
    if (!target || !mime) {
      skipped.push(source);
      return null;
    }
    const file = asVaultFile(app, target, sourcePath);
    if (!file) {
      skipped.push(source);
      return null;
    }
    const hit = cache.get(file.path);
    if (hit) return hit.token;
    try {
      const data = await app.vault.readBinary(file);
      const token = nextToken();
      const cid = makeCid();
      images.push({ token, cid, filename: file.name, mime, data });
      cache.set(file.path, { token, cid });
      return token;
    } catch {
      // 读取失败（文件被删/无权限）：保留原引用文本，不阻塞发信
      skipped.push(source);
      return null;
    }
  };

  // 收集两类引用的位置（wikilink 与标准 markdown 语法互不重叠）
  const hits: { index: number; length: number; source: string; target: string }[] = [];
  for (const m of body.matchAll(WIKI_IMG_RE)) {
    if (m.index !== undefined) hits.push({ index: m.index, length: m[0].length, source: m[0], target: m[1] });
  }
  for (const m of body.matchAll(MD_IMG_RE)) {
    if (m.index !== undefined) hits.push({ index: m.index, length: m[0].length, source: m[0], target: m[1] });
  }
  hits.sort((a, b) => a.index - b.index);

  let out = "";
  let cursor = 0;
  for (const h of hits) {
    if (h.index < cursor) continue; // 重叠命中（防御）
    out += body.slice(cursor, h.index);
    const replaced = await handle(h.target, h.source);
    out += replaced ?? h.source;
    cursor = h.index + h.length;
  }
  out += body.slice(cursor);
  return { body: out, images, skipped };
}
