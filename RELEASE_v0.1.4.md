# AI PM Tool v0.1.4

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-16

### Update

v0.1.4 clears the one blocking **Error** raised by the automated Obsidian plugin review against v0.1.3.

**Review Error: `Disabling 'obsidianmd/ui/sentence-case' is not allowed`**

The v0.1.3 file-picker placeholder contained the word `Markdown`, which `obsidianmd/ui/sentence-case` wanted lowercased; the earlier build suppressed the rule with an `// eslint-disable-next-line … -- description` comment. Adding a description is enough for most rules, but `obsidianmd/ui/sentence-case` is on the review's **non-disableable** list — the suppression itself is the Error.

Fix (no suppression, no behavior change):

1. The `eslint-disable` comment is gone — the repo now has **zero** `eslint-disable` directives in `src/`.
2. The placeholder is reworded to avoid the English proper noun: `输入关键词过滤，或浏览整个仓库的笔记文件…` ("type to filter, or browse every note file in the vault"). The picker's actual scope is unchanged: it still lists every Markdown file in the vault, at any depth, with fuzzy matching over the full vault-relative path.
3. Audit of the remaining UI strings: no other `setName` / `setDesc` / `setPlaceholder` / `setButtonText` literal hides an English proper noun behind a conditional expression (the pattern that let the v0.1.3 string slip past the local lint run).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-16

### 版本更新

v0.1.4 清掉 Obsidian 自动化插件审核针对 v0.1.3 报出的 1 条阻断性 **Error**。

**审核 Error：`Disabling 'obsidianmd/ui/sentence-case' is not allowed`**

v0.1.3 的文件选择器提示语含英文词 `Markdown`，`obsidianmd/ui/sentence-case` 规则要求小写，当时用带说明的 `// eslint-disable-next-line … -- 描述` 抑制了该规则。多数规则带说明即可，但 `obsidianmd/ui/sentence-case` 在审核的**不可禁用**名单内——抑制动作本身即 Error。

修复（不加抑制、行为不变）：

1. 删除该 `eslint-disable` 注释——现在 `src/` 内 `eslint-disable` 指令为 **0 条**。
2. 提示语改写为不含英文专有名词的表述：`输入关键词过滤，或浏览整个仓库的笔记文件…`。选择器实际范围不变：仍列出仓库内任意层级的全部 Markdown 文件，模糊匹配对象仍是完整路径。
3. 复查其余 UI 文案：无其他 `setName` / `setDesc` / `setPlaceholder` / `setButtonText` 字面量把英文专有名词藏在条件表达式后面（正是这个模式让 v0.1.3 的那句逃过了本地 lint）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
