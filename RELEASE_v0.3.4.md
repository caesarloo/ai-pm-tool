# AI PM Tool v0.3.4

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-13

### Update

v0.3.4 makes the mail dialog's maximize mode a real fullscreen view and lets the body editor use the leftover height, so a long mail body is no longer limited to a handful of lines. No configuration or data-format change.

**1. Maximize now means fullscreen**

The maximized dialog fills the whole window (100vw × 100vh) with no outer padding or rounded corners; the title bar stays fixed at the top and the content area is distributed with flexbox. The button tooltip is renamed from "maximize / restore" to "fullscreen / restore".

**2. The body editor fills the remaining height**

The body preview used to be capped at 300px, which is why only a few lines were visible no matter how large the dialog was. In fullscreen mode the cap is removed: the body field grows to fill the space between the header fields and the fixed lower blocks (paste hint, attachments, regenerate area, send button), scrolling inside, with a 120px minimum. Recipients, CC, subject, the hint, attachments, the regenerate area and the send button keep their own height.

**3. Compatibility**

- No configuration or data-format change; existing notes and sent-mail records are untouched.
- `minAppVersion` remains 1.13.0; no new Obsidian API is used.

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass (measured 2026-11-13).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-11-13

### 版本更新

v0.3.4 把邮件弹窗的「最大化」做成真全屏，并让正文编辑器用上剩余高度——长邮件正文不再只显示几行。配置与数据格式均未变化。

**1. 最大化改为真全屏**

最大化后的弹窗铺满整个窗口（100vw × 100vh），去掉外层内边距与圆角；标题栏固定在顶部，内容区按 flex 纵向分配。按钮提示文字由「最大化 / 还原」改为「全屏 / 还原」。

**2. 正文编辑器撑满剩余高度**

正文预览原先有 300px 的高度上限，这正是弹窗再大也只能显示几行的原因。全屏状态下该上限解除：正文字段撑满收件人/抄送/主题与下方固定块（粘贴提示、附件、重新生成区、发送按钮）之间的剩余空间，超出时编辑器内部滚动，最小保留 120px。其余元素保持各自高度。

**3. 兼容性**

- 配置与数据格式均未变化；既有笔记与已发送邮件记录不受影响。
- `minAppVersion` 仍为 1.13.0；未使用新的 Obsidian API。

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过（2026-11-13 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
