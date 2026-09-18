/**
 * mailRecord 冒烟测试：邮件发送记录回写（新增/替换小节）+ 表格前空行规范化
 * - 表格前空行是硬性要求：缺空行时 Obsidian 不把 `| a | b |` 渲染成表格（退化为普通文本行）
 * 运行：node tests/mail-record-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}\n     期望 ${e}\n     实际 ${a}`);
  }
}
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

// ===== 打包并加载源码（mailRecord 为纯字符串逻辑，不依赖 obsidian） =====
const outDir = mkdtempSync(join(tmpdir(), "ai-pm-mailrecord-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/notes/mailRecord.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: outFile,
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outFile).href);
const { upsertMailRecord, ensureBlankLineBeforeTables } = mod;

// ===== 用例 =====
console.log("1. ensureBlankLineBeforeTables 基本行为");
const TABLE = "| 项目 | 结论 |\n| --- | --- |\n| 上线审核 | 通过 |";
eq(ensureBlankLineBeforeTables(`说明文字\n${TABLE}`), `说明文字\n\n${TABLE}`, "段落紧跟表格 → 表格前补空行");
eq(ensureBlankLineBeforeTables(`说明文字\n\n${TABLE}`), `说明文字\n\n${TABLE}`, "已有空行 → 不重复补");
eq(ensureBlankLineBeforeTables(TABLE), TABLE, "文首即表格 → 不加前导空行");
ok(
  ensureBlankLineBeforeTables(`说明文字\n${TABLE}`).includes("| --- | --- |\n| 上线审核 | 通过 |"),
  "表格块内部不插空行（表头/分隔行/数据行保持相邻）",
);

console.log("2. 围栏代码块内的 `|` 不是表格");
const FENCED = "示例：\n```\n| a | b |\n| --- | --- |\n```\n结尾";
eq(ensureBlankLineBeforeTables(FENCED), FENCED, "``` 代码块内不补空行");
const FENCED2 = "示例：\n~~~text\n| a | b |\n~~~\n结尾";
eq(ensureBlankLineBeforeTables(FENCED2), FENCED2, "~~~ 代码块内不补空行");
const FENCED3 = ["示例：", "```", "| a | b |", "```", "说明", "| c | d |"].join("\n");
ok(ensureBlankLineBeforeTables(FENCED3).includes("说明\n\n| c | d |"), "代码块结束后恢复处理（后续真表格仍补空行）");

console.log("3. 新增小节：记录正文内表格前留空行");
const RECORD_BODY = [
  "邮件发送时间：2026-09-18 10:00",
  "收件人：张三（zhangsan@example.com）",
  "主题：上线审核",
  "正文（文本存档）：",
  "各位好：",
  TABLE,
  "请知悉。",
].join("\n");
const fresh = upsertMailRecord("# 需求笔记\n\n## 背景\n\n正文段落。", "上线审核", RECORD_BODY);
eq(fresh.replaced, false, "无对应小节 → replaced=false");
ok(fresh.content.includes("## 上线审核邮件\n邮件发送时间："), "小节标题后紧跟记录正文（首行非表格，无须空行）");
ok(fresh.content.includes("正文（文本存档）：\n各位好："), "正文首行非表格 → 不插多余空行");
ok(fresh.content.includes("各位好：\n\n| 项目 | 结论 |"), "段落紧跟表格 → 表格前补空行");
ok(fresh.content.includes("| 上线审核 | 通过 |\n请知悉。"), "表格块本身未被拆散（表头/分隔行/数据行仍相邻）");
ok(fresh.content.startsWith("# 需求笔记\n\n## 背景\n\n正文段落。\n## 上线审核邮件\n"), "新小节追加在文末（沿用原有换行行为）");
const tableFirst = upsertMailRecord("# 需求笔记\n", "上线审核", TABLE);
ok(tableFirst.content.includes("## 上线审核邮件\n\n| 项目 | 结论 |"), "记录正文首行即表格 → 标题后补空行");

console.log("4. 替换已有小节：标题保留、范围正确、内容更新");
const EXISTING = [
  "# 需求笔记",
  "",
  "## 上线审核邮件",
  "",
  "邮件发送时间：2026-01-01 09:00",
  "收件人：李四（lisi@example.com）",
  "",
  "## 开发评审邮件",
  "",
  "旧的其他环节记录",
].join("\n");
const updated = upsertMailRecord(EXISTING, "上线审核", RECORD_BODY);
eq(updated.replaced, true, "命中已有小节 → replaced=true");
eq(updated.content.split("## 上线审核邮件").length - 1, 1, "标题不重复（原小节被替换而非追加）");
ok(!updated.content.includes("2026-01-01 09:00"), "旧记录内容被清除");
ok(updated.content.includes("## 上线审核邮件\n邮件发送时间：2026-09-18 10:00"), "新记录写入标题行下");
ok(updated.content.includes("## 开发评审邮件\n\n旧的其他环节记录"), "后续邮件小节原样保留");
ok(updated.content.indexOf("2026-09-18") < updated.content.indexOf("## 开发评审邮件"), "新记录位置在下一小节之前");

console.log("5. 小节标题变体与带括号环节名");
const variant = upsertMailRecord("## 上线审核（邮件发送记录）\n\n旧内容\n", "上线审核", RECORD_BODY);
eq(variant.replaced, true, "「（邮件发送记录）」变体标题命中");
ok(!variant.content.includes("旧内容"), "变体小节内容被替换");
const paren = upsertMailRecord("## 项目准入邮件\n\n旧内容\n", "项目准入（开发准入）", RECORD_BODY);
eq(paren.replaced, true, "带括号环节名 → 去括号 baseLabel 命中已有小节");
ok(paren.content.includes("## 项目准入邮件"), "标题保持原样（不被改写）");
const parenNew = upsertMailRecord("# 需求\n", "项目准入（开发准入）", RECORD_BODY);
ok(parenNew.content.includes("## 项目准入邮件\n"), "新增小节标题用去括号 baseLabel");

console.log("6. 记录正文内的 `## 正文` 不截断小节范围（P1-5 回归）");
const withInnerHeading = [
  "## 上线审核邮件",
  "",
  "旧内容",
  "",
  "## 开发评审邮件",
  "",
  "旧的其他环节记录",
].join("\n");
const bodyWithHeading = ["邮件发送时间：2026-09-18 10:00", "## 正文", "各位好：", TABLE].join("\n");
const kept = upsertMailRecord(withInnerHeading, "上线审核", bodyWithHeading);
ok(kept.content.includes("## 开发评审邮件\n\n旧的其他环节记录"), "记录正文内的 `## 正文` 不结束小节替换");
ok(kept.content.includes("各位好：\n\n| 项目 | 结论 |"), "记录正文内的表格同样补空行（`## 正文` 之下）");

console.log("7. 连续两轮替换不吞掉后续小节（小节间空行必须保留）");
const DOC = [
  "# 需求笔记",
  "",
  "## 上线审核邮件",
  "",
  "邮件发送时间：2026-01-01 09:00",
  "",
  "## 开发评审邮件",
  "",
  "邮件发送时间：2026-01-02 09:00",
  "",
  "## 结尾说明",
  "",
  "别丢了我",
].join("\n");
const round1 = upsertMailRecord(DOC, "上线审核", RECORD_BODY);
const round2 = upsertMailRecord(round1.content, "上线审核", RECORD_BODY);
ok(round2.content.includes("\n\n## 开发评审邮件"), "替换后小节之间保留空行（下轮边界判定的前提）");
ok(round2.content.includes("## 开发评审邮件\n\n邮件发送时间：2026-01-02 09:00"), "第二轮替换保留后续环节小节");
ok(round2.content.includes("## 结尾说明\n\n别丢了我"), "第二轮替换保留后续非邮件小节");
eq(round2.content.split("## 上线审核邮件").length - 1, 1, "第二轮替换不产生重复标题");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
