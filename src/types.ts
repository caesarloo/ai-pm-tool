/**
 * AI PM Tool · 共享类型定义
 * 状态枚举以仓库真实数据为准（需求 §4.2 / §6，2026-08 统计确认）。
 */

/** 需求笔记「项目状态」真实枚举（228 项统计） */
export const PROJECT_STATUSES = [
  "未开始",
  "进行中",
  "已上线",
  "暂停",
  "终止",
  "忽略",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** 需求笔记「需求状态」真实枚举 */
export const REQUEST_STATUSES = [
  "未开始",
  "已评审通过",
  "不涉及",
  "取消",
  "进行中",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** 干系人角色字段（收件人自动提取，§4.6） */
export const STAKEHOLDER_ROLES = [
  "项目经理",
  "产品经理",
  "技术经理",
  "业务对接人",
] as const;

/** 解析后的需求笔记 */
export interface RequirementNote {
  path: string; // 仓库内相对路径，如 产品需求/xxx.md
  name: string; // 笔记名（文件名，去 .md）
  requestStatus: string | null; // 需求状态（可能为空）
  projectStatus: string | null; // 项目状态（可能为空）
  roles: Record<string, string[]>; // 角色 -> 人员列表
  effort: string | null; // 预估工作量
  reviewDate: string | null; // 需求评审日期
  devStartDate: string | null; // 开发投入日期
  planOnlineDate: string | null; // 计划上线日期
  progress: string | null; // 进展说明
  keyProject: boolean; // 重点项目
  mailFlags: Record<string, boolean>; // 邮件环节标志（键集 = 当前动态环节 stages 的 key）
  raw: Record<string, unknown>; // 原始 frontmatter
}

/** 统计聚合结果：状态值 -> 计数（有序，按出现次数降序） */
export type StatusCount = { value: string; count: number }[];

/** SVN 变更条目（§4.4：文件/字段/基线/工作区 + 提交者与版本号） */
export interface ChangeItem {
  file: string;
  field: string;
  base: string; // r旧
  work: string; // r新
  author: string;
  revision: string;
}

/** SVN 快照信息（面板底部展示） */
export interface SnapshotInfo {
  revision: string;
  date: string; // 最近同步时间
  changedFiles: number;
}

/** LLM provider（§5：自定义模型，可配置多个、单选启用一个） */
export interface LLMProvider {
  id: string;
  name: string; // 如 SMB、火山
  baseUrl: string; // OpenAI 兼容地址，如 http://10.x.x.x:8000/v1
  model: string; // 模型名
  apiKey?: string; // 密钥，本地保存
  /** 实测可用的 max_tokens 上限（设置页「测试上限」探测结果保存于此；未测 = 插件用内置安全默认 4000/6000） */
  maxOutputTokens?: number;
}

/** 插件设置（§5 / §6 附件模板目录） */
export interface AIPMSettings {
  llmProviders: LLMProvider[];
  activeProviderId: string | null; // 单选启用
  // 附件模板目录（§6）；默认空 = 未配置：不使用邮件模板（LLM 生成或通用草稿）、不加载规则文件（视图用内置默认）
  attachmentTemplateDir: string;
  // 通讯录名单路径（vault 相对路径；默认空 = 不加载通讯录、不做邮箱匹配）
  contactBookPath: string;
  // ✨ 新增需求（P1 · 0.1.0）：
  // 需求笔记模板路径（vault 相对路径；默认空 = 未配置：预检提示先配置；
  // 「✨ 新增需求」用 Templater 真实执行该模板生成骨架：
  // frontmatter 全字段/默认值 + 模板日期计算 + 正文邮件小节——模板更新自动跟随，插件不重复内置字段清单）
  requirementTemplatePath: string; // 需求笔记模板（vault 相对路径）
  // 需求审核 SKILL 路径（vault 文件；读取后仅提取审核章节作三项校验（预期价值/需求名称/业务分类）上下文；
  // 留空 = 不做内容审核；缺失/不可用时自动跳过且不阻塞创建）
  reviewSkillPath: string;
  // 需求内容生成 SKILL 路径（vault 文件，公司口径的需求内容生成规则；
  // 「✨ 新增需求」LLM 生成文件名与字段的规则源（财务编码 + 公司产品线/部门映射 + 重点项目清单）；
  // 留空 = 无公司口径：命名用通用三段式说明、名称/列表 R 校验跳过（不回退审核 SKILL 数据）；审核仍由 reviewSkillPath 负责）
  contentSkillPath: string;
  // 仓库目录约定（§4.1）；默认空 = 未配置：总览为空并在视图中提示选择目录
  requirementDir: string;
  // 脱敏（§5）
  maskSensitive: boolean; // 默认 true
  // 网络方式（§5 LLM 请求）：跟随系统代理 / 直连无代理 / 自定义代理
  llmProxyMode: "system" | "direct" | "custom"; // 默认 system
  llmProxyUrl: string; // 自定义代理地址，如 http://127.0.0.1:7897
  // 当前用户（「我的任务」Tab 与「我」徽标，§4.3；存 Obsidian SecretStorage，设置页隐位展示）
  currentUser: string;
  // SMTP 邮件发送（§4.6）：未配置时点击发送仅回写留痕
  smtpHost: string; // SMTP 服务器，如 smtp.example.com
  smtpPort: number; // 25(无加密) / 465(TLS) / 587(STARTTLS)
  smtpEncryption: "none" | "starttls" | "tls"; // 加密方式（默认 无加密）
  smtpUser: string; // 登录账号（存 Obsidian SecretStorage，设置页掩码展示）
  smtpPass: string; // 密码/授权码（存 Obsidian SecretStorage）
  smtpFrom: string; // 发件人邮箱（存 Obsidian SecretStorage，设置页掩码展示）
  smtpFromName: string; // 发件人名称（存 Obsidian SecretStorage，设置页隐位展示；中文自动 RFC2047 编码）
  smtpSkipTlsVerify: boolean; // 忽略 SMTP TLS 证书校验（自签名/内网证书服务器专用；默认关 = 校验证书）
  // 调试日志（默认关）
  logToFile: boolean; // 输出到插件目录 ai-pm-tool.log
}

export const DEFAULT_SETTINGS: AIPMSettings = {
  llmProviders: [],
  activeProviderId: null,
  // 路径类设置默认空（未配置）：不预设任何 vault 路径，对应功能在未配置时直接跳过/提示
  attachmentTemplateDir: "",
  contactBookPath: "",
  requirementTemplatePath: "",
  reviewSkillPath: "",
  contentSkillPath: "",
  requirementDir: "",
  maskSensitive: true,
  llmProxyMode: "system",
  llmProxyUrl: "",
  currentUser: "",
  smtpHost: "",
  smtpPort: 25,
  smtpEncryption: "none",
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  smtpFromName: "",
  smtpSkipTlsVerify: false,
  logToFile: false,
};
