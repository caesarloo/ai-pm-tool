# AI PM Tool v0.3.1

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-13

### Update

v0.3.1 is a maintenance release that clears the source-code warning reported by the Obsidian community review: three redundant type assertions in the mail dialog. No behaviour changes.

**1. Obsidian review warning removed**

`src/view/MailModal.ts` cast the callback parameter of the `paste` / `dragover` / `drop` listeners to `ClipboardEvent` / `DragEvent`. The parameter type is already determined by the event name, so the assertions were unnecessary — the review reported them as "This assertion is unnecessary since it does not change the type of the expression". The casts are removed and the handlers use `ev` directly; runtime behaviour is identical.

**2. Compatibility**

- No behaviour, configuration or data-format change; existing notes and sent-mail records are untouched.
- `minAppVersion` remains 1.13.0; no new Obsidian API is used.
- Mails without body images keep the previous MIME structure.

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass (measured 2026-11-13).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-11-13

### 版本更新

v0.3.1 是维护版本，清掉 Obsidian 社区审核报的源码警告：邮件弹窗里的三处多余类型断言。行为不变。

**1. 清掉 Obsidian 审核警告**

`src/view/MailModal.ts` 把 `paste` / `dragover` / `drop` 三个监听回调的参数断言成了 `ClipboardEvent` / `DragEvent`。这些参数的类型本来就由事件名决定，断言不改变类型，审核因此报「This assertion is unnecessary since it does not change the type of the expression」。现已去掉断言、直接使用 `ev`，运行行为完全一致。

**2. 兼容性**

- 行为、配置与数据格式均未变化；既有笔记与已发送邮件记录不受影响。
- `minAppVersion` 仍为 1.13.0；未使用新的 Obsidian API。
- 正文无图片的邮件保持原有 MIME 结构。

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过（2026-11-13 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
