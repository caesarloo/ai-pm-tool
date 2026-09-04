/**
 * 仓库数据聚合（§4.3 动态原则）
 * - 统计项、筛选 Tab、卡片列表全部由插件运行时扫描仓库需求笔记、按 frontmatter 实际取值聚合生成
 * - 状态取值/数量/计数均不写死；空值（未填状态）不静默丢弃，以「（空）」参与统计
 */
import { App, FileSystemAdapter, Notice, TFile } from "obsidian";
import { parseRequirementNote } from "../notes/parser";
import { log } from "../utils/logger";
import { listFilesRecursive } from "../utils/vaultFs";
import type { RequirementNote, StatusCount } from "../types";

/**
 * 读取笔记内容：SVN 同步后 vault 缓存可能滞后，useDisk 时经 FileSystemAdapter 直读磁盘。
 * 注意：adapter.read 接受 vault 相对路径（相对仓库根），而非绝对路径。
 * 磁盘直读失败（ENOENT：文件已被 svn 删除/尚未同步）时降级走 vault 缓存，避免误报「解析失败」。
 */
async function readNote(app: App, file: TFile, useDisk: boolean): Promise<string | null> {
  const adapter = app.vault.adapter;
  if (useDisk && adapter instanceof FileSystemAdapter) {
    try {
      const text = await adapter.read(file.path);
      log.debug(`磁盘直读 ${file.path}`);
      return text;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      log.warn(`磁盘直读失败 ${file.path}（${err.code ?? ""} ${err.message ?? ""}），降级 vault 缓存`);
      if (err.code === "ENOENT") return null; // 文件不存在：跳过（svn 删除/索引滞后）
    }
  }
  try {
    return await app.vault.read(file);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    log.warn(`vault 读取失败 ${file.path}（${err.code ?? ""} ${err.message ?? ""}）`);
    return null;
  }
}

/** 按目录前缀扫描并解析需求笔记（并行读取，避免串行卡顿）；解析失败静默跳过并合并提示，避免批量刷屏
 *  mailKeys：当前动态环节键集（parseRequirementNote 的邮件标志读取范围；缺省不解析邮件标志） */
export async function scanRequirementNotes(
  app: App,
  dir: string,
  useDisk = false,
  mailKeys: readonly string[] = []
): Promise<RequirementNote[]> {
  const prefix = dir.replace(/^\/+|\/+$/g, "");
  // 仅枚举配置目录（Obsidian 审核合规：不走 vault.getFiles() 全库枚举）
  const files = (
    await listFilesRecursive(app, prefix)
  )
    .filter((p) => p.toLowerCase().endsWith(".md"))
    .map((p) => app.vault.getAbstractFileByPath(p))
    .filter((f): f is TFile => f instanceof TFile);
  log.debug(`扫描需求笔记：${files.length} 个文件（${prefix}/）`);
  let failed = 0;
  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const content = await readNote(app, f, useDisk);
        if (content === null) return null; // 读取失败/文件不存在：跳过
        return parseRequirementNote(f.path, content, mailKeys);
      } catch (e) {
        failed++;
        log.warn(`解析失败：${f.path}`, e);
        return null;
      }
    })
  );
  const ok = results.filter((r): r is RequirementNote => r !== null);
  if (failed > 0) new Notice(`有 ${failed} 个需求笔记解析失败（已跳过，详见日志）`, 5000);
  log.debug(`需求笔记解析完成：${ok.length}/${files.length}`);
  return ok;
}

/**
 * 动态聚合统计（§4.3）：按维度（项目状态 / 需求状态）聚合计数
 * - 取值按出现次数降序；空值以「（空）」展示
 */
export function aggregateStatus(notes: RequirementNote[], dim: "项目状态" | "需求状态"): StatusCount {
  const map = new Map<string, number>();
  for (const n of notes) {
    const v = dim === "项目状态" ? n.projectStatus : n.requestStatus;
    const key = v && v.trim() !== "" ? v : "（空）";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/** 按状态值过滤笔记（空值匹配「（空）」） */
export function filterByStatus(notes: RequirementNote[], dim: "项目状态" | "需求状态", value: string): RequirementNote[] {
  return notes.filter((n) => {
    const v = (dim === "项目状态" ? n.projectStatus : n.requestStatus) ?? "";
    const key = v.trim() !== "" ? v : "（空）";
    return key === value;
  });
}

/** 负责人是否含当前用户（「我的任务」Tab 与「我」徽标，§4.3） */
export function ownedByMe(note: RequirementNote, me: string): boolean {
  const all = Object.values(note.roles).flat();
  return all.includes(me);
}

/** 布尔标志读取（兼容内联 `key: true` 与列表 `key:\n  - true` 两种写法） */
function rawFlag(v: unknown): boolean {
  if (v === true) return true;
  if (Array.isArray(v)) return v[0] === true;
  return false;
}

/** 审批标志（§4.3 筛选维度：已批准 / 已驳回，来自 frontmatter 布尔字段） */
export function isApproved(note: RequirementNote): boolean {
  return rawFlag(note.raw["已批准"]);
}
export function isRejected(note: RequirementNote): boolean {
  return rawFlag(note.raw["已驳回"]);
}

/** 搜索过滤（§4.3：需求名 / 负责人） */
export function searchNotes(notes: RequirementNote[], keyword: string): RequirementNote[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return notes;
  return notes.filter(
    (n) =>
      n.name.toLowerCase().includes(k) ||
      Object.values(n.roles)
        .flat()
        .some((p) => p.toLowerCase().includes(k))
  );
}
