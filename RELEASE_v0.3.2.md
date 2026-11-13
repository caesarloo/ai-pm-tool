# AI PM Tool v0.3.2

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-13

### Update

v0.3.2 fixes two UI problems in the mail dialog that were reported against 0.3.1. No note, configuration or data-format change.

**1. The image-paste hint moved between the body and the attachments**

The hint telling users that images can be pasted into the body used to be the third child of the attachment field, which is a horizontal flex row (`label + value`). It was therefore squeezed to the right of the attachment box and shrank the `flex: 1` attachment area. The hint is now a standalone full-width line rendered after the body field and before the attachment field, so the attachment area gets its full width back.

**2. The maximize button no longer overlaps the modal close button**

The maximize/restore button sits at the end of the title bar. Obsidian's native close button is absolutely positioned in the top-right corner of the modal (`top: 6px`, `inset-inline-end: 6px`, about 24×24 px, with a 12px offset when styled scrollbars are on), so the two overlapped. The title-bar actions now reserve 36px at the inline end, which keeps the maximize button clear of the close button.

**3. Compatibility**

- No behaviour, configuration or data-format change; existing notes and sent-mail records are untouched.
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

v0.3.2 修复邮件弹窗里的两处界面问题（均来自 0.3.1 的使用反馈）。行为、配置与数据格式均未变化。

**1. 图片粘贴提示移到正文与附件之间**

提示用户「图片可直接粘贴/拖入正文」的那段文字，原先挂在附件字段内部——附件字段是「标签 + 内容」的横向 flex 行，提示成了第三个子项，于是被挤到附件框右侧，还把 `flex: 1` 的附件区压窄了。现在提示改为独立整行，渲染在正文字段之后、附件字段之前，附件区恢复整行宽度。

**2. 最大化按钮不再与关闭按钮重叠**

最大化/还原按钮位于标题栏右端。Obsidian 原生关闭按钮是绝对定位在弹窗右上角的（`top: 6px`、`inset-inline-end: 6px`，约 24×24 px；开启滚动条美化时偏移为 12px），两者因此叠在一起。现在标题栏右侧操作区预留 36px，最大化按钮整体让开关闭按钮。

**3. 兼容性**

- 行为、配置与数据格式均未变化；既有笔记与已发送邮件记录不受影响。
- `minAppVersion` 仍为 1.13.0；未使用新的 Obsidian API。

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过（2026-11-13 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
