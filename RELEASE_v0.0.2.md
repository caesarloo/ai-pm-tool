# AI PM Tool v0.0.2

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-08-26

### Update

v0.0.2 addresses every finding from the Obsidian community plugin review, improving security transparency and code quality:

1. **Permissions disclosure** — README now discloses shell execution (system `svn` CLI via Node `execFile`, run only when you actively trigger an SVN operation, with injection/path-traversal validation) and the vault scanning scope (only the directories you configure)
2. **Scoped vault scanning** — requirement/template scans now enumerate only the configured directories instead of the whole vault; the file picker stays user-initiated
3. **Obsidian API compliance** — `fetch` replaced with `requestUrl`; timers scoped to `window.setTimeout`/`window.clearTimeout`; `document.createElement` replaced with `createEl`; Promise rejections are proper `Error`s; floating promises handled
4. **Code quality** — removed unnecessary type assertions, promise-returning void callbacks, and redundant console logging
5. **CSS cleanup** — removed all `!important` by raising selector specificity

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-08-26

### 版本更新

v0.0.2 处理了 Obsidian 社区插件审核的全部反馈，提升安全透明度与代码质量：

1. **权限披露** — README 新增权限与隐私说明：执行系统命令（`execFile` 调用系统 `svn`，仅在你主动触发 SVN 操作时，含注入/路径穿越校验）与扫描范围（仅你配置的目录）
2. **目录级扫描** — 需求/模板扫描改为仅枚举配置目录，不再全库枚举；文件选择器保持用户主动打开
3. **Obsidian API 合规** — `fetch` 改用 `requestUrl`；定时器统一 `window.setTimeout`/`window.clearTimeout`；`document.createElement` 改用 `createEl`；Promise 拒绝统一为 `Error`；处理未等待的 Promise
4. **代码质量** — 移除多余类型断言、返回 Promise 的 void 回调、冗余控制台日志
5. **CSS 清理** — 移除全部 `!important`，改用选择器特异性覆盖

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
