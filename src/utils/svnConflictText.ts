/**
 * SVN 冲突标记的纯文本判据与阻断错误（无 obsidian / 无 simple-svn-client 依赖，便于离线冒烟测试）
 *
 * 方针（fail-closed）：检测到冲突即**阻断**操作，不按「不阻塞用户」方式放行 ——
 * 不允许「先写盘/先提交、失败只弹一句提示」把脏数据带进版本库或让用户以为已完成。
 * 与 simple-svn-client 0.2.0 的冲突判据对齐（行首连续 7 个 `<` / `=` / `>`）。
 */

/** 冲突标记行判据（与 simple-svn-client 0.2.0 的 CONFLICT_MARKER_RE 一致） */
export const CONFLICT_MARKER_RE = /^(?:<{7}|={7}|>{7})/m;

/** 冲突条目（与 simple-svn-client 的 SvnConflict 同形，避免本模块依赖该包） */
export interface ConflictLike {
  path: string;
  /** 来源：status 状态位 / 树冲突 / 文件内容标记 */
  source: "status" | "tree" | "marker" | string;
  detail?: string;
}

/** 逐行找出冲突标记行号（1-based；用于提示用户具体位置） */
export function findConflictMarkerLines(text: string): number[] {
  const out: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^(?:<{7}|={7}|>{7})/.test(lines[i])) out.push(i + 1);
  }
  return out;
}

/** 文本是否含冲突标记行 */
export function hasConflictMarkers(text: string): boolean {
  return CONFLICT_MARKER_RE.test(text);
}

/** 冲突来源 → 中文说明 */
export function describeConflictSource(source: string): string {
  switch (source) {
    case "status":
      return "SVN 状态位为冲突（C）";
    case "tree":
      return "树冲突";
    case "marker":
      return "文件内含冲突标记";
    default:
      return source;
  }
}

/** 冲突清单 → 单行可读文案 */
export function describeConflicts(conflicts: readonly ConflictLike[]): string {
  return conflicts
    .map((c) => `${c.path || "（路径未知）"}（${describeConflictSource(c.source)}${c.detail ? `：${c.detail}` : ""}）`)
    .join("；");
}

/** 按 path + source 去重（同一冲突可能被多道判据重复命中） */
export function dedupeConflicts(conflicts: readonly ConflictLike[]): ConflictLike[] {
  const seen = new Set<string>();
  const out: ConflictLike[] = [];
  for (const c of conflicts) {
    const key = `${c.source}|${c.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * 冲突阻断错误（fail-closed 的统一信号）
 * - 抛出即代表「本次操作被拒绝」：调用方必须停下（不写盘 / 不提交 / 不推进环节 / 不关闭弹窗）
 * - `userMessage` 为面向用户的完整说明（含解决方式），可直接用于 Notice / 结果页
 */
export class SvnConflictBlockedError extends Error {
  readonly conflicts: readonly ConflictLike[];
  readonly userMessage: string;
  constructor(conflicts: readonly ConflictLike[], action: string) {
    const list = describeConflicts(conflicts);
    super(`检测到 SVN 冲突，已阻止${action}：${list}`);
    this.name = "SvnConflictBlockedError";
    this.conflicts = conflicts;
    this.userMessage =
      `检测到 SVN 冲突，已阻止${action}。` +
      `请先解决冲突（删除 <<<<<<< / ======= / >>>>>>> 标记，或执行 svn resolve 后提交）再重试。冲突：${list}`;
  }
}

/** 判定是否冲突阻断错误 */
export function isConflictBlocked(e: unknown): e is SvnConflictBlockedError {
  return e instanceof SvnConflictBlockedError;
}
