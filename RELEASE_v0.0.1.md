# AI PM Tool v0.0.1

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-08-26

### Initial Release

AI PM Tool offloads PM busywork to an LLM: **notes as tasks, SVN snapshots as history**. Requirement notes become a live project overview, and milestone emails go out through SMTP — everything is confirmed by a human first.

### Features

1. **Note parsing** — simplified frontmatter YAML parsing, tolerant of missing fields and new-format variants
2. **SVN snapshots** — manual sync: `svn update` → `svn log/diff` → changes
3. **Project overview** — sidebar with dynamic stats, filter tabs, search, "My tasks"
4. **Progress updates** — milestone timeline + change preview + "Commit to SVN"
5. **Milestone emails** — LLM draft → preview → SMTP send → write-back + `svn commit`
6. **LLM gateway** — OpenAI-compatible, multiple providers, system proxy / direct / custom proxy
7. **First-run setup** — one-click generation of minimal templates/rules (idempotent)

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-08-26

### 首个版本发布

AI PM Tool 将 PM 事务性工作交给大模型：**任务即笔记、快照即历史（SVN）**。需求笔记变成实时项目总览，节点邮件经 SMTP 真实发送——一切由人工确认后落地。

### 功能清单

1. 需求笔记解析（frontmatter 简化 YAML，字段缺失容错）
2. SVN 快照对比（手动同步：`svn update` → `svn log/diff`）
3. 项目总览（三维度动态统计、筛选 Tab、搜索、「我的任务」）
4. 进展更新（环节时间轴 + 变更预览 +「提交 SVN」）
5. 节点邮件（LLM 草稿 → 预览确认 → SMTP 发送 → 回写留痕 + `svn commit`）
6. LLM 网关（OpenAI 兼容、多 provider 单选、系统代理/直连/自定义代理）
7. 新装引导（一键生成极简模板/规则，幂等不覆盖）

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
