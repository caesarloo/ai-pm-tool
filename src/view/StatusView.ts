/**
 * 状态总览（§4.3 侧边栏视图 / §4.4 变更展示）
 * - 动态统计：项目状态 / 需求状态 / 审批（已批准·已驳回）三维度切换，按实际数据聚合（§4.3 动态原则）
 * - 动态筛选 Tab（含计数）、搜索、我的任务、「我」徽标、快照信息
 * - 自动刷新：监听 vault 文件变化（md 被修改/新增/删除）自动重扫列表，不触发 svn
 * - 手动同步：svn update → log/diff 变更记录（默认展开）+ ✕ 关闭
 */
import { ItemView, Notice, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import type AIPMTool from "../main";
import { type ChangeItem, type RequirementNote, type SnapshotInfo } from "../types";
import { runSync, SvnClient, isSvnWorkingCopy } from "@caesarloo/simple-svn-client";
import { aggregateStatus, filterByStatus, isApproved, isRejected, ownedByMe, scanRequirementNotes, searchNotes } from "../store/repo";
import { vaultBasePath } from "../utils/path";
import { log } from "../utils/logger";
import { ProgressModal } from "./ProgressModal";
import { checkSeedMissing } from "../setup/seed";
import { runSvnSerialized } from "../utils/svnQueue";

export const STATUS_VIEW_TYPE = "ai-pm-status-view";

/** 自动刷新防抖间隔（ms）：批量文件变化合并为一次刷新 */
const AUTO_REFRESH_DEBOUNCE = 800;

/** 状态 -> 圆点/统计颜色（§4.3 状态圆点颜色映射） */
const STATUS_COLOR: Record<string, string> = {
  进行中: "green",
  已上线: "blue",
  暂停: "amber",
  终止: "red",
  未开始: "gray",
  忽略: "slate",
  "（空）": "gray",
};

export class StatusView extends ItemView {
  plugin: AIPMTool;
  private notes: RequirementNote[] = [];
  private projectTab: string | null = null; // 项目状态筛选（含「我的任务」）；null=未初始化，""=用户取消(不过滤)
  private requestTab: string = ""; // 需求状态筛选；空 = 该维度不过滤
  private approvalTab: string = ""; // 审批筛选（已批准 / 已驳回）；空 = 该维度不过滤
  private keyword = "";
  private snapshot: SnapshotInfo | null = null;
  private revOld: string | null = null; // 最近一次同步前的版本号（§4.4 变更区间 r旧→r新）
  private changes: ChangeItem[] = [];
  private changelogVisible = false;
  private changelogExpanded = true; // 同步后默认展开（§4.4）
  private syncing = false;
  private autoRefreshTimer: number | null = null; // 防抖定时器
  private autoRefreshHandler: ((file: TAbstractFile) => void) | null = null; // 事件监听（卸载时移除）

  constructor(leaf: WorkspaceLeaf, plugin: AIPMTool) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return STATUS_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "项目总览";
  }
  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.setupAutoRefresh();
    await this.refresh();
  }

  onunload(): void {
    if (this.autoRefreshTimer !== null) window.clearTimeout(this.autoRefreshTimer);
    this.autoRefreshTimer = null;
  }

  /** 自动刷新：监听 vault 文件变化（需求目录内 md / 规则文件），防抖后重扫；不触发 svn */
  private setupAutoRefresh(): void {
    if (this.autoRefreshHandler) return;
    this.autoRefreshHandler = (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (file.extension !== "md") return;
      // 规则文件变化：重读规则并刷新（修改即时生效，无需重启）
      const rulesPath = this.plugin.rulesFilePath();
      if (rulesPath && file.path === rulesPath) {
        log.debug(`检测到规则文件变化：${file.path}，刷新总览`);
        this.scheduleRefresh();
        return;
      }
      // 目录动态读取：设置修改后无需重启视图
      const dir = this.plugin.settings.requirementDir.trim().replace(/^\/+|\/+$/g, "");
      if (dir && !file.path.startsWith(dir + "/")) return;
      log.debug(`检测到文件变化：${file.path}，防抖刷新总览`);
      this.scheduleRefresh();
    };
    this.registerEvent(this.app.vault.on("modify", this.autoRefreshHandler));
    this.registerEvent(this.app.vault.on("create", this.autoRefreshHandler));
    this.registerEvent(this.app.vault.on("delete", this.autoRefreshHandler));
    this.registerEvent(this.app.vault.on("rename", this.autoRefreshHandler));
  }

  /** 防抖刷新（800ms 合并批量变化） */
  private scheduleRefresh(): void {
    if (this.autoRefreshTimer !== null) window.clearTimeout(this.autoRefreshTimer);
    this.autoRefreshTimer = window.setTimeout(() => {
      this.autoRefreshTimer = null;
      void this.refresh();
    }, AUTO_REFRESH_DEBOUNCE);
  }

  /** 重新扫描仓库数据并渲染（动态原则：每次同步/打开都从实际数据聚合） */
  async refresh(): Promise<void> {
    // 手动同步进行中跳过自动刷新（sync 完成后会自行重扫）
    if (this.syncing) return;
    // 重读规则文件（环节/字段修改即时生效）
    await this.plugin.loadRulesOnce();
    log.debug(`刷新状态总览，目录=${this.plugin.settings.requirementDir}`);
    this.notes = await scanRequirementNotes(this.app, this.plugin.settings.requirementDir);
    // 快照信息：尽力读取 SVN 版本号（非同步目录则显示提示）
    if (!this.snapshot) {
      const base = vaultBasePath(this.app);
      const client = new SvnClient(base || this.app.vault.getRoot().path);
      if (base && (await isSvnWorkingCopy(base))) {
        const rev = await client.getRevision();
        log.debug(`SVN 工作副本 r${rev}`);
        this.snapshot = { revision: rev ?? "—", date: new Date().toISOString(), changedFiles: 0 };
      } else {
        log.debug("非 SVN 工作副本（或未检测到 svn），快照信息置空");
      }
    }
    this.render();
  }

  /** 手动同步（§4.2）：update → diff 变更 */
  async sync(): Promise<void> {
    if (this.syncing) return;
    if (!this.plugin.settings.requirementDir.trim()) {
      new Notice("请先在设置中配置「需求笔记目录」再执行同步", 6000);
      return;
    }
    this.syncing = true;
    this.render();
    const cwd = vaultBasePath(this.app);
    log.debug(`开始手动同步，cwd=${cwd}`);
    try {
      // 经全局单飞队列串行执行（.svn 锁并发会互等超时误报失败）
      const result = await runSvnSerialized(() => runSync(cwd, this.plugin.settings.requirementDir));
      log.debug(
        `同步结果：ok=${result.ok} revOld=${result.revOld} revNew=${result.snapshot.revision} 变更文件=${result.snapshot.changedFiles} 变更条目=${result.changes.length} message=${result.message}`
      );
      if (!result.ok) {
        new Notice(result.message, 8000);
        this.changes = [];
        this.changelogVisible = false;
      } else {
        this.snapshot = result.snapshot;
        this.revOld = result.revOld;
        this.changes = result.changes;
        new Notice(result.message, 5000);
        // 同步后重新扫描数据（动态原则：统计随实际数据变化；SVN 已更新磁盘，直读避免 vault 缓存滞后）
        this.notes = await scanRequirementNotes(this.app, this.plugin.settings.requirementDir, true);
        this.changelogVisible = true;
        this.changelogExpanded = true; // 默认展开
      }
    } catch (e) {
      log.error("同步异常", e);
      new Notice(`同步失败：${(e as Error).message}`, 8000);
    } finally {
      this.syncing = false;
      this.render();
    }
  }

  /** 打开 Obsidian 设置并定位到本插件 tab（app.setting 类型未在 d.ts 声明，运行时存在） */
  private openSettings(): void {
    const setting = (this.app as unknown as {
      setting?: { open(): void; openTabById?(id: string): void };
    }).setting;
    if (!setting) {
      new Notice("请手动打开设置：设置 → 第三方插件 → AI PM Tool", 6000);
      return;
    }
    setting.open();
    setting.openTabById?.("ai-pm-tool");
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ===== 模板/规则/通讯录/需求目录缺失：提示引导（新装引导，检测驱动） =====
    const missing = checkSeedMissing(this.app, this.plugin.settings);
    if (missing.any) {
      const box = contentEl.createDiv({ cls: "ai-pm-empty-hint" });
      box.createEl("span", { text: "⚡ 模板 / 规则未初始化", cls: "ai-pm-empty-hint-title" });
      const parts = [
        missing.missingRules ? "规则文件" : "",
        missing.missingContactBook ? "通讯录" : "",
        missing.missingRequirementDir ? "需求笔记目录" : "",
      ].filter(Boolean);
      box.createEl("p", {
        text: `检测到 ${parts.join("、")} 缺失。可「设置路径」手动配置（要求目录/文件已存在于 vault），或「一键生成示例」自动创建极简模板（AI-PM-TOOL/，含规则文件/邮件模板/通讯录/示例需求笔记）并配置对应设置；已存在的文件不会被覆盖。`,
      });
      const actions = box.createDiv({ cls: "ai-pm-seed-actions" });
      actions.createEl("button", { text: "⚙️ 设置路径", cls: "ai-pm-sync-btn" }).addEventListener("click", () =>
        this.openSettings()
      );
      actions.createEl("button", { text: "⚡ 一键生成示例", cls: "ai-pm-sync-btn" }).addEventListener("click", async () => {
        await this.plugin.ensureSeed(true);
        void this.refresh();
      });
    }

    // ===== 需求笔记目录未配置：提示选择（§4.1） =====
    if (!this.plugin.settings.requirementDir.trim()) {
      const box = contentEl.createDiv({ cls: "ai-pm-empty-hint" });
      box.createEl("span", { text: "⚠️ 未配置「需求笔记目录」", cls: "ai-pm-empty-hint-title" });
      box.createEl("p", {
        text: "项目总览需要知道需求笔记所在的仓库目录。请在「设置 → AI PM Tool → 需求笔记目录」中选择或输入目录。",
      });
      box.createEl("button", { text: "⚙️ 打开设置", cls: "ai-pm-sync-btn" }).addEventListener("click", () =>
        this.openSettings()
      );
      return;
    }

    // ===== 头部 =====
    const header = contentEl.createDiv({ cls: "ai-pm-header" });
    header.createEl("span", { text: "📋 项目总览", cls: "ai-pm-header-title" });
    header.createEl("span", { text: `需求 · ${this.notes.length} 项`, cls: "ai-pm-header-count" });

    // ===== 搜索（§4.3） =====
    const search = contentEl.createEl("input", {
      cls: "ai-pm-search",
      attr: { type: "text", placeholder: "🔍 搜索需求 / 负责人…" },
    });
    search.value = this.keyword;
    search.addEventListener("input", (e) => {
      this.keyword = (e.target as HTMLInputElement).value;
      this.renderList();
    });

    // ===== 组合筛选（§4.3：项目状态 + 需求状态 + 审批 三行固定，同时生效 AND 组合；不受规则文件影响） =====
    const projectStats = aggregateStatus(this.notes, "项目状态");
    const requestStats = aggregateStatus(this.notes, "需求状态");
    const me = this.plugin.currentUser();
    const mineCount = this.notes.filter((n) => ownedByMe(n, me)).length;
    // 默认项目状态筛选（仅首次 null 时）：我的任务 > 0 ? 我的任务 : 进行中（无进行中则回退第一个状态）
    if (this.projectTab === null) {
      if (mineCount > 0) this.projectTab = "我的任务";
      else if (projectStats.some((s) => s.value === "进行中")) this.projectTab = "进行中";
      else this.projectTab = projectStats[0]?.value ?? "我的任务";
    }

    const renderDimRow = (
      label: string,
      defs: { value: string; count: number; color?: string }[],
      activeVal: string | null,
      onPick: (v: string) => void
    ) => {
      const row = contentEl.createDiv({ cls: "ai-pm-dim-row" });
      row.createSpan({ cls: "ai-pm-dim-label", text: label });
      const tabs = row.createDiv({ cls: "ai-pm-tabs" });
      for (const t of defs) {
        const b = tabs.createEl("button", { cls: `ai-pm-tab${activeVal === t.value ? " active" : ""}` });
        b.createSpan({ cls: `ai-pm-dot ${t.color}` });
        b.createSpan({ text: `${t.value} (${t.count})` });
        b.addEventListener("click", () => {
          // 点已选项取消（该维度不过滤）
          onPick(activeVal === t.value ? "" : t.value);
        });
      }
      return row;
    };

    // 行 1：项目状态（含「我的任务」）
    renderDimRow(
      "项目",
      [
        { value: "我的任务", count: mineCount, color: "blue" },
        ...projectStats.map((s) => ({ value: s.value, count: s.count, color: STATUS_COLOR[s.value] ?? "gray" })),
      ],
      this.projectTab,
      (v) => {
        this.projectTab = v;
        this.render();
      }
    );
    // 行 2：需求状态
    renderDimRow(
      "需求",
      requestStats.map((s) => ({ value: s.value, count: s.count, color: STATUS_COLOR[s.value] ?? "gray" })),
      this.requestTab,
      (v) => {
        this.requestTab = v;
        this.render();
      }
    );
    // 行 3：审批（已批准 / 已驳回，frontmatter 布尔标志）
    renderDimRow(
      "审批",
      [
        { value: "已批准", count: this.notes.filter((n) => isApproved(n)).length, color: "green" },
        { value: "已驳回", count: this.notes.filter((n) => isRejected(n)).length, color: "red" },
      ],
      this.approvalTab,
      (v) => {
        this.approvalTab = v;
        this.render();
      }
    );

    // ===== 卡片列表 =====
    const list = contentEl.createDiv({ cls: "ai-pm-list" });
    this.renderListInto(list);

    // ===== 底部工具栏：快照信息 + 手动同步（§4.3 快照信息） =====
    const footer = contentEl.createDiv({ cls: "ai-pm-footer" });
    const rev = this.snapshot?.revision ?? "—";
    const date = this.snapshot?.date
      ? new Date(this.snapshot.date).toLocaleString("zh-CN", { hour12: false }).slice(0, 16)
      : "—";
    footer.createEl("span", { text: `🕐 快照 r${rev} · ${date}`, cls: "ai-pm-footer-info" });
    const syncBtn = footer.createEl("button", {
      cls: "ai-pm-sync-btn",
      text: this.syncing ? "⏳ 同步中…" : "↻ 手动同步",
    });
    syncBtn.addEventListener("click", () => this.sync());

    // ===== 变更记录（§4.4：默认折叠；拼接在同步按钮下方） =====
    if (this.changelogVisible) {
      this.renderChangelog(contentEl);
    }
  }

  private renderList(): void {
    const list = this.contentEl.querySelector(".ai-pm-list");
    if (!list) return;
    list.empty();
    this.renderListInto(list as HTMLElement);
  }

  private renderListInto(list: HTMLElement): void {
    let items = this.notes;
    // 组合筛选（AND）：项目状态 + 需求状态 同时生效
    if (this.projectTab === "我的任务") {
      const identity = this.plugin.currentUser();
      items = items.filter((n) => ownedByMe(n, identity));
    } else if (this.projectTab) {
      items = filterByStatus(items, "项目状态", this.projectTab);
    }
    if (this.requestTab) {
      items = filterByStatus(items, "需求状态", this.requestTab);
    }
    if (this.approvalTab === "已批准") {
      items = items.filter((n) => isApproved(n));
    } else if (this.approvalTab === "已驳回") {
      items = items.filter((n) => isRejected(n));
    }
    items = searchNotes(items, this.keyword);

    // 排序：进行中优先，其次未开始，按计划上线日期
    const priority: Record<string, number> = { 进行中: 0, 未开始: 1, 暂停: 2, 已上线: 3, 终止: 4, 忽略: 5 };
    items = [...items].sort((a, b) => {
      const pa = priority[a.projectStatus ?? ""] ?? 9;
      const pb = priority[b.projectStatus ?? ""] ?? 9;
      if (pa !== pb) return pa - pb;
      return (a.planOnlineDate ?? "").localeCompare(b.planOnlineDate ?? "");
    });

    if (items.length === 0) {
      list.createEl("p", { text: "无匹配项目", cls: "ai-pm-muted" });
      return;
    }

    const me = this.plugin.currentUser();
    const stages = this.plugin.stages(); // 环节徽标按规则文件「一、项目环节」驱动（第二章不影响卡片）
    for (const n of items) {
      const card = list.createDiv({ cls: "ai-pm-card" });
      const row1 = card.createDiv({ cls: "ai-pm-card-row1" });
      row1.createSpan({ cls: `ai-pm-dot ${STATUS_COLOR[n.projectStatus ?? ""] ?? "gray"}` });
      // 项目名称纯文本展示（不加链接；点卡片整卡打开进展更新）
      row1.createSpan({ text: n.name, cls: "ai-pm-card-name" });
      if (ownedByMe(n, me)) row1.createSpan({ text: "我", cls: "ai-pm-mine" });

      const owners = Object.values(n.roles).flat();
      const row2 = card.createDiv({ cls: "ai-pm-card-row2" });
      row2.createSpan({ text: `👤 ${owners.join("、") || "—"}`, cls: "ai-pm-card-owner" });
      if (n.progress) row2.createSpan({ text: n.progress.slice(0, 18), cls: "ai-pm-card-prog" });
      const overdue = n.planOnlineDate && n.planOnlineDate < new Date().toISOString().slice(0, 10) && n.projectStatus !== "已上线";
      row2.createSpan({
        text: `📅 ${n.planOnlineDate ?? "—"}`,
        cls: `ai-pm-card-due${overdue ? " overdue" : ""}`,
      });

      // 节点邮件徽标（§4.3：规则文件环节驱动）
      const badges = card.createDiv({ cls: "ai-pm-badges" });
      for (const m of stages) {
        if (n.mailFlags[m.key]) {
          badges.createSpan({ text: `${m.label.replace("（开发准入）", "")} ✅`, cls: "ai-pm-badge done" });
        }
      }
      card.addEventListener("click", () => {
        new ProgressModal(this.app, this.plugin, n, () => void this.refresh()).open();
      });
    }
  }

  /** 变更记录区（§4.4：默认展开、▼/▲ 收起、✕ 关闭；展示最近一次全部条目） */
  private renderChangelog(container: HTMLElement): void {
    const cl = container.createDiv({ cls: "ai-pm-changelog" });
    const head = cl.createDiv({ cls: "ai-pm-chg-head" });
    const revRange = this.revOld && this.snapshot ? `（r${this.revOld} → r${this.snapshot.revision}）` : "";
    head.createSpan({
      text: `📋 本次同步变更${revRange}`,
      cls: "ai-pm-chg-title",
    });
    const ops = head.createDiv({ cls: "ai-pm-chg-ops" });
    const fold = ops.createEl("button", { cls: "ai-pm-chg-btn", text: this.changelogExpanded ? "▲" : "▼" });
    fold.addEventListener("click", () => {
      this.changelogExpanded = !this.changelogExpanded;
      const body = cl.querySelector(".ai-pm-chg-body") as HTMLElement | null;
      if (body) body.style.display = this.changelogExpanded ? "" : "none";
      fold.textContent = this.changelogExpanded ? "▲" : "▼";
    });
    const close = ops.createEl("button", { cls: "ai-pm-chg-btn", text: "✕" });
    close.title = "关闭本次变更记录（下次同步重新出现）";
    close.addEventListener("click", () => {
      this.changelogVisible = false;
      this.render();
    });

    const body = cl.createDiv({ cls: "ai-pm-chg-body" });
    body.style.display = this.changelogExpanded ? "" : "none";

    if (this.changes.length === 0) {
      body.createEl("p", { text: "无字段变更（本次同步无内容变化）", cls: "ai-pm-muted" });
    } else {
      for (const c of this.changes) {
        const item = body.createDiv({ cls: "ai-pm-chg" });
        item.createDiv({ cls: "ai-pm-chg-file", text: c.file });
        const row = item.createDiv({ cls: "ai-pm-chg-row" });
        row.createSpan({ text: c.field, cls: "ai-pm-chg-field" });
        row.createSpan({ text: c.base || "（空）", cls: "ai-pm-chg-base" });
        row.createSpan({ text: c.work || "（空）", cls: "ai-pm-chg-work" });
        if (c.author || c.revision) {
          item.createDiv({ cls: "ai-pm-chg-commit", text: `${c.author} · r${c.revision}` });
        }
      }
    }
  }
}
