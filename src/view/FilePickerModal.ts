/**
 * 文件选择弹窗（FuzzySuggestModal）：仅枚举指定目录下的 Markdown 文件，供「通讯录名单路径」等设置项选择。
 * Obsidian 审核合规：不走 vault.getFiles() 全库枚举，只递归列出 baseDir（目录上下文）内的文件；
 * baseDir 为空（未配置任何目录上下文）时列表为空，提示用户直接在上方输入 vault 路径。
 */
import { App, FuzzySuggestModal, TFile } from "obsidian";
import { listFilesRecursive } from "../utils/vaultFs";

export class FilePickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[] = [];
  private readonly ready: Promise<TFile[]>;

  constructor(app: App, private onPick: (path: string) => void, baseDir: string) {
    super(app);
    this.setPlaceholder(
      baseDir.trim()
        ? "输入关键词过滤，或浏览目录文件…"
        : "未配置目录上下文：请直接在上方输入 vault 路径（如 产品需求模板/通讯录名单.md）"
    );
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "确认" },
      { command: "esc", purpose: "取消" },
    ]);
    this.ready = this.loadFiles(baseDir);
  }

  /** 仅枚举 baseDir 目录树下的 Markdown 文件；目录为空/不存在/不可读 → 空列表 */
  private async loadFiles(baseDir: string): Promise<TFile[]> {
    const prefix = baseDir.trim().replace(/^\/+|\/+$/g, "");
    if (!prefix) return [];
    const paths = await listFilesRecursive(this.app, prefix);
    return paths
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md")
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async onOpen(): Promise<void> {
    this.files = await this.ready;
    await super.onOpen();
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(f: TFile): string {
    return f.path;
  }

  onChooseItem(f: TFile): void {
    this.onPick(f.path);
  }
}
