/**
 * SVN 未提交变更预览（发送邮件结果页与项目进展弹窗共用，逻辑完全一致）
 * - loadSvnDiff：读取工作副本 vs BASE 的真实 svn diff（svn 不可用/失败返回 null）
 * - renderSvnDiffBox：渲染「SVN 未提交变更（svn diff）」区
 *   - frontmatter 区域：仅显示变更行，无上下文（frontmatter = 第一个 `## ` 标题行之前的行，按内容锚点判定，
 *     不依赖 DiffLine.lineNumber——即使 simple-svn-client ≥0.1.2 已解析 @@ 头起始行号，内容锚点判定仍更稳健，
 *     不依赖 hunk 解析细节）
 *   - 正文区域：变更行前后各保留一行上下文（unchanged，弱化样式）
 *   - frontmatter 与正文都有变更时，两者之间插入分割线
 */
import { App } from "obsidian";
import { SvnClient, type SvnDiff } from "@caesarloo/simple-svn-client";
import { vaultBasePath } from "../utils/path";
import { log } from "../utils/logger";
import { runSvnSerialized } from "../utils/svnQueue";

/** 加载 SVN 未提交变更（svn diff 工作副本 vs BASE）；svn 不可用/读取失败返回 null；经全局单飞队列串行执行（.svn 锁并发会互等超时） */
export async function loadSvnDiff(app: App, notePath: string): Promise<SvnDiff | null> {
  return runSvnSerialized(async () => {
    const client = new SvnClient(vaultBasePath(app));
    try {
      if (!(await client.isAvailable())) return null;
      return await client.diff(notePath);
    } catch (e) {
      log.warn(`SVN diff 读取失败：${notePath}（${(e as Error).message}）`);
      return null;
    }
  });
}

/**
 * 渲染「SVN 未提交变更」区到父容器（与项目进展弹窗完全一致的展示）
 * - frontmatter 判定：第一个内容以 `#` 开头的行（正文标题，如 `## 需求评审邮件`）之前的行视为 frontmatter；
 *   diff 中找不到标题行（纯 frontmatter 变更场景）时全部按正文处理（保留上下文）
 * - svnDiff 非空且有变更行 → 渲染，返回 true；无变更行 → 不渲染返回 false
 * - svnDiff 为 null 且 loaded → 渲染「未检测到 svn」提示，返回 false
 */
export function renderSvnDiffBox(parent: HTMLElement, svnDiff: SvnDiff | null, loaded: boolean): boolean {
  if (svnDiff) {
    const lines = svnDiff.lines;
    if (lines.some((l) => l.type !== "unchanged")) {
      // 正文起点锚点：第一个内容以 # 开头的行（frontmatter 内为 YAML，无 # 标题）
      let bodyAnchor = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i].content.trimStart())) {
          bodyAnchor = i;
          break;
        }
      }
      const isFrontmatter = (i: number): boolean => bodyAnchor >= 0 && i < bodyAnchor;
      // 标记显示行：变更行本身；正文区域的变更行额外保留前后各 1 行上下文
      const show = new Array<boolean>(lines.length).fill(false);
      let fmChanged = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].type !== "unchanged") {
          show[i] = true;
          if (isFrontmatter(i)) fmChanged = true;
          else {
            if (i > 0) show[i - 1] = true;
            if (i < lines.length - 1) show[i + 1] = true;
          }
        }
      }
      const diffBox = parent.createDiv({ cls: "ai-pm-diff-box" });
      diffBox.createDiv({ cls: "ai-pm-diff-t", text: "SVN 未提交变更（svn diff）" });
      let fmRendered = false; // 已渲染 frontmatter 变更 → 进入正文前插分割线
      for (let i = 0; i < lines.length; i++) {
        if (!show[i]) continue;
        if (fmChanged && fmRendered && !isFrontmatter(i)) {
          diffBox.createDiv({ cls: "ai-pm-diff-sep" });
          fmRendered = false;
        }
        const l = lines[i];
        const row = diffBox.createDiv({ cls: `ai-pm-diff-line ${l.type}` });
        row.setText(l.type === "added" ? `+ ${l.content}` : l.type === "deleted" ? `- ${l.content}` : `  ${l.content}`);
        if (isFrontmatter(i)) fmRendered = true;
      }
      return true;
    }
  } else if (loaded) {
    const hint = parent.createDiv({ cls: "ai-pm-muted ai-pm-diff-hint" });
    hint.setText("未检测到 SVN 命令，无法展示未提交变更");
  }
  return false;
}
