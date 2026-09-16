# AI PM Tool v0.1.3

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-16

### Update

v0.1.3 removes the directory restriction from every file picker in the settings tab. Templates, contact books and rule/SKILL files often live outside the folder you happen to be configuring, so the candidate list is now the **whole vault**:

1. **Vault-wide file pickers** — the "Choose file…" buttons for *requirement-note template path*, *contact-book path*, *requirement review SKILL path* and *requirement content SKILL path* no longer narrow the list to a context directory (the setting's own folder, or the template folder). Every Markdown file in the vault is listed, at any depth and under any top-level folder.
2. **Simpler, faster enumeration** — enumeration walks the vault's in-memory index tree (`vault.getRoot().children`, recursive) instead of the on-disk adapter listing, so the picker opens synchronously with no disk I/O, and files that are not registered in the metadata index can no longer be missed. Non-Markdown files are filtered out.
3. **Fuzzy match still narrows** — the fuzzy matcher runs against the full vault-relative path, so typing a folder name (e.g. `模板`) narrows the list just like before; typing a file name works from anywhere.
4. **Cleanup** — the two context-directory resolvers (`filePickerBaseDir`, `contactBookPickerBaseDir`) and the picker's `baseDir` parameter / async preload were removed. The README privacy disclosure ("Vault enumeration") now states that the pickers list the whole vault, in both English and Chinese.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-16

### 版本更新

v0.1.3 去掉设置页所有文件选择器的目录限制。模板、通讯录、规则/SKILL 文件常常并不放在你当下正在配置的那个目录里，候选列表现在统一为**整个仓库**：

1. **全库文件选择器** — 「需求笔记模板路径」「通讯录名单路径」「需求审核 SKILL 路径」「需求内容生成 SKILL 路径」的「选择文件…」按钮不再按上下文目录（设置项当前所在目录、模板目录）收窄范围，列出仓库内任意层级、任意顶层目录下的 Markdown 文件。
2. **枚举更简单更快** — 枚举走 vault 内存索引树（`vault.getRoot().children` 递归），不再走磁盘 adapter 列目录：选择器同步打开、无磁盘 IO，也不会漏掉未进入元数据索引的文件；非 Markdown 文件一律过滤。
3. **模糊匹配照旧收窄** — 模糊匹配对象是完整路径，输入子目录名（如「模板」）即可收窄，输入文件名在任意位置都能搜到。
4. **清理** — 删除两个上下文目录解析函数（`filePickerBaseDir`、`contactBookPickerBaseDir`）以及选择器的 `baseDir` 参数与异步预加载；README「枚举 vault 文件」隐私披露的中英两份同步为「列出整个仓库」。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
