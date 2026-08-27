/**
 * AI PM Tool · 插件入口
 * - 注册：侧边栏状态总览视图、手动同步命令、进展更新入口、设置页
 * - LLM 网关：多 provider 单选启用 + 系统代理 + 脱敏（§5）
 * - 运行环境：装有 svn 命令的主机（SVN 工作副本仓库，isDesktopOnly）
 */
import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, type AIPMSettings, type LLMProvider } from "./types";
import { LLMGateway } from "./llm/gateway";
import { STATUS_VIEW_TYPE, StatusView } from "./view/StatusView";
import { AIPMSettingTab } from "./settings";
import { initLogger, setFileLogEnabled } from "./utils/logger";
import { secretRef, secretRefId, secretStorageId } from "./utils/secure";
import { loadRules, builtinRules, RULES_FILE_NAME, type ProjectRules, type RuleStage } from "./rules";
import { ensureMinimalSetup, SEED_DIR } from "./setup/seed";
import { log } from "./utils/logger";

export default class AIPMTool extends Plugin {
  settings: AIPMSettings = { ...DEFAULT_SETTINGS };
  gateway: LLMGateway | null = null;
  /** 项目进展规则（01-AI-PM-TOOL规则文件.md 解析结果；null = 未加载，视图访问时回退内置默认） */
  rules: ProjectRules | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.gateway = new LLMGateway(this.settings);
    // 文件日志（插件目录 ai-pm-tool.log；默认关，由设置项控制；经 vault DataAdapter 写入）
    initLogger(this.app);
    setFileLogEnabled(this.settings.logToFile);
    // 项目进展规则（模板目录下 01-AI-PM-TOOL规则文件.md；失败回退内置默认）
    void this.loadRulesOnce();

    // 侧边栏状态总览视图（§4.3）
    this.registerView(STATUS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new StatusView(leaf, this));

    // 功能区图标
    this.addRibbonIcon("list-checks", "AI PM Tool · 项目总览", () => this.activateStatusView());

    // 命令（§4.2 手动触发，无后台定时任务）
    this.addCommand({
      id: "open-status-view",
      name: "打开项目总览",
      callback: () => this.activateStatusView(),
    });
    this.addCommand({
      id: "manual-sync",
      name: "手动同步（SVN 快照对比）",
      callback: () => {
        const view = this.getStatusView();
        if (view) void view.sync();
        else {
          void this.activateStatusView().then(() => {
            const v = this.getStatusView();
            if (v) void v.sync();
          });
        }
      },
    });

    this.addSettingTab(new AIPMSettingTab(this.app, this));
  }

  /** 当前用户（「我的任务」/「我」徽标，§4.3） */
  currentUser(): string {
    return this.settings.currentUser?.trim() ?? "";
  }

  /** 加载项目进展规则（模板目录下 01-AI-PM-TOOL规则文件.md）；失败/缺失时 rules=null（视图回退内置默认） */
  async loadRulesOnce(): Promise<void> {
    this.rules = (await loadRules(this.app, this.settings.attachmentTemplateDir)) ?? null;
  }

  /**
   * 一键生成极简模板/规则（新装即用）：生成种子到 AI-PM-TOOL/ 并自动配置设置。
   * - 入口：项目总览顶部横幅「⚡ 一键生成示例」/ 设置页「生成/补齐模板与规则」按钮
   * - 幂等：已存在的文件不覆盖，只补齐缺失；设置仅在对应路径缺失时调整
   * - manual=true 时 Notice 显示本次创建的文件明细
   */
  async ensureSeed(manual = false): Promise<void> {
    try {
      const result = await ensureMinimalSetup(this.app, this.settings);
      if (result.settingsChanged) await this.saveSettings();
      if (result.createdFiles.length > 0) {
        await this.loadRulesOnce();
        const detail = manual ? `，已生成：${result.createdFiles.map((p) => p.replace(new RegExp(`^${SEED_DIR}/`), "")).join("、")}` : "";
        new Notice(`已生成极简模板与规则（${SEED_DIR}/）${detail}，详见 00-README.md`, 8000);
      } else if (manual) {
        new Notice("模板与规则已齐全（AI-PM-TOOL/ 下文件均已存在，未覆盖任何文件）", 4000);
      }
    } catch (e) {
      log.warn(`极简模板生成失败：${(e as Error).message}`);
    }
  }

  /** 项目环节（规则文件驱动；缺失时内置默认） */
  stages(): RuleStage[] {
    return this.rules?.stages ?? builtinRules().stages;
  }

  /** 当前生效规则（规则文件解析结果；缺失时内置默认） */
  rulesOrBuiltin(): ProjectRules {
    return this.rules ?? builtinRules();
  }

  /** 规则文件 vault 相对路径（<模板目录>/01-AI-PM-TOOL规则文件.md）；模板目录留空返回 null */
  rulesFilePath(): string | null {
    const dir = this.settings.attachmentTemplateDir?.trim().replace(/^\/+|\/+$/g, "");
    if (!dir) return null;
    return `${dir}/${RULES_FILE_NAME}`;
  }

  async activateStatusView(): Promise<void> {
    const existing = this.getStatusView();
    if (existing) {
      await this.app.workspace.revealLeaf(existing.leaf);
      void existing.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("无法创建侧边栏面板");
      return;
    }
    await leaf.setViewState({ type: STATUS_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private getStatusView(): StatusView | null {
    for (const leaf of this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE)) {
      if (leaf.view instanceof StatusView) return leaf.view;
    }
    return null;
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<AIPMSettings> | null;
    const merged: AIPMSettings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    // 逐字段兜底：data.json 被手改/旧版本缺字段时不抛错
    merged.llmProviders = Array.isArray(merged.llmProviders) ? merged.llmProviders : [];
    merged.activeProviderId = typeof merged.activeProviderId === "string" ? merged.activeProviderId : null;
    merged.attachmentTemplateDir =
      typeof merged.attachmentTemplateDir === "string" ? merged.attachmentTemplateDir : DEFAULT_SETTINGS.attachmentTemplateDir;
    merged.contactBookPath = typeof merged.contactBookPath === "string" ? merged.contactBookPath : "";
    merged.requirementDir = typeof merged.requirementDir === "string" ? merged.requirementDir : DEFAULT_SETTINGS.requirementDir;
    merged.currentUser = typeof merged.currentUser === "string" ? merged.currentUser : "";
    merged.maskSensitive = typeof merged.maskSensitive === "boolean" ? merged.maskSensitive : true;
    merged.llmProxyMode =
      merged.llmProxyMode === "direct" || merged.llmProxyMode === "custom" ? merged.llmProxyMode : "system";
    merged.llmProxyUrl = typeof merged.llmProxyUrl === "string" ? merged.llmProxyUrl : "";
    merged.smtpHost = typeof merged.smtpHost === "string" ? merged.smtpHost : "";
    merged.smtpPort = typeof merged.smtpPort === "number" && merged.smtpPort > 0 ? merged.smtpPort : 25;
    merged.smtpEncryption =
      merged.smtpEncryption === "tls" || merged.smtpEncryption === "starttls" ? merged.smtpEncryption : "none";
    merged.smtpUser = typeof merged.smtpUser === "string" ? merged.smtpUser : "";
    merged.smtpPass = typeof merged.smtpPass === "string" ? merged.smtpPass : "";
    merged.smtpFrom = typeof merged.smtpFrom === "string" ? merged.smtpFrom : "";
    merged.smtpFromName = typeof merged.smtpFromName === "string" ? merged.smtpFromName : "";
    merged.smtpSkipTlsVerify = typeof merged.smtpSkipTlsVerify === "boolean" ? merged.smtpSkipTlsVerify : false;
    merged.logToFile = typeof merged.logToFile === "boolean" ? merged.logToFile : false;
    // 敏感字段（SMTP 账号/密码/发件人/发件人名称、当前用户、模型 API Key）统一存 Obsidian SecretStorage：
    // 引用（secret:v1:<id>）经 app.secretStorage 读取；明文旧数据原样返回（下次保存自动迁移为引用）
    merged.smtpUser = this.resolveSecret(merged.smtpUser);
    merged.smtpPass = this.resolveSecret(merged.smtpPass);
    merged.smtpFrom = this.resolveSecret(merged.smtpFrom);
    merged.smtpFromName = this.resolveSecret(merged.smtpFromName);
    merged.currentUser = this.resolveSecret(merged.currentUser);
    // 元素级清洗：data.json 被手改/旧版本写入 null/非对象元素时不抛错（发布审核 P1-4）
    merged.llmProviders = (merged.llmProviders as unknown[])
      .filter((p): p is LLMProvider => !!p && typeof p === "object")
      .map((p) => ({
        ...p,
        apiKey: typeof p.apiKey === "string" && p.apiKey ? this.resolveSecret(p.apiKey) : "",
      }));
    this.settings = merged;
  }

  /** 读取单个存储值：SecretStorage 引用 → app.secretStorage.getSecret；否则视为明文旧数据原样返回。
   *  密钥环中找不到引用对应密钥时返回空串并弹 Notice 提示重新输入（避免把引用字符串当真实值发出导致 401 难排查）。 */
  private resolveSecret(stored: string): string {
    const refId = secretRefId(stored);
    if (refId !== null) {
      try {
        const v = this.app.secretStorage?.getSecret(refId) ?? null;
        if (v !== null) return v;
        new Notice("⚠️ 系统密钥库中未找到已保存的密钥，请在设置中重新输入（API key / SMTP 密码）", 8000);
        log.warn(`SecretStorage 未找到密钥「${refId}」：请在设置中重新输入`);
      } catch (e) {
        new Notice(`⚠️ 读取系统密钥库失败：${(e as Error).message}，请在设置中重新输入`, 8000);
        log.warn(`SecretStorage 读取失败（${refId}）：${(e as Error).message}`);
      }
      return "";
    }
    return stored;
  }

  async saveSettings(): Promise<void> {
    // 敏感字段（SMTP 账号/密码/发件人、模型 API Key）统一存 Obsidian 官方密钥库（SecretStorage），
    // data.json 只保存引用 secret:v1:<id>；明文旧数据（含历史邮箱明文）本次保存自动迁移为引用
    const copy: AIPMSettings = { ...this.settings };
    const save = (
      field: "smtp-user" | "smtp-pass" | "smtp-from" | "smtp-from-name" | "current-user" | "provider",
      providerId: string | undefined,
      plain: string
    ): string => {
      if (!plain) return "";
      if (secretRefId(plain) !== null) return plain; // 已是引用（密钥环缺失时的保留值）：原样保留，不重复写入
      const id = secretStorageId(field, providerId);
      if (!this.app.secretStorage) {
        log.warn(`SecretStorage 不可用（${id}）：该密钥将按明文保存`);
        return plain;
      }
      try {
        this.app.secretStorage.setSecret(id, plain);
      } catch (e) {
        log.warn(`SecretStorage 写入失败（${id}），该密钥将按明文保存：${(e as Error).message}`);
        return plain;
      }
      return secretRef(id);
    };
    copy.smtpUser = save("smtp-user", undefined, this.settings.smtpUser);
    copy.smtpPass = save("smtp-pass", undefined, this.settings.smtpPass);
    copy.smtpFrom = save("smtp-from", undefined, this.settings.smtpFrom);
    copy.smtpFromName = save("smtp-from-name", undefined, this.settings.smtpFromName);
    copy.currentUser = save("current-user", undefined, this.settings.currentUser);
    copy.llmProviders = this.settings.llmProviders.map((p) => ({
      ...p,
      apiKey: p.apiKey ? save("provider", p.id, p.apiKey) : p.apiKey,
    }));
    await this.saveData(copy);
  }
}
