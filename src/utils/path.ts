/**
 * 通用工具
 */
import { App, FileSystemAdapter } from "obsidian";

/** 仓库根目录绝对路径（仅桌面 FileSystemAdapter 支持；否则返回空串） */
export function vaultBasePath(app: App): string {
  const a = app.vault.adapter;
  return a instanceof FileSystemAdapter ? a.getBasePath() : "";
}
