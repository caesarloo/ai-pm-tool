# AI PM Tool

[English](#english) | [中文](#chinese)

---

## English

**AI PM Tool** is a desktop-only Obsidian plugin that offloads PM busywork to an LLM: **notes as tasks, SVN snapshots as history**. The LLM only produces analysis and reminders — nothing is written back until a human confirms.

### Permissions & privacy

Full disclosure of what this plugin does on your system:

- **Shell execution** ⚠️ — calls the system **`svn` command-line client** via Node `child_process.execFile` (no shell parsing, fixed argument arrays only). It runs **only when you actively trigger** an SVN operation (manual sync / "Commit to SVN" / snapshot comparison), and only commands against your SVN working copy. Input is validated to block injection and path traversal; passwords are masked in logs. `svn` is never bundled or downloaded — you install it yourself.
- **Vault enumeration** — scans **Markdown files only inside the directories you configure** (requirement directory, template directory) to parse frontmatter for the project overview. The file picker lists Markdown filenames **only inside the current context directory** (the configured contact-book's parent folder, or the template directory) and **only while you have it open**; no content is read until you pick a file.
- **Vault read** ✅ — reads individual vault files through the Obsidian API (`vault.read` / `vault.cachedRead`).
- **Vault write** ✅ — creates / modifies vault files through the Obsidian API (`vault.modify` / `vault.create`), only for actions you confirm in the UI (sample generation, frontmatter updates, sent-mail records).
- **Network** — SMTP outbound only when you configure it and click send; LLM API calls only to providers you configure (API keys stored in the system keychain via SecretStorage). No telemetry, no analytics, no clipboard access.

**Why the plugin invokes the system `svn` command**

SVN is a standalone version-control system that Obsidian's API cannot drive. To sync / commit / compare snapshots the plugin must call the system `svn` CLI — there is no alternative path, which is why this is disclosed rather than hidden. The call is as narrow as it can be:

- `child_process.execFile` only — **no shell** (`shell: false`), no string-built commands; every invocation is a fixed `svn` binary plus a static argument array (paths and the commit message are passed as separate argv entries).
- `svn` is **never bundled or downloaded** — it is auto-detected from PATH / common install locations, or you can set the path yourself; if it is missing, the SVN features degrade gracefully and nothing executes.
- Input validation runs before every call: shell metacharacters, path traversal and comments are rejected; commit messages are checked for illegal control characters; passwords are masked in logs.
- Every call is bounded: 60s timeout, `windowsHide: true`, capped output; commands run **only when you actively trigger** them (manual sync / "Commit to SVN" / snapshot comparison) and only against your SVN working copy.
- Through this channel the plugin never reads or modifies anything outside the SVN working copy, and never builds a command string from note content.

**Current stable version**: `0.0.3`

**Latest release**: https://github.com/caesarloo/ai-pm-tool/releases

### Installation

1. Go to the [latest release page](https://github.com/caesarloo/ai-pm-tool/releases) and download these 3 files:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create the plugin directory inside your vault: `<Vault>/.obsidian/plugins/ai-pm-tool/`
3. Copy the 3 downloaded files into that directory.
4. Restart Obsidian, or reload Community Plugins in Settings.

Once the plugin is listed in the community directory, you can also install it directly from the in-app marketplace.

### Prerequisites

- **Desktop Obsidian only** (not available on mobile).
- **`svn` command** — required to operate the SVN working copy (snapshot sync / commits). Everything else is provided by Obsidian's built-in runtime.

### Quick Start

1. Click the **📋 Project overview** ribbon icon (or run the "Open project overview" command).
2. If templates / rules / contact book / requirement directory are missing, a banner offers **"⚡ Generate samples"** — click it to create a minimal example under `AI-PM-TOOL/` and auto-configure the settings. Existing files are never overwritten (idempotent).
3. In Settings, point the requirement directory / contact book / template directory at your own folders if you have them, and fill in your name under "Current user" (used by "My tasks").

### Usage

#### Project overview

The sidebar shows dynamic stats across project status / requirement status / approvals, filterable tabs with counts, search, and "My tasks". Run **Manual sync** (SVN snapshot comparison) to pull the latest working-copy changes into the view.

#### Progress updates

Open a milestone node → fill in progress notes / project status / planned launch date → preview the change (old → new) → click **"Commit to SVN"** (writes frontmatter + `svn commit`).

#### Milestone emails

From a milestone node: ① **LLM draft** (falls back to a template when no model is configured) → ② **preview & edit** (recipients from your contact book + stakeholders, subject/body editable, attachments per-file) → ③ **send & record** (flags the milestone, archives the sent body into the note, then commit to SVN). Configure SMTP in Settings to actually send; without SMTP the flow only records the draft as sent-acknowledged.

#### LLM gateway

Settings → add an OpenAI-compatible provider (base URL, model, API key — stored in the system keychain via Obsidian SecretStorage). Multiple providers, one active; network mode: system proxy / direct / custom proxy.

### Commands & settings

- Commands: Open project overview / Manual sync (SVN snapshot comparison)
- Ribbon icon: 📋 Project overview
- Settings: custom models, network mode, requirement directory, current user, template directory, masking toggle, file logging

---

## Chinese / 中文

**AI PM Tool** 是一个 Obsidian 桌面插件：用大模型承担 PM 事务性工作——**任务即笔记、快照即历史（SVN）**，LLM 只产出分析/提醒，人工确认后落地。

### 权限与隐私

插件在您系统上的行为如实披露如下：

- **执行系统命令** ⚠️ — 通过 Node `child_process.execFile` 调用系统 **`svn` 命令行客户端**（无 shell 解析，仅固定参数数组）。仅在您**主动触发** SVN 操作时执行（手动同步 / 「提交SVN」/ 快照对比），且只对您的 SVN 工作副本执行命令；输入经校验以拦截命令注入与路径穿越，日志中的密码参数会被脱敏。插件不捆绑 svn，需您自行安装。
- **枚举 vault 文件** — 仅扫描**您配置的目录**（需求笔记目录、模板目录）下的 Markdown 文件，解析 frontmatter 用于项目总览；文件选择器仅在您主动打开时，列出**当前目录上下文**（通讯录所在目录，或模板目录）内的 Markdown 文件名供设置项选择，未选择前不读取任何内容。
- **读取 vault 文件** ✅ — 通过 Obsidian API 读取单个文件（`vault.read` / `vault.cachedRead`）。
- **写入 vault 文件** ✅ — 通过 Obsidian API 创建/修改文件（`vault.modify` / `vault.create`），仅限您在界面中确认的操作（生成示例、frontmatter 更新、发送记录留痕）。
- **网络** — 仅在您配置 SMTP 并点击发送时出站发信；仅向您配置的 LLM provider 发起 API 调用（密钥经 SecretStorage 存系统密钥库）。无遥测、无统计、无剪贴板访问。

**为何需要调用系统 `svn` 命令**

SVN 是独立版本控制系统，Obsidian 的 API 无法驱动它。同步 / 提交 / 快照对比必须调用系统 `svn` 命令行——没有其他可行路径，因此本插件如实披露而非隐藏该行为。调用面已压缩到最小：

- 仅使用 `child_process.execFile`——**不经过 shell**（`shell: false`），不用字符串拼接命令；每次调用都是固定的 `svn` 可执行文件 + 静态参数数组（路径与提交备注作为独立 argv 传入）。
- **不捆绑、不下载** svn——自动探测 PATH / 常见安装位置，或由您自行配置路径；svn 缺失时 SVN 功能优雅降级，不执行任何命令。
- 每次调用前做输入校验：拒绝 shell 元字符、路径穿越与注释；提交备注校验非法控制字符；日志中密码脱敏。
- 每次调用有边界：60 秒超时、`windowsHide: true`、输出有上限；仅在您**主动触发**时执行（手动同步 / 「提交SVN」/ 快照对比），且只作用于您的 SVN 工作副本。
- 该通道不会读取或修改工作副本以外的任何内容，也绝不会根据笔记内容拼装命令字符串。

**当前稳定版本**：`0.0.3`

**最新发布页**：https://github.com/caesarloo/ai-pm-tool/releases

### 安装

1. 打开[最新发布页](https://github.com/caesarloo/ai-pm-tool/releases)下载以下 3 个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在 vault 中创建插件目录：`<Vault>/.obsidian/plugins/ai-pm-tool/`
3. 将 3 个文件复制到该目录。
4. 重启 Obsidian，或在「第三方插件」中重新加载插件。

上架社区目录后，也可直接在应用内市场安装。

### 前置条件

- 仅支持桌面端 Obsidian（移动端不可用）。
- 需要装有 `svn` 命令的主机（用于 SVN 工作副本同步/提交）。其余运行环境由 Obsidian 内置运行时提供。

### 快速开始

1. 点击功能区 **📋 项目总览** 图标（或运行「打开项目总览」命令）。
2. 若检测到模板/规则/通讯录/需求目录缺失，顶部出现「⚡ 一键生成示例」横幅——点击即在 vault 根生成极简示例 `AI-PM-TOOL/` 并自动配置对应设置（幂等：已存在的文件不会被覆盖）。
3. 如有自己的目录，在设置中把需求笔记目录/通讯录/模板目录指过去，并填写「当前用户」（我的任务用）。

### 使用说明

#### 项目总览

侧边栏展示项目状态/需求状态/审批三维度动态统计、筛选 Tab（含计数）、搜索、「我的任务」。执行**手动同步（SVN 快照对比）**拉取最新工作副本变更。

#### 进展更新

打开环节节点 → 填写进展说明/项目状态/计划上线日期 → 预览变更（旧→新）→ 点击「⬆️ 提交SVN」（写 frontmatter + `svn commit`）。

#### 节点邮件

从进展页节点进入：① **LLM 生成草稿**（未配置模型时降级用模板草稿）→ ② **预览确认**（收件人来自通讯录+干系人，主题/正文可编辑、附件单独添加/移除）→ ③ **发送回写**（标记环节、正文发送记录存档、提交 SVN）。设置中配置 SMTP 后真实发信；未配置则仅回写留痕。

#### LLM 网关

设置 → 添加 OpenAI 兼容 provider（地址/模型/API Key——密钥存 Obsidian SecretStorage 系统密钥库）。支持多 provider 单选启用；网络方式：跟随系统代理/直连/自定义代理。

### 命令与设置

- 命令：打开项目总览 / 手动同步（SVN 快照对比）
- 功能区图标：📋 项目总览
- 设置：自定义模型、网络方式、需求笔记目录、当前用户、正文模板目录、脱敏开关、日志输出到文件

---

**Repo**: https://github.com/caesarloo/ai-pm-tool
