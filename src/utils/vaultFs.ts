/**
 * 目录级文件枚举（Obsidian 审核合规：避免 vault.getFiles() 全库枚举）
 * - 仅递归列出指定目录下的文件路径，配合 getAbstractFileByPath 取 TFile，绝不触碰目录外文件
 * - 目录不存在/不可读时返回空数组（不抛错，调用方按「无文件」处理）
 */
import { App } from "obsidian";

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
