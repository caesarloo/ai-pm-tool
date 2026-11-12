# AI PM Tool v0.2.0

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-12

### Update

v0.2.0 changes how a sent milestone email is archived in the requirement note: the whole record is now written as an Obsidian quote callout, with only the send-time line and the attachment line left outside the callout.

**1. The record becomes a quote callout**

When a milestone email is sent, the section written back to the note (`## <stage>邮件`) now looks like this:

```markdown
邮件发送时间：2026-09-17 10:17
> [!quote]
> 收件人：…
> 抄送：…
> 主题：…
> 正文（文本存档）：
> …
附件：…
```

The `邮件发送时间：` line stays outside the callout because the progress timeline reads the send time from that unprefixed line. Recipients, CC, subject and the archived body sit inside the callout, so a full record folds into one readable block. The attachment line stays outside as searchable plain text.

**2. Formatting inside the callout**

- Blank lines are written as a bare `>` so the callout stays continuous instead of being split into several blocks.
- A `>` blank line is inserted before tables, so tables in the archived body (review conclusion tables, milestone plans, checklists) still render as tables inside the callout.
- The send-time line and the callout header are adjacent, with no blank line in between, matching the format already used in existing notes.

**3. Compatibility**

- Records already present in notes are not rewritten. A stage section is replaced only the next time an email is sent for that stage, so no action is required on existing notes.
- No new Obsidian API is used, so `minAppVersion` remains 1.13.0.
- No configuration, SMTP or SVN behaviour changed.

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass (measured 2026-11-12).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-11-12

### 版本更新

v0.2.0 调整了邮件发送后写回需求笔记的存档格式：整条发送记录改为 Obsidian quote callout，只有发送时间行与附件行留在 callout 外。

**1. 记录改为 quote callout**

节点邮件发送后，写回笔记的小节（`## <环节>邮件`）现在是这样：

```markdown
邮件发送时间：2026-09-17 10:17
> [!quote]
> 收件人：…
> 抄送：…
> 主题：…
> 正文（文本存档）：
> …
附件：…
```

`邮件发送时间：` 一行留在 callout 外，因为进展页时间轴是按这行未加前缀的文本读取发送时间的。收件人、抄送、主题与正文都在 callout 内，一条记录折叠成一个可读的块；附件行留在 callout 外，保持为可搜索的普通文本。

**2. callout 内的排版处理**

- 空行写成单独的 `>`，让 callout 保持连续，不会被空行切成多个块。
- 表格前补一行 `>` 空行，因此正文里的表格（评审结论表、里程碑计划、检查清单）在 callout 内仍正常渲染为表格。
- 发送时间行与 callout 头紧邻、中间不留空行，与既有笔记里的写法保持一致。

**3. 兼容性**

- 笔记里已存在的历史记录不会被改写；某个环节的小节只在该环节下次发送邮件回写时才替换，因此存量笔记不需要做任何处理。
- 未使用新的 Obsidian API，`minAppVersion` 仍为 1.13.0。
- 配置、SMTP 与 SVN 相关行为均未变化。

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过（2026-11-12 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
