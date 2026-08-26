/**
 * 文件选择弹窗（FuzzySuggestModal）：列出仓库全部 Markdown 文件，供「通讯录名单路径」等设置项选择。
 */
import { App, FuzzySuggestModal, TFile } from "obsidian";

export class FilePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (path: string) => void) {
    super(app);
    this.setPlaceholder("输入关键词过滤，或浏览仓库文件…");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "确认" },
      { command: "esc", purpose: "取消" },
    ]);
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => f.extension === "md");
  }

  getItemText(f: TFile): string {
    return f.path;
  }

  onChooseItem(f: TFile): void {
    this.onPick(f.path);
  }
}
