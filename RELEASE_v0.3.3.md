# AI PM Tool v0.3.3

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-13

### Update

v0.3.3 fixes a data-loss bug in the mail dialog's editable body: pasting a second image made the first one disappear. No configuration or data-format change.

**1. Pasting a second image no longer drops the first**

The body editor is a contenteditable Markdown preview. A pasted image is saved to the vault and the body gets an Obsidian-style `![[path]]` reference, which Obsidian renders into a `span.internal-embed` element (the `<img>` lives inside it). The preview-to-Markdown serializer only handled text-bearing elements (`p`, headings, lists, tables, …), so once an image was rendered, the next serialization — triggered by pasting another image or editing the text — dropped it from the draft body. The image vanished and the second paste looked like it had overwritten the first.

The serializer now restores `internal-embed` elements from their `src` / `alt` attributes back to `![[...]]` references, in both the inline (paragraph) and the block-level paths. Bare external `<img>` elements are restored to `![](…)` as well. A side benefit: manually editing the body no longer drops already-rendered images.

**2. Compatibility**

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

v0.3.3 修复邮件弹窗正文编辑器的一个数据丢失缺陷：粘贴第二张图片时，第一张会消失。配置与数据格式均未变化。

**1. 粘贴第二张图片不再让第一张消失**

正文编辑器是 contenteditable 的 Markdown 预览。粘贴的图片先存进 vault，正文里得到 Obsidian 风格的 `![[路径]]` 引用，Obsidian 再把该引用渲染成 `span.internal-embed` 元素（真正的 `<img>` 在它内部）。而「预览 DOM → Markdown」的序列化器只处理带文本的元素（段落、标题、列表、表格等），所以图片一旦渲染出来，下一次序列化——粘贴另一张图或编辑正文都会触发——就会把它从草稿正文里丢掉。图片消失，看起来就像第二张覆盖了第一张。

现在序列化器会按 `src` / `alt` 属性把 `internal-embed` 元素还原成 `![[...]]` 引用，段内与块级两条路径都覆盖；裸的外链 `<img>` 也会还原成 `![](…)`。附带收益：手动编辑正文时同样不会再丢已渲染的图片。

**2. 兼容性**

- 配置与数据格式均未变化；既有笔记与已发送邮件记录不受影响。
- `minAppVersion` 仍为 1.13.0；未使用新的 Obsidian API。

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过（2026-11-13 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
