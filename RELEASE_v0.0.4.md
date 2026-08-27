# AI PM Tool v0.0.4

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-08-27

### Update

v0.0.4 addresses the follow-up Source code findings from the automated Obsidian plugin review:

1. **Floating promise fixed** — `src/view/FilePickerModal.ts`: `super.onOpen()` is now awaited (`await super.onOpen()`), because `Modal.onOpen` is typed `Promise<void> | void` and the un-awaited call triggered the "Promises must be awaited" finding.
2. **`prefer-create-el` verification** — the review reported 7 `document.createElement` usages, but none exist in this repository: `git grep document.createElement` returns nothing on `main` and on every release commit. The only such call that ever existed (one file-picker input in `MailModal.ts`) was migrated to Obsidian's `createEl` in v0.0.2; the 7 reported lines are all compliant `createEl` calls in the current source. This release lets the automated review re-scan and confirm.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-08-27

### 版本更新

v0.0.4 处理 Obsidian 自动化插件审核的后续 Source code 反馈：

1. **修复 floating promise** — `src/view/FilePickerModal.ts`：`super.onOpen()` 改为 `await super.onOpen()`（`Modal.onOpen` 类型为 `Promise<void> | void`，未 await 触发「Promises must be awaited」检查）
2. **`prefer-create-el` 核验** — 审核报告 7 处 `document.createElement`，但本仓库不存在：`git grep document.createElement` 在 main 与各发布 commit 均为 0 处；历史上唯一一处（MailModal 的文件输入）已于 v0.0.2 改用 `createEl`；报告的 7 个行号在当前源码中均为合规的 `createEl` 调用。本版本发布后供自动化审核重新扫描确认

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
