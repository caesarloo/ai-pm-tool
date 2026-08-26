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

/** 10 个邮件节点（frontmatter 标志位，来自产品需求模板）
 * 顺序：测试案例评审在项目准入之后、上线审核之前一步（2026-08 调整） */
export type MailNode = { key: string; label: string; optional?: boolean };
export const MAIL_NODES: readonly MailNode[] = [
  { key: "需求评审邮件", label: "需求评审" },
  { key: "工作量评估邮件", label: "工作量评估" },
  { key: "项目准入邮件", label: "项目准入（开发准入）" },
  { key: "测试案例评审", label: "测试案例评审" },
  { key: "上线审核邮件", label: "上线审核" },
  { key: "报备客服邮件", label: "报备客服" },
  { key: "生产验证邮件", label: "生产验证" },
  { key: "生产监控邮件", label: "生产监控" },
  { key: "商户接入文档评审邮件", label: "商户接入文档评审", optional: true },
  { key: "商户上线申请单评审邮件", label: "商户上线申请单评审", optional: true },
];

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
  mailFlags: Record<string, boolean>; // 10 个邮件标志
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
}

/** 插件设置（§5 / §6 附件模板目录） */
export interface AIPMSettings {
  llmProviders: LLMProvider[];
  activeProviderId: string | null; // 单选启用
  // 附件模板目录（§6）；留空 = 不使用邮件模板（LLM 生成或通用草稿）
  attachmentTemplateDir: string; // 默认 邮件附件模板
  // 通讯录名单路径（vault 相对路径；留空 = 不加载通讯录、不做邮箱匹配）
  contactBookPath: string;
  // 仓库目录约定（§4.1）；留空 = 总览为空并在视图中提示选择目录
  requirementDir: string; // 默认 产品需求
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
  attachmentTemplateDir: "邮件附件模板",
  contactBookPath: "",
  requirementDir: "产品需求",
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
