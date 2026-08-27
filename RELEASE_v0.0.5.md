# AI PM Tool v0.0.5

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-08-27

### Update

v0.0.5 fixes the `obsidianmd/prefer-create-el` findings from the automated Obsidian plugin review:

1. **Semantic DOM helpers** — the rule requires Obsidian's semantic helpers over generic `createEl`: `createEl("span", …)` must be `createSpan(…)`, `createEl("div", …)` must be `createDiv(…)`. All 7 reported usages (Settings provider name, MailModal generation hint, StatusView header/footer/hints) were migrated accordingly.
2. **Rule enabled in local lint** — `obsidianmd/prefer-create-el` is now enforced in `eslint.config.mjs`, so the full rule set matches what the review bot scans; local `npm run lint` passes clean.

(Note: v0.0.4's release notes described this rule as only about `document.createElement`; the rule additionally covers `createEl("span"|"div", …)` → `createSpan`/`createDiv`, which is what the 7 findings were about.)

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-08-27

### 版本更新

v0.0.5 修复 Obsidian 自动化插件审核的 `obsidianmd/prefer-create-el` 反馈：

1. **语义化 DOM 辅助方法** — 该规则要求用 Obsidian 语义化辅助替代通用 `createEl`：`createEl("span", …)` 应写 `createSpan(…)`，`createEl("div", …)` 应写 `createDiv(…)`。报告的 7 处（设置页 provider 名称、邮件生成提示、总览视图头部/底部/提示）已全部迁移
2. **本地 lint 启用该规则** — `eslint.config.mjs` 现在启用 `obsidianmd/prefer-create-el`，本地规则集与审核 bot 一致，`npm run lint` 全绿

（说明：v0.0.4 的发布说明曾把该规则仅描述为「document.createElement」，实际该规则还覆盖 `createEl("span"|"div", …)` → `createSpan`/`createDiv`——7 处反馈正是后者。）

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
