# AI PM Tool v0.3.6

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-19

### Update

v0.3.6 removes the "stuck on one milestone" restriction in the project-progress timeline: every **unfinished** milestone node now offers the **✉️ Send mail** button, so you can skip a node, send ahead, or back-fill a missed one without being blocked. No configuration or data-format change.

**1. Send mail from any unfinished node**

Previously only the current node (the first unfinished one, marked "▶ Current") had a send button; later nodes showed only "○". Now all unfinished nodes have **✉️ Send mail**. The button on the current node stays solid/accent-colored; buttons on later unfinished nodes use an outline style so the current node keeps visual priority.

Sending from a later node writes back only that node's own flag and its mail-record section. The "current milestone" is still computed as the first unfinished node, so completing a later node does not auto-advance past earlier unfinished ones — the timeline lights up in the order you actually complete them.

**2. Completed nodes are unchanged**

Nodes already marked done still show ✅ with their send time and no send button; the change only widens which unfinished nodes are clickable.

**3. Clearer completion notice**

The notice after a successful write-back now reads "`<milestone>` mail completed, timeline updated" instead of "milestone advanced", since back-filling or sending ahead does not necessarily move the current milestone.

**4. Docs and template wording**

The seeded rules file and the README (both languages) now state that any unfinished node can send mail and that the order is not enforced. Existing rules files keep their old wording (the UI does not depend on it) and are not rewritten.

### Compatibility

- No configuration or data-format change; existing notes, mail records and milestones are untouched.
- `minAppVersion` remains 1.13.0; no new Obsidian API is used.
- Mail generation, sending, attachments and inline images are unchanged.

`npm run typecheck`, `npm run lint`, `npm test` (14 smoke suites) and `npm run build` all pass (measured 2026-11-19).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-11-19

### 版本更新

v0.3.6 去掉「卡在某个节点」的限制：项目进展时间轴上**所有未完成节点**都提供 **✉️ 发起邮件** 按钮，可以跳过某节点、提前发或补发，不再被「必须先完成当前环节」挡住。配置与数据格式均未变化。

**1. 任一未完成节点都能发邮件**

改动前只有当前节点（第一个未完成节点，标「▶ 当前」）有发送按钮，后面的节点只显示「○」。现在所有未完成节点都有 **✉️ 发起邮件**：当前节点的按钮保持实心强调色，后面未完成节点的按钮用描边样式，视觉上仍让位于当前节点。

从后面的节点发送，只回写该节点自己的标志与邮件记录小节；「当前环节」仍按第一个未完成节点计算，所以完成后面的节点不会越过前面未完成的节点自动推进，时间轴按你实际完成的顺序点亮。

**2. 已完成节点行为不变**

已标记完成的节点仍显示 ✅ 与发送时间，不显示发送按钮；本次只放开未完成节点的可点范围。

**3. 完成提示更准确**

回写成功后的提示由「环节已推进」改为「`<环节>` 邮件已完成，时间轴已更新」——补发或提前发时当前环节本来就不一定前进。

**4. 文档与模板文案**

种子规则文件与 README（中英两段）同步写明「未完成节点都可发邮件、不强制顺序」。既有规则文件保留原文（界面不依赖这段文字），不会被改写。

### 兼容性

- 配置与数据格式均未变化；既有笔记、邮件记录与环节标志不受影响。
- `minAppVersion` 仍为 1.13.0；未使用新的 Obsidian API。
- 草稿生成、发送、附件与正文内嵌图行为均未改动。

`npm run typecheck`、`npm run lint`、`npm test`（14 组冒烟）、`npm run build` 全部通过（2026-11-19 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
