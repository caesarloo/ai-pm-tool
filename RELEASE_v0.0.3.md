# AI PM Tool v0.0.3

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-08-27

### Update

v0.0.3 addresses the follow-up Behavior and Source code findings from the Obsidian community plugin review:

1. **Directory-scoped file picker** — the Settings file picker no longer enumerates the whole vault (`vault.getFiles()` removed): it now lists Markdown files only inside the current context directory (the parent folder of the configured contact-book path, or the configured template directory) via `app.vault.adapter.list`. README disclosure updated to match.
2. **Shell execution justification in README** — added a dedicated bilingual section explaining *why* the plugin invokes the system `svn` CLI (no Obsidian API equivalent), and the exact boundaries: `execFile` only with static argument arrays (no shell), `svn` never bundled/downloaded, input validation (shell metacharacters / path traversal / comments rejected, passwords masked), 60s timeout, `windowsHide`, runs only on explicit user action, graceful degradation when `svn` is missing.
3. **`createEl` compliance confirmed** — `git grep document.createElement` returns nothing on `main` and the current branch; the only such call ever present (file-picker input in `MailModal.ts`) was migrated to `createEl` in v0.0.2. All DOM creation in `settings.ts` / `MailModal.ts` / `StatusView.ts` uses Obsidian `createEl` / `createDiv` helpers.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-08-27

### 版本更新

v0.0.3 处理 Obsidian 社区插件审核的后续 Behavior 与 Source code 反馈：

1. **文件选择器目录级枚举** — 设置页文件选择器不再全库枚举（移除 `vault.getFiles()`）：仅列出**当前目录上下文**（通讯录所在目录，或模板目录）内的 Markdown 文件，通过 `app.vault.adapter.list` 目录级递归；README 披露同步更新
2. **README 补充执行系统命令的论证与边界** — 新增双语小节说明为何必须调用系统 `svn` CLI（Obsidian API 无等价能力）及精确边界：仅 `execFile` + 静态参数数组（无 shell）、不捆绑/不下载 svn、输入校验（拦截 shell 元字符/路径穿越/注释、密码脱敏）、60 秒超时、`windowsHide`、仅用户主动触发、svn 缺失时优雅降级
3. **`createEl` 合规确认** — `git grep document.createElement` 在 main 与当前分支均为 0 处；仓库唯一一次出现（MailModal 文件输入）已于 v0.0.2 改用 `createEl`；`settings.ts` / `MailModal.ts` / `StatusView.ts` 的 DOM 创建全部使用 Obsidian `createEl` / `createDiv`

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
