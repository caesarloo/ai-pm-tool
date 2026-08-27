/**
 * AI PM Tool · 文件日志
 * - 日志同时输出到控制台（[AI-PM] 前缀）与插件目录 ai-pm-tool.log
 * - 在 main.ts onload 时 initLogger() 注入 App；未初始化时仅控制台输出（不抛错）
 * - 文件输出默认关闭，由设置项「日志输出到文件」控制（setFileLogEnabled）
 * - 经 Obsidian DataAdapter（vault API）读写，不直接依赖 Node fs 模块（社区审核合规）
 * - 单文件上限 512KB，超出轮转为 .1（保留最近两份）
 * - 写入失败静默忽略，不阻塞插件主流程
 */
import type { App, DataAdapter, Stat } from "obsidian";

let adapter: DataAdapter | null = null;
let logPath = "";
let fileEnabled = false;
const MAX_BYTES = 512 * 1024;

export function initLogger(app: App): void {
  try {
    adapter = app.vault.adapter ?? null;
    // 配置目录经 Vault#configDir 获取（用户可自定义，不硬编码 .obsidian）
    const logDir = `${app.vault.configDir}/plugins/ai-pm-tool`;
    logPath = `${logDir}/ai-pm-tool.log`;
    if (adapter) {
      // 目录通常已存在（插件安装即创建）；失败静默，append 时再兜底
      void adapter.mkdir(logDir).catch(() => {});
    }
    console.debug(`[AI-PM] 日志文件路径：${logPath}（DataAdapter）`);
  } catch (e) {
    adapter = null;
    logPath = "";
    console.warn("[AI-PM] 日志文件初始化失败，仅控制台输出", e);
  }
}

/** 设置文件输出开关（设置页切换时调用）；返回当前是否已启用 */
export function setFileLogEnabled(enabled: boolean): void {
  fileEnabled = enabled;
  console.debug(`[AI-PM] 文件日志输出：${fileEnabled ? "开启" : "关闭"}${logPath ? `（${logPath}）` : ""}`);
}

function ts(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(
    d.getSeconds()
  )}.${p(d.getMilliseconds(), 3)}`;
}

/** 超过上限时轮转（rename 为 .1）；异步，失败静默 */
async function rotateIfNeeded(): Promise<void> {
  if (!adapter || !logPath) return;
  try {
    const st: Stat | null = await adapter.stat(logPath);
    if (st && st.size > MAX_BYTES) {
      await adapter.rename(logPath, `${logPath}.1`).catch(() => {});
    }
  } catch {
    /* 文件不存在等忽略 */
  }
}

function write(level: string, msg: string): void {
  const a = adapter;
  const p = logPath;
  if (!a || !p || !fileEnabled) return;
  void (async () => {
    try {
      await rotateIfNeeded();
      await a.append(p, `${ts()} [${level}] ${msg}\n`);
    } catch {
      /* 写失败不阻塞主流程 */
    }
  })();
}

/** 序列化附加参数（对象 → JSON；失败回退 String） */
function fmtArgs(args: unknown[]): string {
  if (args.length === 0) return "";
  return (
    " " +
    args
      .map((a) => {
        try {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          return typeof a === "string" ? a : JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ")
  );
}

export const log = {
  debug: (msg: string, ...args: unknown[]) => {
    console.debug(`[AI-PM] ${msg}`, ...args);
    write("DEBUG", msg + fmtArgs(args));
  },
  info: (msg: string, ...args: unknown[]) => {
    // 不输出到控制台（避免无必要日志）；仍写入文件（设置开启时）
    write("INFO", msg + fmtArgs(args));
  },
  warn: (msg: string, ...args: unknown[]) => {
    console.warn(`[AI-PM] ${msg}`, ...args);
    write("WARN", msg + fmtArgs(args));
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(`[AI-PM] ${msg}`, ...args);
    write("ERROR", msg + fmtArgs(args));
  },
};
