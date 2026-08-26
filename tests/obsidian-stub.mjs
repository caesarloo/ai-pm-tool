// obsidian stub：仅用于 frontmatter 冒烟测试（ProgressModal 导入链需要）
export class Modal {}
export class Notice {}
export class Component {
  load() { return this; }
  unload() {}
}
export const MarkdownRenderer = { render: async () => undefined };
export class Setting {
  constructor() {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addTextArea() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
  addExtraButton() { return this; }
}
export class TFile {}
export class FileSystemAdapter {}
