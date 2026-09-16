/**
 * 目录级文件枚举（Obsidian 审核合规：避免 vault.getFiles() 全库枚举）+ 全仓 Markdown 枚举入口
 * - listFilesRecursive：仅递归列出指定目录下的文件路径，目录不存在/不可读时返回空数组（不抛错）
 * - listVaultMarkdownFiles：设置页「选择文件…」的**唯一**枚举入口，不限目录——整个仓库的 Markdown 都能搜到
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

/**
 * 整个仓库的 Markdown 文件（同步、无磁盘 IO：遍历 vault 内存索引树）
 * 设置项的文件选择器不限制目录——模板/通讯录/规则文件可能放在任意目录，用户要能全库搜。
 */
export function listVaultMarkdownFiles(app: App): TFile[] {
  const out: TFile[] = [];
  const walk = (folder: TFolder): void => {
    for (const child of folder.children) {
      if (child instanceof TFile) {
        if (child.path.toLowerCase().endsWith(".md")) out.push(child);
      } else if (child instanceof TFolder) {
        walk(child);
      }
    }
  };
  walk(app.vault.getRoot());
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
