# AI PM Tool v0.3.0

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-13

### Update

v0.3.0 makes screenshots and diagrams actually reach the mail: images pasted or dropped into the mail body are stored in the vault and embedded into the **mail body itself** instead of being silently dropped. Attachment multi-select, retained attachments across reopens, a `Message-ID` header and a maximize button round out the mail dialog.

**1. Body images are embedded, not attached**

- Pasting or dropping an image into the body follows Obsidian's own semantics: the image is saved into your vault (respecting your Obsidian attachment-folder setting) and a `![[...]]` reference is inserted at the caret.
- On send, those references are resolved, read from the vault and embedded into the mail body as `multipart/related` parts with `Content-ID` + `<img src="cid:...">` — images are **not** sent as attachments.
- Web links (`http(s)://`), non-image files and missing files are kept as plain text and reported with a notice; sending is never blocked by them.
- The same image referenced twice is embedded only once. Pure-text clients see `[图片：文件名]` placeholders.
- This fixes the failure mode where a pasted screenshot looked fine in the dialog yet the delivered mail contained no image and no error.

**2. Attachments: multi-select and retained across reopens**

- The file picker now accepts multiple files at once; the 25 MB total limit is still enforced per file and cumulatively.
- Selected attachments survive closing and reopening the dialog (session-level cache on the plugin instance, with a notice when restored) and are cleared after a successful send — so a picked file is no longer silently lost.

**3. Mail headers and dialog size**

- A `Message-ID` header is now generated (domain taken from the sender address), so replies can be threaded by the recipient's mail client.
- The dialog has a maximize / restore button (⛶ in the title bar, or double-click the title) for long bodies; images in the body preview scale to fit.

**4. Compatibility**

- No configuration or note migration needed; existing sent-mail records are untouched.
- SMTP configuration, SVN behaviour and `minAppVersion` (1.13.0) are unchanged.
- Mails without body images keep the previous MIME structure; clients that do not support `cid:` images fall back to the plain-text placeholders.

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass (measured 2026-11-13).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-11-13

### 版本更新

v0.3.0 让截图与插图真正进入邮件：粘贴/拖入正文的图片会存进 vault，并**内嵌进邮件正文本身**，不再被静默丢弃；同时补上附件多选、关闭重开保留附件、`Message-ID` 头与弹窗最大化按钮。

**1. 正文图片内嵌，不再作为附件**

- 往正文里粘贴或拖入图片，按 Obsidian 自身语义处理：图片存进 vault（遵循你的 Obsidian 附件目录设置），并在光标处插入 `![[...]]` 引用。
- 发送时解析这些引用、从 vault 读出二进制，以 `multipart/related` + `Content-ID` + `<img src="cid:...">` 内嵌进邮件正文——图片**不作为附件**发送。
- 外链（`http(s)://`）、非图片文件、找不到的文件保留为普通文字并弹提示，不阻塞发送。
- 同一张图被引用两次只内嵌一次；纯文本客户端显示 `[图片：文件名]` 占位。
- 这修掉了原来的失败形态：正文里贴的截图在弹窗里看着正常，实际发出的邮件里却没有图、也不报错。

**2. 附件多选与跨弹窗保留**

- 选择附件时支持一次多选；25MB 总量上限仍按单件与累计两处校验。
- 已选附件在关闭弹窗再打开后仍保留（插件实例上的会话级缓存，恢复时会提示），发送成功后清空——不再出现「选好的附件静默丢失」。

**3. 邮件头与弹窗尺寸**

- 新增 `Message-ID` 头（域名取自发件人地址），对方邮件客户端回复时能串成会话。
- 弹窗新增最大化/还原按钮（标题栏「⛶」或双击标题栏），长正文编辑更方便；正文预览里的图片按宽度自适应。

**4. 兼容性**

- 无需改配置或迁移笔记；历史发送记录不受影响。
- SMTP 配置、SVN 行为与 `minAppVersion`（1.13.0）均未变化。
- 正文没有图片的邮件保持原有的 MIME 结构；不支持 `cid:` 内嵌图的客户端会退回显示纯文本占位。

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过（2026-11-13 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
