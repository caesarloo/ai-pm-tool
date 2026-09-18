# AI PM Tool v0.1.6

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-18

### Update

v0.1.6 fixes two defects in the write-back of a milestone email record into the requirement note.

**1. Tables in the email body showed up as plain text in Obsidian**

Markdown requires a blank line between a table and the line above it. The write-back glued the record lines straight onto the email body, so a table that followed any line of text — the `正文（文本存档）：` marker, a greeting, a paragraph — was written out as raw `| … |` rows instead of a table.

The write-back now inserts a blank line before every table block. The block itself is left untouched (header, separator and data rows stay adjacent), an existing blank line is never doubled, and tables inside ``` / ~~~ fenced code blocks are ignored. When the body starts with a table, the blank line also lands between the section heading and the table.

**2. A second write-back could delete the sections below**

Replacing an existing section consumed the blank line that separated it from the next section. On the next write-back the boundary check — a `## <label>邮件` heading preceded by a blank line — no longer matched, the replacement ran to the end of the note, and every later section disappeared, including non-email content such as a closing note. That separating blank line is now preserved, so repeated write-backs are stable.

The write-back logic also moved out of the mail modal into its own module, covered by 31 assertions in a new smoke test; `npm test` runs it on every build.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-18

### 版本更新

v0.1.6 修复节点邮件回写需求笔记时的两个缺陷。

**1. 邮件正文里的表格在 Obsidian 中显示成普通文本**

Markdown 要求表格与上一行之间留一个空行。回写时记录各行与邮件正文直接拼接，于是表格只要跟在任何一行文字之后——`正文（文本存档）：`、称呼、正文段落——就会被写成裸的 `| … |` 行，而不是表格。

现在回写会在每个表格块之前补一个空行。表格块本身不被改动（表头、分隔行、数据行保持相邻），已有空行不重复补，``` / ~~~ 围栏代码块内的表格不处理；当正文首行即表格时，空行同样落在小节标题与表格之间。

**2. 再次回写会删掉后面的小节**

替换已有小节时，小节与下一小节之间的空行被一并吃掉。于是下一次回写时，边界判定（`## <label>邮件` 标题且其上一行为空行）不再命中，替换范围一直延伸到文末，后续小节连同非邮件内容（如结尾说明）全部消失。现在该空行会被保留，重复回写稳定。

回写逻辑也从邮件弹窗中移出为独立模块，新增冒烟测试 31 项断言，`npm test` 每次构建都会覆盖。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
