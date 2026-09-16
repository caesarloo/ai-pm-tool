/**
 * 文件选择弹窗（FuzzySuggestModal）：枚举 Markdown 文件，供「通讯录名单路径」「需求笔记模板路径」等设置项选择。
 * - 有目录上下文（baseDir 非空）：只递归列出该目录内的文件（Obsidian 审核合规：不走 vault.getFiles() 全库枚举）
 * - 无目录上下文（baseDir 为空，如设置项尚未填写、模板目录也未配置）：回退整个仓库的 Markdown 文件，
 *   保证文件路径留空时选择器仍能匹配到文件（此前返回空列表 → 无法选择任何文件）
 */
import { App, FuzzySuggestModal, TFile } from "obsidian";
import { listMarkdownFiles } from "../utils/vaultFs";

export class FilePickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[] = [];
  private readonly ready: Promise<TFile[]>;

  constructor(app: App, private onPick: (path: string) => void, baseDir: string) {
    super(app);
    this.setPlaceholder(
      baseDir.trim()
        ? "输入关键词过滤，或浏览目录文件…"
        : "输入关键词过滤，或浏览仓库全部 Markdown 文件…"
    );
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "确认" },
      { command: "esc", purpose: "取消" },
    ]);
    this.ready = this.loadFiles(baseDir);
  }

  /** baseDir 非空：枚举该目录树；为空：枚举整个仓库（见 listMarkdownFiles）；读取不到 → 空列表 */
  private async loadFiles(baseDir: string): Promise<TFile[]> {
    const paths = await listMarkdownFiles(this.app, baseDir);
    return paths
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile)
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
