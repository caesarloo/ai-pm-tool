# AI PM Tool v0.1.1

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-16

### Update

v0.1.1 fixes two usability defects in settings and the project overview:

1. **File picker works when the path setting is empty** — previously the `Choose file…` button enumerated only the *current directory context* (the directory the configured file lives in, else the template directory); when both were empty the candidate list was empty, so no file could be selected. Now the picker falls back to **every Markdown file in the vault** when there is no directory context (from the vault index tree, not `vault.getFiles()`), and `Choose file…` is usable straight away — e.g. picking the requirement template or a SKILL file before any directory has been configured. With a directory context the list stays scoped to that directory. Whitespace-only values (`"   "`) are treated as empty as well. The README "Enumerate vault files" behaviour disclosure was updated to match.
2. **"My tasks" and project status can be selected together** — the overview's filter row made them mutually exclusive (a single-value dimension: picking one cleared the other). "My tasks" is now an **independent switch** in its own row, combined AND-wise with project status / request status / approval / search, so "My tasks **+** In progress" (and any other combination) works. Defaults are unchanged: with own tasks present the view starts on "My tasks" (no status filter), otherwise on "In progress".

Also in this release: the combined filter logic moved into `applyNoteFilters()` (single AND-composing entry point) and a new smoke test suite covers it — my tasks + project status together, all four dimensions combined, keyword, and the picker's empty-context vault-wide fallback.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-16

### 版本更新

v0.1.1 修复设置与项目总览的两处可用性缺陷：

1. **设置项路径留空时文件选择器可正常匹配文件** — 此前「选择文件…」只在**当前目录上下文**（该设置有值时的所在目录，否则「模板目录」）内枚举；两者都为空时候选列表为空，任何文件都选不到。现在无目录上下文时回退**整个仓库的 Markdown 文件**（走 vault 索引树，不用 `vault.getFiles()`），未配置任何目录也能直接点「选择文件…」选到需求模板 / SKILL 文件；有目录上下文时仍只列该目录内文件。纯空白值（`"   "`）同样按空处理。README「枚举 vault 文件」行为披露已同步更新。
2. **「我的任务」与项目状态可同时选中** — 此前总览筛选把它们放成同一个单选维度（点一个就取消另一个）。现在「我的任务」是**独立开关**（单独一行），与项目状态 / 需求状态 / 审批 / 搜索按 AND 组合生效，因此「我的任务 **+** 进行中」等任意组合同步可用。默认值保持原行为：有我的任务时默认只看我的任务（不叠状态），否则默认「进行中」。

本次同时把组合筛选逻辑收敛到 `applyNoteFilters()`（唯一 AND 组合入口），并新增冒烟测试覆盖：我的任务 + 项目状态同时生效、四维度组合、关键词，以及无目录上下文时选择器的全库兜底。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
