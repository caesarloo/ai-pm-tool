/**
 * SVN 冲突守卫（fail-closed）：写盘前与提交时各设一道闸门，命中即阻断
 *
 * 方针（用户 2026-09-29 约定）：SVN 冲突场景**不按「不阻塞用户」方式处理** ——
 * 不再「写盘成功 → 提交失败 → 只弹一句提示 → 继续推进环节」，而是：
 *   ① 写回前（assertNoConflictBefore）：命中冲突 → **拒绝写盘**、不推进环节、不提交；
 *   ② 提交时（commitGuarded）：提交前断言无冲突，冲突类失败归一为 SvnConflictBlockedError
 *      → 调用方必须保持弹窗/面板打开、按钮可重试，且不得把该环节标记为完成。
 *
 * 双保险判据（见《ZF03 冲突分析》§七/§八）：
 *   - 内容判据：文件内容里的冲突标记行（不依赖 svn，跨机同步的脏 wc.db 骗不过它）；
 *   - 状态判据：`svn status` 的冲突状态位；
 *   —— 二者同时使用：只信状态位会被脏 wc.db 骗过，只信内容会漏掉树冲突/属性冲突。
 *   组件的标记扫描需要注入 `fileContentReader`，故此处统一用 `createSvnClient()` 构造客户端。
 */
import { App, TFile } from "obsidian";
import { SvnClient, SvnError } from "@caesarloo/simple-svn-client";
import { vaultBasePath } from "./path";
import { runSvnSerialized } from "./svnQueue";
import { log } from "./logger";
import {
  SvnConflictBlockedError,
  dedupeConflicts,
  findConflictMarkerLines,
  type ConflictLike,
} from "./svnConflictText";
import { autoMergeThreeWay, splitConflictVersions } from "./svnAutoMerge";

/**
 * 创建 SVN 客户端（统一入口）
 * - 注入 `fileContentReader`：让「文件内容冲突标记」这道判据真正生效（组件默认无 reader 时会跳过标记扫描），
 *   同时也修掉未版本化文件 diff 预览此前「未配置文件内容读取器」的降级路径。
 * - vault 相对路径 == 工作副本相对路径（插件部署下两者同根）。
 */
export function createSvnClient(app: App, workingCopyPath?: string): SvnClient {
  const cwd = workingCopyPath ?? vaultBasePath(app);
  return new SvnClient(cwd, {
    fileContentReader: async (relPath: string): Promise<Buffer | null> => {
      try {
        const buf = await app.vault.adapter.readBinary(relPath);
        return Buffer.from(buf);
      } catch (e) {
        log.warn(`冲突标记扫描读取失败：${relPath}（${(e as Error).message}）`);
        return null;
      }
    },
  });
}

/**
 * 写入前冲突断言（第一道闸门，fail-closed）
 * - 内容判据：待写入内容 + 磁盘当前内容 → 含标记即阻断（不依赖 svn 可用性）
 * - 状态判据：svn 可用时查 status 冲突位（查不动/报错 → 直接冒泡，视为「无法确认安全」而阻断）
 * - 命中即抛 SvnConflictBlockedError；调用方**不得**继续写盘
 * @param pendingContent 即将写入的内存内容（可选；覆盖「磁盘还没标记、待写入内容已含标记」的情形）
 */
export async function assertNoConflictBefore(app: App, notePath: string, pendingContent?: string): Promise<void> {
  const conflicts: ConflictLike[] = [];

  // ① 内容判据（不依赖 svn）
  if (pendingContent !== undefined) {
    const at = findConflictMarkerLines(pendingContent);
    if (at.length > 0) {
      conflicts.push({ path: notePath, source: "marker", detail: `待写入内容第 ${at.join("、")} 行` });
    }
  }
  try {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (file instanceof TFile) {
      const disk = await app.vault.read(file);
      const at = findConflictMarkerLines(disk);
      if (at.length > 0) {
        conflicts.push({ path: notePath, source: "marker", detail: `磁盘文件第 ${at.join("、")} 行` });
      }
    }
  } catch (e) {
    // 读不到内容 → 内容判据无法成立；记录后由状态判据兜底（状态判据失败仍会阻断）
    log.warn(`冲突内容判据读取失败：${notePath}（${(e as Error).message}）`);
  }

  // ② 状态判据（svn 可用时；失败直接冒泡 = 无法确认无冲突 → 阻断）
  const client = createSvnClient(app);
  if (await client.isAvailable()) {
    const found = await runSvnSerialized(() => client.findConflicts([notePath]));
    for (const c of found) {
      conflicts.push({ path: c.path, source: c.source, ...(c.detail ? { detail: c.detail } : {}) });
    }
  }

  const unique = dedupeConflicts(conflicts);
  if (unique.length > 0) {
    log.warn(`检测到 SVN 冲突，已阻止写回：${unique.map((c) => `${c.path}(${c.source})`).join("、")}`);
    throw new SvnConflictBlockedError(unique, "写回笔记");
  }
}

/**
 * 提交（第二道闸门，fail-closed）
 * - 先断言无冲突（组件 `assertNoConflicts`：status 状态位 + 文件内容标记）
 * - 冲突类失败（`SvnError.kind === "conflict"`，含 svn 自身的 E155015）归一为 SvnConflictBlockedError，
 *   使调用方能统一按「冲突阻断」处理（保持弹窗打开、可重试、不标记完成）
 */
export async function commitGuarded(app: App, paths: string[], message: string): Promise<void> {
  const client = createSvnClient(app);
  try {
    await runSvnSerialized(() => client.commit(paths, message, { autoAdd: true, assertNoConflicts: true }));
  } catch (e) {
    if (e instanceof SvnError && e.kind === "conflict") {
      throw new SvnConflictBlockedError(
        [{ path: paths.join("、"), source: "status", detail: e.message.slice(0, 300) }],
        "提交到 SVN"
      );
    }
    throw e;
  }
}

/** 自动合并结果 */
export interface AutoMergeOutcome {
  /** true = 已安全合并并写盘（冲突状态已清除），可核对后重新提交 */
  merged: boolean;
  /** 逐单元的取舍说明 */
  decisions: string[];
  /** 未自动合并的原因 / 需人工决定的单元 */
  conflicts: string[];
}

/**
 * 冲突时尝试「安全自动合并」（结构感知三方合并；见 svnAutoMerge.ts 的安全规则）
 *
 * 取数：工作文件（还原出本地侧 / 仓库侧）+ `svn cat -r BASE`
 * 成功：写盘（合并结果已无标记）→ `svn resolve`（此时文件已无标记，`--accept working` 仅用于清除冲突状态与清理残留文件）
 * 失败：不写盘、不 resolve —— 由调用方按 fail-closed 提示，需人工决定
 *
 * 注意：本函数**不会**提交；调用方应在成功提示后要求用户核对内容再点一次提交（人工确认）。
 */
export async function autoMergeIfSafe(app: App, notePath: string): Promise<AutoMergeOutcome> {
  try {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return { merged: false, decisions: [], conflicts: ["找不到笔记文件"] };
    const working = await app.vault.read(file);
    const { mine, theirs, blocks } = splitConflictVersions(working);
    if (blocks === 0) {
      return { merged: false, decisions: [], conflicts: ["文件中未发现冲突标记，无法自动合并"] };
    }
    const client = createSvnClient(app);
    if (!(await client.isAvailable())) {
      return { merged: false, decisions: [], conflicts: ["本机未检测到 svn 命令，无法读取 BASE 版本"] };
    }
    const base = await runSvnSerialized(() => client.cat("BASE", notePath));
    if (base === null) {
      return { merged: false, decisions: [], conflicts: ["无法读取 BASE 版本（文件可能未纳入版本控制）"] };
    }
    const result = autoMergeThreeWay(base, mine, theirs);
    if (!result.ok || result.merged === undefined) {
      return { merged: false, decisions: result.decisions, conflicts: result.conflicts };
    }
    await app.vault.modify(file, result.merged);
    await runSvnSerialized(() => client.resolve([notePath]));
    log.info(`已自动合并冲突并清除冲突状态：${notePath}（取舍 ${result.decisions.length} 项）`);
    return { merged: true, decisions: result.decisions, conflicts: [] };
  } catch (e) {
    log.warn(`自动合并失败：${notePath}（${(e as Error).message}）`);
    return { merged: false, decisions: [], conflicts: [`自动合并异常：${(e as Error).message}`] };
  }
}
