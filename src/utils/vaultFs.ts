/**
 * 目录级文件枚举（Obsidian 审核合规：避免 vault.getFiles() 全库枚举）
 * - 仅递归列出指定目录下的文件路径，配合 getAbstractFileByPath 取 TFile，绝不触碰目录外文件
 * - 目录不存在/不可读时返回空数组（不抛错，调用方按「无文件」处理）
 * - 目录留空由 listMarkdownFiles 兜底整个仓库（无目录上下文时文件选择器仍要能匹配文件）
 */
import { App, TFile, TFolder } from "obsidian";

export async function listFilesRecursive(app: App, dir: string): Promise<string[]> {
  const prefix = dir.replace(/^\/+|\/+$/g, "");
  if (!prefix) return [];
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    let listing: { files: string[]; folders: string[] };
    try {
      listing = await app.vault.adapter.list(d);
    } catch {
      return; // 目录不存在或不可读：按空处理
    }
    out.push(...listing.files);
    for (const sub of listing.folders) await walk(sub);
  };
  await walk(prefix);
  return out;
}

/** 整个仓库的文件路径（遍历 vault 索引树，无磁盘 IO）；仅供「无目录上下文」的文件选择器使用 */
export function listVaultFiles(app: App): string[] {
  const out: string[] = [];
  const walk = (folder: TFolder): void => {
    for (const child of folder.children) {
      if (child instanceof TFile) out.push(child.path);
      else if (child instanceof TFolder) walk(child);
    }
  };
  walk(app.vault.getRoot());
  return out;
}

/**
 * 枚举 Markdown 文件路径（升序排序）
 * - dir 非空：仅该目录树（目录级枚举，配合 getAbstractFileByPath 取 TFile）
 * - dir 为空：整个仓库——文件选择器在「无目录上下文」时的兜底（否则留空时选不到任何文件）
 */
export async function listMarkdownFiles(app: App, dir: string): Promise<string[]> {
  const prefix = dir.trim().replace(/^\/+|\/+$/g, "");
  const paths = prefix ? await listFilesRecursive(app, prefix) : listVaultFiles(app);
  return paths.filter((p) => p.toLowerCase().endsWith(".md")).sort((a, b) => a.localeCompare(b));
}
