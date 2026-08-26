/**
 * 目录选择弹窗（FuzzySuggestModal）：列出仓库全部文件夹，供「需求笔记目录」等设置项选择。
 * 选择根目录时回调空串（留空语义由调用方决定）。
 */
import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private onPick: (path: string) => void) {
    super(app);
    this.setPlaceholder("输入关键词过滤，或浏览仓库目录…");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "确认" },
      { command: "esc", purpose: "取消" },
    ]);
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const walk = (f: TFolder): void => {
      folders.push(f);
      for (const c of f.children) {
        if (c instanceof TFolder) walk(c);
      }
    };
    walk(this.app.vault.getRoot());
    return folders;
  }

  getItemText(f: TFolder): string {
    return f === this.app.vault.getRoot() ? "/（仓库根目录）" : f.path;
  }

  onChooseItem(f: TFolder): void {
    this.onPick(f === this.app.vault.getRoot() ? "" : f.path);
  }
}
