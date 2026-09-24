# AI PM Tool v0.1.7

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-24

### Update

v0.1.7 archives the sent email body as an Obsidian quote block when a milestone email record is written back into the requirement note.

**1. The archived email body is now a quote block**

The write-back used to paste the email body into the note as ordinary lines, directly below the record metadata. A long body therefore read as one flat block, visually indistinguishable from the `邮件发送时间：` / `收件人：` / `主题：` lines above it, with no way to tell where the record ended and the quoted mail began.

The body is now written as an Obsidian quote: every line is prefixed with `> `, and blank lines become a bare `>` so the quote stays a single continuous block instead of breaking apart. The metadata lines (time, recipients, cc, subject) and the attachment line stay **outside** the quote, so they remain plain searchable text — and the milestone timeline keeps reading the send time from the untouched metadata line.

**2. Tables still render inside the quote**

A table needs a blank line above it, and a quote is no exception. The blank line is inserted before quoting and then becomes `>`, so a table inside the body — an approval-conclusion table, for instance — renders as a table inside the quote rather than as raw `| … |` rows. A body that *starts* with a table also gets an empty quote line first.

**3. Robustness and compatibility**

- Line endings are normalized (CRLF / lone CR → LF), so no stray `\r` ends up inside a quoted line.
- An empty body produces no empty quote bar.
- Existing notes are never rewritten: a section switches to the quote form the next time mail is sent for that milestone, and repeated write-backs stay idempotent.
- No new Obsidian API is used, so `minAppVersion` remains 1.13.0.

Covered by 16 new assertions in the mail-record smoke test (47 in that file); `npm test`, `npm run typecheck` and `npm run lint` all pass.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-24

### 版本更新

v0.1.7 让节点邮件回写需求笔记时，把已发出的邮件正文以 Obsidian 引用块的形式存档。

**1. 存档的邮件正文改为引用块**

此前回写把邮件正文当普通行直接贴在记录元信息下方。正文一长就成了整块平铺的文字，与上面的 `邮件发送时间：`／`收件人：`／`主题：` 分不出界限，在笔记里也无法收起。

现在正文以 Obsidian 引用块写入：每行加 `> ` 前缀，空行写成单独的 `>`，因此整段是一个连续的引用块、不会被空行切断。元信息（时间、收件人、抄送、主题）与附件行留在引用块**之外**，仍是可搜索的普通文本；环节时间轴也照旧从未改动的元信息行读取发送时间。

**2. 引用块内的表格照常渲染**

表格上方需要空行，引用块内同样如此。该空行在加引用前缀之前补入、随后变成 `>`，因此正文里的表格（例如审核结论表）在引用块内仍渲染为表格，而不是裸的 `| … |` 行；正文首行即表格时，还会在块首补一个空的引用行。

**3. 健壮性与兼容性**

- 换行符归一（CRLF／裸 CR → LF），引用行里不会混入 `\r`。
- 正文为空时不产出空的引用条。
- 已有笔记不会被改写：某环节下次再发邮件时才切换为引用形态，重复回写保持幂等。
- 未使用新的 Obsidian API，`minAppVersion` 仍为 1.13.0。

回写冒烟测试新增 16 项断言（该文件共 47 项）；`npm test`、`npm run typecheck`、`npm run lint` 全部通过。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
