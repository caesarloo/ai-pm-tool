/**
 * 极简模板与规则种子（社区发布 / 新装用户「新装即用」）
 * - 首次启用且未检测到规则文件时自动生成；设置页「生成/补齐模板与规则」按钮可手动触发
 * - 幂等：已存在的文件一律不覆盖（保护用户修改），只补齐缺失文件
 * - 生成位置：vault 根 AI-PM-TOOL/（规则文件 + 邮件模板/ + 需求笔记/ + 通讯录名单.md + 00-README.md）
 * - 设置联动：模板目录 / 通讯录名单路径 / 需求笔记目录 在各自缺失时自动指向种子内容
 */
import { App, TFile } from "obsidian";
import type { AIPMSettings } from "../types";
import { log } from "../utils/logger";
import { RULES_FILE_NAME } from "../rules";

/** 极简种子目录（vault 根下） */
export const SEED_DIR = "AI-PM-TOOL";

/** 邮件模板示例文件名（文件名含节点标志「需求评审邮件」即被 MailModal 命中） */
export const SEED_MAIL_TEMPLATE_NAME = "01-需求评审邮件.md";

/** 示例需求笔记文件名（需求目录下演示数据） */
export const SEED_SAMPLE_NOTE_NAME = "示例需求.md";

/** 极简规则文件内容（2 个示例环节；解析结构与内置默认一致，可自由增删改） */
export const SEED_RULES_FILE = `# AI-PM-TOOL规则文件

> 本文件由插件自动生成（极简示例），可自由增删改：插件按小节标题与表头列名解析，
> 文件缺失/解析失败时回退内置默认。修改后重启插件或重开 Obsidian 生效。

## 一、项目环节

| 序号 | 环节 | frontmatter 邮件标志 | 可选 |
| --- | --- | --- | --- |
| 1 | 需求评审 | 需求评审邮件 | |

- **当前环节** = 第一个未完成节点（标志非 true）；邮件发送回写标志置 true 后自动推进到下一环节。
- 每个环节对应一个邮件节点：在进展弹窗时间轴当前环节点「✉️ 发起邮件」进入邮件引擎。
- 想用更多/更少的环节：增删表格行即可（「可选」列填「✅ 可选」标记可选环节）。

## 二、项目进展（进展弹窗四个展示区域）

### 2.1 上下文区（弹窗顶部）

| 序号 | 字段   | 来源（frontmatter）                  | 展示方式       |
| --- | ---- | ------------------------------ | ---------- |
| 1 | 项目名称 | 文件名                            | 链接（点击打开笔记） |
| 2 | 负责人  | 项目经理 / 产品经理 / 技术经理 / 业务对接人 | 角色人员合并展示   |
| 3 | 重点项目 | 重点项目                          | 标注（重点项目时显示） |

### 2.2 环节时间轴

由「一、项目环节」驱动：✅ 已完成 / ▶ 当前 / ○ 待进行，当前环节可「✉️ 发起邮件」。

### 2.3 只读字段区（frontmatter 只读展示，有值才显示）

| 序号 | 字段     | 来源（frontmatter） |
| --- | ------ | -------------- |
| 1 | 预估工作量  | 预估工作量          |
| 2 | 需求背景简述 | 需求背景简述         |
| 3 | 功能点    | 功能点            |

### 2.4 表单区（可编辑字段，按行序生成控件）

| 序号  | 字段     | 来源（frontmatter） | 控件   | 取值 / 格式                        | 写入风格     |
| --- | ------ | --------------- | ---- | ------------------------------ | -------- |
| 1   | 项目状态   | 项目状态            | 下拉   | 未开始 / 进行中 / 已上线 / 暂停 / 终止 / 忽略 | 列表（list） |
| 2   | 计划上线日期 | 计划上线日期          | 日期   | YYYY-MM-DD（可清空）                | 内联（inline） |
| 3   | 进展说明   | 进展说明            | 多行文本 | 自由文本（谁、做了什么、下一步）               | 内联（inline） |
`;

/** 邮件模板示例（## 主题 / ## 正文 小节，MailModal 解析结构） */
export const SEED_MAIL_TEMPLATE = `# 01 需求评审邮件模板

> 节点邮件模板示例：<模板目录>/邮件模板/ 下文件名包含节点 frontmatter 邮件标志即被插件命中。
> 未找到模板的节点自动使用通用草稿。复制本文件可创建其他节点模板（如 02-上线审核邮件.md）。

## 主题

【需求评审】[项目名称]

## 正文

各位好：

【[项目名称]】已完成需求评审，会议纪要如下，请查阅：

**1. 会议信息**
- 时间：[日期]
- 参会人：[参会人]

**2. 评审结论**
- [通过/需修订]

**3. 行动项**
- [责任人]：在 [日期] 前完成 [具体任务]

请查收，谢谢！
`;

/** 通讯录示例（姓名/邮箱 + 抄送名单两张表，parseContactBook 解析结构） */
export const SEED_CONTACT_BOOK = `# 通讯录名单

> 插件按「通讯录名单路径」读取本文件解析收件人：姓名 → 邮箱；「抄送名单」小节为部门邮件组（默认放入抄送）。
> 请把示例行替换为真实人员：姓名 + 邮箱。（旧版「姓名|工号|邮箱」三列文件仍可解析，工号列会被忽略）

## 收件人名单

| 姓名 | 邮箱 |
| --- | --- |
| 张三 | zhangsan@example.com |
| 李四 | lisi@example.com |

## 抄送名单

| 名称 | 邮箱 |
| --- | --- |
| 项目组 | project@example.com |
`;

/** 示例需求笔记（演示数据：项目总览卡片 + 进展弹窗 + 邮件流程；可删除） */
export const SEED_SAMPLE_NOTE = `---
项目状态: 进行中
需求状态: 已评审通过
重点项目: false
项目经理:
  - 张三
产品经理:
  - 李四
预估工作量: 5 人天
需求背景简述: 示例需求：演示插件完整流程（项目总览 → 项目进展 → 节点邮件）。熟悉后可删除本笔记。
功能点:
  - 功能点一：示例功能说明
  - 功能点二：示例功能说明
计划上线日期: 2026-06-30
进展说明: 已完成需求评审，进入开发准备
需求评审邮件: false
---

# 示例需求

> 演示数据（插件自动生成，可删除）：
> - 侧边栏「📋 项目总览」可看到本需求卡片；
> - 点卡片进入「项目进展」：编辑表单 → 变更预览 → 提交 SVN；
> - 时间轴当前环节（需求评审）点「✉️ 发起邮件」体验邮件流程。
> 复制本笔记可新建真实需求：修改 frontmatter 字段与正文即可。

## 需求背景

（在这里描述需求背景……）

## 功能点

- 功能点一：示例功能说明
- 功能点二：示例功能说明

## 实施计划

- 计划上线日期：2026-06-30
`;

/** 使用说明（目录结构 + 快速开始 + 设置联动 + 规则文件说明） */
export const SEED_README = `# AI-PM-TOOL · 极简模板与规则

> 本目录由插件自动生成，用于「新装即用」演示，可整体删除。
> 生成是幂等的：已存在的文件不会被覆盖，只补齐缺失文件。

## 目录结构

\`\`\`
AI-PM-TOOL/
├── 00-README.md               # 本说明
├── 01-AI-PM-TOOL规则文件.md   # 项目进展规则（环节顺序 + 进展弹窗四区域）
├── 需求笔记/                   # 需求笔记目录（项目总览扫描此目录）
│   └── 示例需求.md             # 演示数据，可删除
├── 邮件模板/                   # 节点邮件正文模板（文件名含节点标志即命中）
│   └── 01-需求评审邮件.md
└── 通讯录名单.md               # 收件人/抄送解析（收件人名单 + 抄送名单）
\`\`\`

## 快速开始

1. 侧边栏点「📋 项目总览」→ 看到「示例需求」卡片
2. 点卡片进入「项目进展」→ 编辑表单 → 变更预览 → 提交 SVN（需装有 svn 命令的主机）
3. 时间轴当前环节点「✉️ 发起邮件」→ 生成草稿（未配置模型时用模板草稿）；配置 SMTP 后真实发送
4. 复制「示例需求.md」新建真实需求笔记；按需修改规则文件与邮件模板

## 插件设置联动

| 插件设置项 | 本目录对应 |
| --- | --- |
| 模板目录 | AI-PM-TOOL |
| 通讯录名单路径 | AI-PM-TOOL/通讯录名单.md |
| 需求笔记目录 | AI-PM-TOOL/需求笔记 |

## 规则文件（01-AI-PM-TOOL规则文件.md）

- 「一、项目环节」→ 环节顺序与名称（进展弹窗时间轴、邮件节点）；增删表格行即可调整流程
- 「二、项目进展」→ 仅控制进展弹窗四个展示区域；不影响项目总览的卡片与筛选
- 文件缺失/解析失败时插件回退内置默认
`;

/** 初始化结果：本次创建的文件 + 是否调整了设置 */
export interface SeedResult {
  createdFiles: string[]; // 本次创建的文件（vault 相对路径）
  settingsChanged: boolean; // 是否自动调整了模板目录/通讯录/需求目录设置
}

/** 缺失检测结果（项目总览横幅提示「一键生成示例」） */
export interface SeedMissing {
  missingRules: boolean; // 模板目录下无规则文件
  missingContactBook: boolean; // 通讯录路径为空或文件不存在
  missingRequirementDir: boolean; // 需求笔记目录为空或不存在
  any: boolean;
}

/** 检测模板/规则/通讯录/需求目录是否缺失（同步；设置未配置或指向的文件/目录不存在即为缺失） */
export function checkSeedMissing(app: App, settings: AIPMSettings): SeedMissing {
  const tplDir = settings.attachmentTemplateDir?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const missingRules = !(tplDir !== "" && app.vault.getAbstractFileByPath(`${tplDir}/${RULES_FILE_NAME}`) instanceof TFile);
  const cb = settings.contactBookPath?.trim() ?? "";
  const missingContactBook = !(cb !== "" && app.vault.getAbstractFileByPath(cb) instanceof TFile);
  const reqDir = settings.requirementDir?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const missingRequirementDir = !(reqDir !== "" && app.vault.getAbstractFileByPath(reqDir) !== null);
  return { missingRules, missingContactBook, missingRequirementDir, any: missingRules || missingContactBook || missingRequirementDir };
}

/**
 * 生成/补齐极简模板与规则（幂等：已存在文件不覆盖，只补齐缺失）。
 * - 固定生成：规则文件、邮件模板示例、通讯录示例、00-README（AI-PM-TOOL/ 下）
 * - 设置联动（各自缺失时）：模板目录 → AI-PM-TOOL；通讯录路径 → AI-PM-TOOL/通讯录名单.md；
 *   需求笔记目录 → AI-PM-TOOL/需求笔记（并生成示例需求笔记，仅当需求目录被重置为种子目录时）
 */
export async function ensureMinimalSetup(app: App, settings: AIPMSettings): Promise<SeedResult> {
  const created: string[] = [];
  const create = async (path: string, content: string): Promise<void> => {
    if (app.vault.getAbstractFileByPath(path) instanceof TFile) return; // 已存在不覆盖
    try {
      await app.vault.create(path, content);
      created.push(path);
      log.debug(`已生成模板文件：${path}`);
    } catch (e) {
      log.warn(`生成模板文件失败：${path}（${(e as Error).message}）`);
    }
  };

  // ① 规则文件（模板目录核心，<模板目录>/01-AI-PM-TOOL规则文件.md）
  await create(`${SEED_DIR}/${RULES_FILE_NAME}`, SEED_RULES_FILE);
  // ② 邮件模板示例（<模板目录>/邮件模板/<文件名含节点标志>.md）
  await create(`${SEED_DIR}/邮件模板/${SEED_MAIL_TEMPLATE_NAME}`, SEED_MAIL_TEMPLATE);
  // ③ 通讯录示例
  await create(`${SEED_DIR}/通讯录名单.md`, SEED_CONTACT_BOOK);
  // ④ 使用说明
  await create(`${SEED_DIR}/00-README.md`, SEED_README);

  let settingsChanged = false;

  // 模板目录：未配置或配置的目录不存在（默认值/失效路径）→ 指向种子目录（全套生成）；
  // 已配置且目录存在但缺规则文件 → 保留用户设置，把极简规则文件补齐到原目录（规则生效、用户邮件模板不受影响）
  const tplDir = settings.attachmentTemplateDir?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const tplHasRules = tplDir !== "" && app.vault.getAbstractFileByPath(`${tplDir}/${RULES_FILE_NAME}`) instanceof TFile;
  const tplExists = tplDir !== "" && (app.vault.getAbstractFileByPath(tplDir) !== null || tplHasRules);
  if (!tplDir || !tplExists) {
    settings.attachmentTemplateDir = SEED_DIR;
    settingsChanged = true;
  } else if (!tplHasRules) {
    await create(`${tplDir}/${RULES_FILE_NAME}`, SEED_RULES_FILE);
  }

  // 通讯录路径：留空或文件不存在 → 指向种子通讯录
  const cb = settings.contactBookPath?.trim() ?? "";
  if (!cb || !(app.vault.getAbstractFileByPath(cb) instanceof TFile)) {
    settings.contactBookPath = `${SEED_DIR}/通讯录名单.md`;
    settingsChanged = true;
  }

  // 需求笔记目录：留空或目录不存在 → 指向种子需求目录（并生成示例笔记，不塞入用户已有目录）
  const reqDir = settings.requirementDir?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const reqExists = reqDir !== "" && app.vault.getAbstractFileByPath(reqDir) !== null;
  if (!reqExists) {
    settings.requirementDir = `${SEED_DIR}/需求笔记`;
    settingsChanged = true;
    await create(`${SEED_DIR}/需求笔记/${SEED_SAMPLE_NOTE_NAME}`, SEED_SAMPLE_NOTE);
  }

  return { createdFiles: created, settingsChanged };
}
