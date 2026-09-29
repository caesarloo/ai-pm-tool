# AI PM Tool v0.1.8

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-29

### Update

v0.1.8 makes an SVN conflict a **blocking** condition inside the SVN step, adds a structure-aware three-way auto-merge for single-sided conflicts, and fixes the mail-record section boundary that could silently delete a neighbouring milestone section.

**1. Conflicts block the SVN step instead of being reported and ignored**

The three commit paths (milestone email, progress update, requirement submit) used to write the note first and merely show a notice when the commit failed, leaving a half-finished state behind. They now refuse the whole submit action when a conflict is detected: nothing is written, nothing is committed, and the milestone is not marked as done — the dialog or panel stays open so the conflict can be resolved and the submit retried. Manual sync lists the conflicting files with their kind (text / tree / property) instead of reporting a plain success.

Conflicts are detected with two independent probes: the conflict markers inside the file (this one does not depend on `svn`, so a stale `wc.db` from a synced working copy cannot fool it) and the `svn status` conflict flag. Every SVN client is now created with a `fileContentReader`, which is what makes the marker probe actually run.

Sending mail is **not** affected: no SVN state is inspected before a milestone email is sent.

**2. Structure-aware three-way auto-merge**

When a conflict is found, the plugin first tries a safe merge instead of leaving everything to manual editing. The merge works on structure — frontmatter key by key, body section by section (`## …邮件`) — and compares three versions: `BASE`, the local side and the repository side.

| Case | Result |
|---|---|
| Both sides identical / only one side changed the key or section | merged automatically |
| One side added a key or section | kept |
| A section is missing locally but unchanged in the repository | kept (a missing section is more likely a parsing artefact of the markers than a real deletion) |
| **Both sides changed the same key or section differently** | **not merged — reported for manual decision** |
| Tree / property conflicts | **not merged** |

A successful merge writes the note and clears the conflict state, then asks you to review the result and submit again — it never commits on its own. Both standard markers and the glued form found in the field (`<<<<<<< .mine邮件发送时间：…`) are handled.

**3. Mail-record section boundary fixed**

The write-back located the end of a section by requiring a blank line before the next section title. That layout assumption failed in both directions: a real title with no blank line above it was not recognized, so the whole neighbouring section was deleted; and an ordinary heading inside the body (`## 报表邮件`) with a blank line above it **was** recognized, cutting the replacement short and leaving the old text behind.

The boundary is now a section title that occupies its own line (`## <label>邮件` / `## <label>（邮件发送记录）`), with no blank-line requirement, and the caller passes the set of milestone labels currently in effect so that an ordinary heading in the body can never be taken as a boundary. As a guard, the write-back is refused — leaving the file untouched and explaining why — whenever the range to be replaced contains conflict markers or any other milestone section title.

**4. Dependency upgraded to `@caesarloo/simple-svn-client@0.2.0`**

- `svn update` no longer swallows conflicts: it parses all four status columns, so `C` / `G` / `R` / `E` / `B`, property-only changes and tree conflicts are visible (the old parser acknowledged only `A/U/D` while svn still exits 0 on conflict).
- Conflict queries (`findConflicts` / `hasConflicts` / `assertNoConflicts`) and `commit(..., { assertNoConflicts: true })` are available to callers.
- Text decoding no longer corrupts legitimate Chinese, and Chinese `stderr` / working-copy paths are decoded correctly.

**5. Compatibility**

- No new Obsidian API is used, so `minAppVersion` remains 1.13.0.
- Behaviour change to be aware of: a submit that hits a conflict is now interrupted rather than reported after the fact.
- Existing notes are not rewritten by the upgrade; the mail-record guard only refuses a write that would delete content.

Covered by 17 new assertions in the mail-record smoke test (64 in that file), plus two new suites — SVN conflict guard (15 assertions) and three-way merge (24 assertions). `npm test` (12 suites), `npm run typecheck`, `npm run lint` and `npm run build` all pass (measured 2026-09-29).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-29

### 版本更新

v0.1.8 让 SVN 冲突在 **SVN 环节**成为阻断条件，为「单侧改动」的冲突加了结构感知的三方自动合并，并修复了邮件回写的小节边界——此前它会静默删掉相邻的环节小节。

**1. 冲突阻断 SVN 环节，而不是「提示一句就放过」**

三条提交通路（节点邮件、进展更新、需求提交）此前都是「先写盘、提交失败只弹提示」，留下半截状态。现在检测到冲突即**拒绝整次提交动作**：不写盘、不提交、不把环节标记为完成，弹窗／面板保持打开，解决冲突后可重试。手动同步也会列出冲突文件及其类别（文本／树／属性），不再报「完成」。

判据为两条独立探针：**文件内的冲突标记**（不依赖 `svn`，跨机同步产生的脏 `wc.db` 骗不过它）与 `svn status` 的冲突状态位；所有 SVN 客户端现在都会注入 `fileContentReader`，标记探针才真正生效。

**发邮件不受影响**：发送节点邮件之前不检查任何 SVN 状态。

**2. 结构感知的三方自动合并**

发现冲突后，插件会先尝试安全合并，而不是把一切留给人工。合并按**结构**进行——frontmatter 按键、正文按 `## …邮件` 小节，并比较三个版本：`BASE`、本地侧、仓库侧。

| 情形 | 结果 |
|---|---|
| 两侧一致／只有一侧改了该键或小节 | 自动合并 |
| 一侧新增键或小节 | 保留 |
| 本地缺失某小节、仓库侧未改 | 保留（缺失更可能是冲突标记的解析产物，而非真删除） |
| **两侧都改同一键或小节且不一致** | **不合并，列出条目交人工** |
| 树冲突／属性冲突 | **不合并** |

合并成功只写盘并清除冲突状态，随后要求你**核对结果并再次提交**——绝不自动入库。标准标记与现场实际存在的粘连形态（`<<<<<<< .mine邮件发送时间：…`）都能处理。

**3. 邮件回写的小节边界修复**

回写此前靠「下一个标题前须有空行」来判断小节结束。这个排版假设在两个方向上都失效：真标题前没有空行时识别不到，导致相邻小节被整段删除；而正文里形如 `## 报表邮件` 的普通标题只要前有空行就**会**被误判为边界，使替换提前截断、旧正文残留。

现在边界判据是**独占一行**的 `## <label>邮件` / `## <label>（邮件发送记录）`，不再要求空行；调用方传入当前生效的环节标签集合，正文里的普通标题因此不可能被当成边界。此外加了护栏：待替换区间内一旦出现冲突标记或其它环节小节标题，就**拒绝回写**——文件一字不动，并说明原因。

**4. 依赖升级至 `@caesarloo/simple-svn-client@0.2.0`**

- `svn update` 不再吞掉冲突：按真实四个状态列解析，`C`／`G`／`R`／`E`／`B`、仅属性变更与树冲突都能看见（旧解析器只认 `A/U/D`，而 svn 在冲突时退出码仍是 0）。
- 提供冲突查询（`findConflicts`／`hasConflicts`／`assertNoConflicts`）与 `commit(..., { assertNoConflicts: true })`。
- 文本解码不再损坏正常中文，中文 `stderr` 与中文工作副本路径也能正确解码。

**5. 兼容性**

- 未使用新的 Obsidian API，`minAppVersion` 仍为 1.13.0。
- 需要知晓的行为变化：提交遇到冲突时现在会**中断**，而不是事后提示。
- 升级不改写已有笔记；邮件回写护栏只拒绝「会删掉内容」的写入。

回写冒烟测试新增 17 项断言（该文件共 64 项），并新增两套测试——SVN 冲突守卫（15 项）与三方合并（24 项）。`npm test`（12 套）、`npm run typecheck`、`npm run lint`、`npm run build` 全部通过（2026-09-29 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
