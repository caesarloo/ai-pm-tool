import { App, PluginSettingTab, Setting, SettingPage, TextComponent } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type AIPMTool from "./main";
import type { LLMProvider } from "./types";
import { setFileLogEnabled } from "./utils/logger";
import { maskAccount } from "./utils/secure";
import { FolderPickerModal } from "./view/FolderPickerModal";
import { FilePickerModal } from "./view/FilePickerModal";

// =====================================================================
// 共享：大模型 provider 管理渲染（ProviderSettingsPage 声明式页）
// =====================================================================

/** 渲染大模型 section（标题 + 提示 + provider 卡片列表 + 添加按钮） */
function renderProviderSection(containerEl: HTMLElement, plugin: AIPMTool, onRerender: () => void): void {
  containerEl.createEl("h3", { text: "🧠 大模型（自定义模型 · 可配置多个 · 仅启用一个）" });
  containerEl.createEl("p", {
    text: "OpenAI 兼容协议（/v1/chat/completions）；网络请求继承系统代理；密钥统一存入 Obsidian 官方密钥库（SecretStorage，跨平台），不写入仓库与 data.json。",
    cls: "ai-pm-hint",
  });

  const providerList = containerEl.createDiv({ cls: "ai-pm-provider-list" });
  renderProviders(plugin, onRerender, providerList);

  new Setting(containerEl).addButton((b) =>
    b.setButtonText("+ 添加自定义模型").onClick(async () => {
      const p: LLMProvider = {
        id: `p_${Date.now()}`,
        name: "新模型",
        baseUrl: "http://localhost:8000/v1",
        model: "model-name",
        apiKey: "",
      };
      plugin.settings.llmProviders.push(p);
      await plugin.saveSettings();
      onRerender();
    })
  );
}

/** 渲染 provider 卡片列表（单选启用 + 名称/地址/模型名/密钥 四行配置 + 删除） */
function renderProviders(plugin: AIPMTool, onRerender: () => void, providerList: HTMLElement): void {
  const { llmProviders, activeProviderId } = plugin.settings;
  if (llmProviders.length === 0) {
    providerList.createEl("p", { text: "尚未配置模型，点击下方按钮添加。", cls: "ai-pm-muted" });
    return;
  }
  llmProviders.forEach((p, i) => {
    let keyInput: TextComponent | null = null; // 密钥输入框（隐位展示，供 👁 切换）
    const card = providerList.createDiv({
      cls: `ai-pm-provider${p.id === activeProviderId ? " active" : ""}`,
    });

    // 卡片头部：单选启用 + 名称 + 删除
    const head = card.createDiv({ cls: "ai-pm-provider-head" });
    const radio = head.createEl("input", {
      type: "radio",
      attr: { name: "activeProvider", title: "启用此模型" },
    });
    radio.checked = p.id === activeProviderId;
    radio.addEventListener("change", () => {
      plugin.settings.activeProviderId = p.id;
      void plugin.saveSettings().then(() => onRerender());
    });
    const nameEl = head.createEl("span", { text: p.name || "（未命名）", cls: "ai-pm-provider-name" });
    const del = head.createEl("button", { cls: "ai-pm-provider-del", text: "✕" });
    del.title = "删除此模型";
    del.addEventListener("click", () => {
      plugin.settings.llmProviders.splice(i, 1);
      if (plugin.settings.activeProviderId === p.id) {
        plugin.settings.activeProviderId = null;
      }
      void plugin.saveSettings().then(() => onRerender());
    });

    // 四个参数：分四行配置
    new Setting(card)
      .setName("名称")
      .addText((t) =>
        t
          .setPlaceholder("如：smb、火山")
          .setValue(p.name)
          .onChange(async (v) => {
            p.name = v;
            nameEl.textContent = v || "（未命名）";
            await plugin.saveSettings();
          })
      );
    new Setting(card)
      .setName("地址（OpenAI 兼容）")
      .addText((t) =>
        t
          .setPlaceholder("如 HTTPS://api.example.com/v1")
          .setValue(p.baseUrl)
          .onChange(async (v) => {
            p.baseUrl = v;
            await plugin.saveSettings();
          })
      );
    new Setting(card)
      .setName("模型名")
      .addText((t) =>
        t
          .setPlaceholder("如 DeepSeek-V4-Flash")
          .setValue(p.model)
          .onChange(async (v) => {
            p.model = v;
            await plugin.saveSettings();
          })
      );
    new Setting(card)
      .setName("密钥")
      .addText((t) => {
        t.inputEl.type = "password"; // 隐位展示，防止旁观泄露
        t.inputEl.setAttribute("autocomplete", "off");
        t.setPlaceholder("API key").setValue(p.apiKey ?? "").onChange(async (v) => {
          p.apiKey = v;
          await plugin.saveSettings();
        });
        keyInput = t;
      })
      .addExtraButton((b) => {
        b.setIcon("eye").setTooltip("显示/隐藏密钥");
        b.onClick(() => {
          const input = keyInput?.inputEl;
          if (!input) return;
          const show = input.type === "password";
          input.type = show ? "text" : "password";
          b.setIcon(show ? "eye-off" : "eye");
        });
      });
  });
}

// =====================================================================
// 声明式设置：大模型自定义页（SettingPage 子类，供 getSettingDefinitions 引用）
// =====================================================================

class ProviderSettingsPage extends SettingPage {
  title = "🧠 大模型（自定义模型）";

  constructor(private plugin: AIPMTool) {
    super();
  }

  display(): void {
    this.containerEl.empty();
    renderProviderSection(this.containerEl, this.plugin, () => this.display());
  }
}

// =====================================================================
// 设置页
// =====================================================================

export class AIPMSettingTab extends PluginSettingTab {
  plugin: AIPMTool;

  constructor(app: App, plugin: AIPMTool) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** 隐位输入（密码样式 + 👁 切换），用于 SMTP 密码等存 SecretStorage 的敏感字段 */
  private addSecretInput(setting: Setting, value: string, onChange: (v: string) => void): void {
    let input: TextComponent | null = null;
    setting
      .addText((t) => {
        t.inputEl.type = "password";
        t.inputEl.setAttribute("autocomplete", "off");
        t.setPlaceholder("••••••••").setValue(value).onChange(onChange);
        input = t;
      })
      .addExtraButton((b) => {
        b.setIcon("eye").setTooltip("显示/隐藏");
        b.onClick(() => {
          const el = input?.inputEl;
          if (!el) return;
          const show = el.type === "password";
          el.type = show ? "text" : "password";
          b.setIcon(show ? "eye-off" : "eye");
        });
      });
  }

  /** 账号类字段（smtpUser/smtpFrom）：部分掩码——@ 前隐藏、@ 后正常；无 @ 显示后 3 位；聚焦或 👁 显示完整值 */
  private addAccountInput(setting: Setting, value: string, onChange: (v: string) => void): void {
    let input: TextComponent | null = null;
    let current = value; // 当前真实值（随输入更新）
    let revealed = false; // 👁 是否已展开
    setting
      .addText((t) => {
        t.inputEl.type = "text";
        t.inputEl.setAttribute("autocomplete", "off");
        t.setValue(maskAccount(value));
        t.setPlaceholder("••••••••");
        t.onChange((v) => {
          current = v;
          onChange(v);
        });
        const el = t.inputEl;
        el.addEventListener("focus", () => {
          if (!revealed) t.setValue(current); // 聚焦显示完整值便于编辑
        });
        el.addEventListener("blur", () => {
          if (!revealed) t.setValue(maskAccount(current)); // 失焦恢复部分掩码
        });
        input = t;
      })
      .addExtraButton((b) => {
        b.setIcon("eye").setTooltip("显示/隐藏完整值");
        b.onClick(() => {
          if (!input) return;
          revealed = !revealed;
          input.setValue(revealed ? current : maskAccount(current));
          b.setIcon(revealed ? "eye-off" : "eye");
        });
      });
  }

  /**
   * 「需求笔记目录」设置行：输入框 + 「选择目录」按钮 + 空值错误提示（留空时总览为空）。
   * 供声明式 render 使用。
   */
  private renderRequirementDir(setting: Setting): void {
    const syncError = (): void => {
      if (this.plugin.settings.requirementDir.trim()) {
        setting.setErrorMessage(null);
      } else {
        setting.setErrorMessage("需求笔记目录为空：项目总览将不显示任何需求，请选择或输入目录");
      }
    };
    syncError();
    let input: TextComponent | null = null;
    setting
      .addText((t) => {
        input = t;
        t.setPlaceholder("如 产品需求")
          .setValue(this.plugin.settings.requirementDir)
          .onChange(async (v) => {
            this.plugin.settings.requirementDir = v.trim();
            syncError();
            await this.plugin.saveSettings();
          });
      })
      .addButton((b) =>
        b.setButtonText("选择目录…").onClick(() => {
          new FolderPickerModal(this.app, (path) => {
            this.plugin.settings.requirementDir = path;
            input?.setValue(path);
            syncError();
            void this.plugin.saveSettings();
          }).open();
        })
      );
  }

  /**
   * 「模板目录」设置行：输入框 + 「选择目录」按钮（留空 = 不使用模板）。
   * 供声明式 render 使用。
   */
  private renderTemplateDir(setting: Setting): void {
    let input: TextComponent | null = null;
    setting
      .addText((t) => {
        input = t;
        t.setPlaceholder("如 产品需求模板")
          .setValue(this.plugin.settings.attachmentTemplateDir)
          .onChange(async (v) => {
            this.plugin.settings.attachmentTemplateDir = v.trim();
            await this.plugin.saveSettings();
          });
      })
      .addButton((b) =>
        b.setButtonText("选择目录…").onClick(() => {
          new FolderPickerModal(this.app, (path) => {
            this.plugin.settings.attachmentTemplateDir = path;
            input?.setValue(path);
            void this.plugin.saveSettings();
          }).open();
        })
      );
  }

  /**
   * 「通讯录名单路径」设置行：输入框 + 「选择文件」按钮（留空 = 不加载通讯录）。
   * 供声明式 render 使用。
   */
  private renderContactBookPath(setting: Setting): void {
    let input: TextComponent | null = null;
    setting
      .addText((t) => {
        input = t;
        t.setPlaceholder("如 产品需求模板/通讯录名单.md")
          .setValue(this.plugin.settings.contactBookPath)
          .onChange(async (v) => {
            this.plugin.settings.contactBookPath = v.trim();
            await this.plugin.saveSettings();
          });
      })
      .addButton((b) =>
        b.setButtonText("选择文件…").onClick(() => {
          // 目录上下文（Obsidian 审核合规：选择器仅枚举该目录，不走 vault.getFiles() 全库枚举）：
          // 优先「通讯录当前所在目录」，其次「邮件模板目录」；都没有 → 空列表（提示直接输入路径）
          const baseDir = this.contactBookPickerBaseDir();
          new FilePickerModal(
            this.app,
            (path) => {
              this.plugin.settings.contactBookPath = path;
              input?.setValue(path);
              void this.plugin.saveSettings();
            },
            baseDir
          ).open();
        })
      );
  }

  /** 通讯录文件选择器的枚举范围：优先「通讯录当前所在目录」，其次「邮件模板目录」；都没有 → 空串（仅提示手动输入） */
  private contactBookPickerBaseDir(): string {
    const cb = this.plugin.settings.contactBookPath.trim();
    if (cb) {
      const idx = cb.lastIndexOf("/");
      if (idx > 0) return cb.slice(0, idx);
    }
    return this.plugin.settings.attachmentTemplateDir.trim();
  }

  /**
   * 声明式设置定义（Obsidian 1.13.0+）：驱动设置页渲染与设置搜索。
   * 最低支持 Obsidian 1.13.0（见 manifest.json minAppVersion）。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    const save = (): Promise<void> => this.plugin.saveSettings();
    return [
      // 🧠 大模型：provider 管理走自定义页（动态卡片，命令式渲染）
      {
        type: "page",
        name: "大模型（自定义模型）",
        desc: "OpenAI 兼容模型配置：多 provider 单选启用；密钥统一存入 Obsidian SecretStorage（官方密钥库），不写入仓库与 data.json",
        aliases: ["LLM", "provider", "模型", "密钥"],
        page: () => new ProviderSettingsPage(this.plugin),
      },
      // 🌐 网络方式（LLM 请求）
      {
        name: "请求方式",
        desc: "跟随系统代理：用操作系统代理设置（内网代理场景常用）；直连：不走任何代理；自定义代理：指定代理地址（如 http://127.0.0.1:7897）",
        aliases: ["代理", "proxy", "网络"],
        control: {
          type: "dropdown",
          key: "llmProxyMode",
          options: { system: "跟随系统代理（默认）", direct: "直连（无代理）", custom: "自定义代理" },
        },
      },
      {
        name: "代理地址",
        desc: "仅「自定义代理」时生效；格式 http://主机:端口（支持 http/https 目标）",
        aliases: ["代理", "proxy"],
        control: { type: "text", key: "llmProxyUrl", disabled: () => s.llmProxyMode !== "custom" },
      },
      // 👤 当前用户（§4.3）
      {
        name: "我的姓名",
        desc: "用于「我的任务」Tab 与卡片「我」徽标（按负责人姓名匹配）。收件人邮箱与公共邮箱统一取自「通讯录名单路径」指定的通讯录；留空则不做邮箱匹配（收件人按姓名原样保留）。姓名存 Obsidian SecretStorage，设置页隐位展示",
        aliases: ["姓名", "用户", "我的任务"],
        render: (setting) =>
          this.addAccountInput(setting, s.currentUser, (v) => {
            s.currentUser = v.trim();
            void save();
          }),
      },
      // 📧 SMTP 邮件发送（§4.6）
      {
        name: "SMTP 服务器",
        desc: "如 smtp.example.com（465 = SSL/TLS）",
        control: { type: "text", key: "smtpHost" },
      },
      {
        name: "端口",
        desc: "默认 25（无加密）；465 = SSL/TLS 直连；587 = STARTTLS",
        control: { type: "number", key: "smtpPort", placeholder: "25", min: 1, max: 65535 },
      },
      {
        name: "加密方式",
        desc: "与端口对应：25 选 无加密，465 选 SSL/TLS，587 选 STARTTLS（默认 无加密）",
        control: {
          type: "dropdown",
          key: "smtpEncryption",
          options: { tls: "SSL/TLS（465）", starttls: "STARTTLS（587）", none: "无加密（25）" },
        },
      },
      {
        name: "用户名",
        desc: "SMTP 登录账号（通常为邮箱地址），@ 前隐藏显示、存 Obsidian SecretStorage",
        aliases: ["账号", "邮箱"],
        render: (setting) =>
          this.addAccountInput(setting, s.smtpUser, (v) => {
            s.smtpUser = v.trim();
            void save();
          }),
      },
      {
        name: "密码 / 授权码",
        desc: "SMTP 密码或客户端授权码（邮箱服务商通常要求授权码），存 Obsidian SecretStorage",
        aliases: ["密码", "授权码"],
        render: (setting) =>
          this.addSecretInput(setting, s.smtpPass, (v) => {
            s.smtpPass = v;
            void save();
          }),
      },
      {
        name: "发件人邮箱",
        desc: "MAIL FROM 使用的发件地址（可与用户名一致），@ 前隐藏显示、存 Obsidian SecretStorage",
        aliases: ["发件人", "邮箱"],
        render: (setting) =>
          this.addAccountInput(setting, s.smtpFrom, (v) => {
            s.smtpFrom = v.trim();
            void save();
          }),
      },
      {
        name: "发件人名称",
        desc: "收件方显示的发件人姓名（中文自动编码），可留空；存 Obsidian SecretStorage，设置页隐位展示",
        aliases: ["发件人", "名称"],
        render: (setting) =>
          this.addAccountInput(setting, s.smtpFromName, (v) => {
            s.smtpFromName = v;
            void save();
          }),
      },
      {
        name: "忽略 SMTP 证书校验",
        desc: "默认校验证书（安全）；SMTP 服务器使用自签名/内网证书导致发送失败时开启（仅建议对可信服务器使用）",
        aliases: ["TLS", "证书", "自签名", "内网"],
        control: { type: "toggle", key: "smtpSkipTlsVerify" },
      },
      // 📝 正文模板（§6）
      {
        name: "需求笔记目录",
        desc: "解析 frontmatter 生成项目总览；留空则项目总览为空并提示选择目录",
        aliases: ["需求目录", "总览", "requirement", "notes"],
        render: (setting) => this.renderRequirementDir(setting),
      },
      {
        name: "模板目录",
        desc: "仓库内目录（如 产品需求模板）；插件按 <目录>/邮件模板/<节点>邮件.md 读取各环节邮件正文模板。留空则不使用模板（LLM 生成或通用草稿）。收件人通讯录由「通讯录名单路径」单独指定。附件不再自动加载，需在邮件弹窗中单独上传",
        aliases: ["邮件模板", "附件模板"],
        render: (setting) => this.renderTemplateDir(setting),
      },
      {
        name: "通讯录名单路径",
        desc: "通讯录文件（个人/公共邮箱）的 vault 相对路径，如 产品需求模板/通讯录名单.md；留空则不加载通讯录、不做邮箱匹配（收件人按姓名原样保留）",
        aliases: ["通讯录", "通讯录名单", "contacts", "联系人"],
        render: (setting) => this.renderContactBookPath(setting),
      },
      {
        name: "模板与规则示例生成",
        desc: "一键生成/补齐极简规则文件、邮件模板、通讯录与示例需求笔记（vault 根 AI-PM-TOOL/，已存在的文件不覆盖），并自动填入模板目录 / 通讯录名单路径 / 需求笔记目录（对应项缺失时）",
        aliases: ["初始化", "模板", "规则", "seed", "示例"],
        render: (setting) =>
          setting.addButton((b) =>
            b.setButtonText("生成示例文件").onClick(() => {
              void this.plugin.ensureSeed(true);
            })
          ),
      },
      // 🔒 安全（§5）
      {
        name: "模型调用脱敏",
        desc: "调用模型时对商户/客户等敏感信息字段做脱敏处理",
        aliases: ["脱敏", "安全"],
        control: { type: "toggle", key: "maskSensitive" },
      },
      // 🐞 调试
      {
        name: "日志输出到文件",
        desc: "将 [AI-PM] 调试日志写入插件目录 ai-pm-tool.log（默认关闭，排查问题时开启）",
        aliases: ["日志", "log"],
        control: { type: "toggle", key: "logToFile" },
      },
    ];
  }

  /** 声明式控件写回：写入 settings 并持久化；logToFile 需同步运行时开关 */
  override setControlValue(key: string, value: unknown): void | Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    if (key === "logToFile") setFileLogEnabled(Boolean(value));
    return this.plugin.saveSettings();
  }
}
