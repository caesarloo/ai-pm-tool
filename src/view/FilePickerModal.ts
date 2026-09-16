/**
 * 文件选择弹窗（FuzzySuggestModal）：枚举**整个仓库**的 Markdown 文件，
 * 供「通讯录名单路径」「需求笔记模板路径」「需求审核 SKILL 路径」「需求内容生成 SKILL 路径」等设置项选择。
 *
 * 不按目录限制候选范围（用户可能把模板/通讯录/规则文件放在任意目录）：
 * 候选 = 全库 Markdown，模糊匹配对象是完整路径，输入子目录名同样能收窄（如输入「模板」）。
 */
import { App, FuzzySuggestModal, TFile } from "obsidian";
import { listVaultMarkdownFiles } from "../utils/vaultFs";

export class FilePickerModal extends FuzzySuggestModal<TFile> {
  private readonly files: TFile[];

  constructor(app: App, private onPick: (path: string) => void) {
    super(app);
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Markdown" 是专有名词，保留首字母大写
    this.setPlaceholder("输入关键词过滤，或浏览仓库全部 Markdown 文件…");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "确认" },
      { command: "esc", purpose: "取消" },
    ]);
    // 全库枚举走 vault 内存索引树（同步），无需异步加载
    this.files = listVaultMarkdownFiles(app);
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
