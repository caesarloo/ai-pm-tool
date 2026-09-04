# AI PM Tool v0.1.0

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-04

### Update

v0.1.0 is the **P1 feature release: "✨ Add requirement"** — create a new requirement note from a requirement description (design: `AI项目经理工具-P1设计.md`, prototype 05):

1. **Templater really executes your requirement template** — the flow calls the Templater plugin API (`create_new_note_from_template`) against the template path configured in Settings (e.g. `产品规范/产品需求模板.md` in your vault); every frontmatter field / template default / template date math / mail-section body skeleton comes from the real template run — the plugin does **not** keep its own field list, so template updates are picked up automatically. `需求名称` (= file name, used by the requirement submission flow) is written back; `需求编号` is left blank for manual backfill after submission.
2. **LLM auto-generates the file name and fields from your description + content-generation rules** — you only fill in one free-text **requirement description** (background / goals / feature points / expected value / plan / owners). The plugin creates a temporary skeleton with a placeholder file name first, then the LLM suggests the **file name (= 需求名称)** together with the frontmatter field values: when the **content-generation SKILL** is configured (Settings → "Requirement content-generation SKILL path" — the file holds your company naming rules, e.g. domestic / cross-border financial codes, department → product-line mapping, value-category conventions), those rules are injected into the prompt; without it, the review SKILL's code/category data drives generic naming guidance. Statuses / flags / enums keep their template defaults (not overwritten); date values are normalized to `YYYY-MM-DD`. The file is renamed to the final name on commit. The LLM never writes body text or restructures the note.
3. **Review-SKILL content review (preview only, never written to the note)** — reads the review SKILL file configured in Settings ("Requirement review SKILL path", kept lenient, not rewritten) and runs three checks: ① expected-value audit (LLM, temperature 0.1), ② three-part name check (financial code + product-line/category + 4–15 char description — lenient; code-prefix tolerance such as `AA01` → `AA`), ③ product-line / department / cost-bearer list checks (the company lists from the content-generation SKILL when configured, otherwise the review SKILL's lists). Results are shown as per-field badges (`✓/▲/✕` + `R=rule / L=LLM`) with inline advice; each verdict is advisory — nothing blocks creation. Missing / unparseable SKILL → review is skipped with a one-time notice.
4. **Preview & commit are separated; after commit the dialog becomes the Requirement workbench** — after creation you review the suggested file name and an editable full-field table (text fields with ✏️ LLM regenerate, list fields as chips, select/date/number/bool controls; the mail-stage flags (stages driven by the rules file) are read-only grey switches written back by the mail flow) plus the editable template body; **"⬆️ Submit to SVN"** renames the file to the final name and commits it (auto-add). On success the dialog **switches in place into that note's Requirement workbench** — it **defaults to Project progress** (milestone timeline / mail / progress form); a single switch button at the far right of the title row (direction chevron + action label, clear of the close ✕) reads "➤ Enter editor" and opens full-field editing + review verdicts + submit, and reads "← Back to progress" while editing to switch back; there is no separate "done" page anymore. Clicking any card in the project overview opens the same workbench, so any requirement file (committed or not) can be re-opened for editing & re-commit. Writes are **key-by-key against the baseline at open time** — untouched keys keep their on-disk form, so progress-form / mail write-backs are never overwritten. Closing the dialog while the edit view has unsaved changes still keeps the note file (current content saved, never deleted) for later re-open / manual commit.
5. **Entry & prerequisites** — the only entry is the **✨ Add requirement button at the top of the project overview** (no command palette command). Pre-checks guide you before generation starts: an active custom model (this feature hard-depends on the LLM), the Templater plugin installed & enabled, the requirement template path existing, and the requirement directory existing.

Also in this release: three new settings (`Requirement template path`, `Requirement review SKILL path`, `Requirement content-generation SKILL path`), parser frontmatter layout/serialization utilities (template-style write-back), and new smoke tests (frontmatter layout serialization, SKILL section extraction & rule checks incl. a company-naming content-generation SKILL case).

**Requires:** Templater plugin (community) for the skeleton step; both SKILL paths are optional. Everything else degrades gracefully with explicit notices.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-04

### 版本更新

v0.1.0 是 **P1 功能版本：「✨ 新增需求」**——只需填写需求描述，自动创建新需求笔记（设计文档 `AI项目经理工具-P1设计.md`、原型 05）：

1. **Templater 真实执行需求模板** — 流程调用 Templater 插件 API（`create_new_note_from_template`），模板路径为设置项「需求笔记模板路径」（如 vault 中 `产品规范/产品需求模板.md`）；frontmatter 全字段/模板默认值/模板日期计算/正文邮件小节骨架全部来自模板真实执行产物——插件**不内置字段清单**，模板更新自动跟随。`需求名称`（= 文件名，需求提交流程使用）自动写入；`需求编号` 留空，提交流程后人工回填。
2. **LLM 依据描述 + 内容生成规则自动生成文件名与字段** — 唯一输入是一段自由文本**需求描述**（背景 / 目标 / 功能点 / 预期价值 / 计划 / 负责人等）。插件先用临时占位文件名执行模板创建骨架，再由 LLM 一次性生成**建议文件名（= 需求名称）**与需要填写的 frontmatter 字段值：配置了**「需求内容生成 SKILL 路径」**（公司口径：SKILL 文件提供贵司命名规范，如境内/跨境财务编码、业务部门→产品线映射、价值分类与达成周期等）时，该规则全文注入生成提示；未配置则命名用通用三段式说明（不回退审核 SKILL 数据）。状态/标志/枚举保留模板默认（不覆盖）；日期归一化为 `YYYY-MM-DD`，非法值置空待人工补。提交时按最终文件名重命名。LLM 不撰写正文、不改结构。
3. **审核规则内容审核（结果仅预览展示、不落盘）** — 读取设置项「需求审核 SKILL 路径」指向的 SKILL 文件（按贵司审核规则编写——规则宽松、不改动），执行三项校验：① 预期价值审核（LLM，temperature 0.1）② 需求名称三段式校验（财务编码 + 产品线/分类 + 4-15 字描述——宽容区间，编码前缀容错如 `AA01` → `AA`）③ 产品线/业务部门/成本承担方列表校验（内容生成 SKILL 配置时用其公司口径列表，未配置则该项跳过——不回退审核 SKILL 的列表）。意见按字段徽章展示（`✓/▲/✕` + `R=规则 / L=LLM`）+ 就地建议；每条意见仅为建议，**不阻塞创建**。SKILL 缺失/不可解析 → 跳过审核并提示一次。
4. **创建与提交分离；提交后弹窗转入需求工作台** — 创建完成后预览建议文件名与可编辑的全字段表（文本字段 ✏️ LLM 重写、列表 chips 直编、下拉/日期/数字/开关控件；邮件环节标志为只读灰开关、由邮件发送流程回写，环节键集由规则文件「一、项目环节」动态驱动，内置兜底仅 1 个通用环节）+ 可编辑的模板正文；点 **「⬆️ 提交 SVN」** 按最终文件名重命名并提交新文件（autoAdd）。成功后弹窗**原地转入该需求的「需求工作台」**：**默认展示项目进展**（环节时间轴 / 邮件 / 进展表单）；标题行**最右侧单个切换按钮**（方向箭头 + 动作文案，已为右上角关闭 ✕ 让位）——进展视图下显示「➤ 进入编辑」，点击进入全字段编辑 + 内容审核 + 提交，编辑中按钮文案变为「← 返回进展」、点击返回——不再有单独的完成页；总览中点击任一需求卡片打开的也是同一工作台，**任意需求文件（已提交/未提交）都可打开编辑与再提交**。写入按「打开时基线」**键级写回**：未改动的键保持磁盘原样，进展表单 / 邮件流程回写的字段不会被覆盖。编辑视图有未提交修改时关闭弹窗仍会保留该笔记文件（当前内容已落盘、不会删除），供稍后重开继续或手动提交。
5. **入口与预检** — 唯一入口 = **项目总览顶部「✨ 新增需求」按钮**（不做命令面板入口）。生成前预检引导：已启用自定义模型（本功能强依赖 LLM）、Templater 插件已安装并启用、需求模板路径存在、需求笔记目录存在；描述填写后才可开始生成。

本次同时新增三个设置项（需求笔记模板路径 / 需求审核 SKILL 路径 / 需求内容生成 SKILL 路径）、parser frontmatter 布局/序列化工具（模板风格写回）与新增冒烟测试（frontmatter 布局序列化、SKILL 章节提取与规则校验，含公司口径内容生成 SKILL 用例）。

**依赖：** 骨架步骤依赖社区插件 Templater（未启用时引导安装）；两条 SKILL 路径均可选。其余情况均优雅降级并明确提示。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
