/**
 * frontmatter 布局/序列化冒烟测试（P1 · 0.1.0 生成需求：模板产物字段写回）
 * 运行：node tests/frontmatter2-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}
function includes(haystack, needle, label) {
  if (haystack.includes(needle)) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}\n     缺少片段:\n${needle}\n---\n${haystack}\n---`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "ai-pm-fm2-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/notes/parser.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["node:fs", "node:path", "node:util", "@caesarloo/simple-svn-client"],
  outfile: outFile,
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outFile).href);
const { splitFrontmatter, scanFrontmatterLayout, serializeFrontmatter, formatListValue, formatInlineValue } = mod;

console.log("1. splitFrontmatter：拆出 fm 块与正文");
const DOC = `---\n需求名称: 示例\n需求编号:\n功能点:\n  - 分页导出\n---\n\n# 示例需求\n\n正文内容\n`;
const { fm, body } = splitFrontmatter(DOC);
ok(fm.includes("需求名称: 示例") && fm.includes("  - 分页导出"), "fm 块内文本完整");
ok(body.startsWith("# 示例需求"), "正文 = frontmatter 之后内容");
const noFm = splitFrontmatter("# 纯正文");
ok(noFm.fm === "" && noFm.body.startsWith("# 纯正文"), "无 frontmatter → fm='' body=原文");

console.log("2. scanFrontmatterLayout：键序 + 风格（内联/列表/空列表/块指令）");
const SAMPLE_FM = `需求名称: 订单导出性能优化
需求编号:
需求背景简述: 导出功能在数据量增大后响应超时
功能点:
  - 分页导出
  - 异步任务通知
进展说明: |-
  第一行
  第二行
预估工作量: 43
重点项目: true
计划上线日期: 2026-08-25
`;
const layout = scanFrontmatterLayout(SAMPLE_FM);
ok(JSON.stringify(layout.map((l) => l.key)) === JSON.stringify([
  "需求名称", "需求编号", "需求背景简述", "功能点", "进展说明", "预估工作量", "重点项目", "计划上线日期",
]), "键序保持模板产物顺序");
ok(layout[0].style === "inline" && layout[3].style === "list", "文本 inline / 列表 list");
ok(layout[4].style === "inline", "|- 多行块按 inline（文本）");
ok(layout[6].style === "inline", "布尔内联");

console.log("3. serializeFrontmatter：按 layout 风格写回");
const out = serializeFrontmatter(layout, {
  "需求名称": "订单导出性能优化",
  "需求编号": "",
  "需求背景简述": "导出功能在数据量增大后响应超时",
  "功能点": ["分页导出", "异步任务通知"],
  "进展说明": "第一行\n第二行",
  "预估工作量": 43,
  "重点项目": true,
  "计划上线日期": "2026-08-25",
});
includes(out, "需求名称: 订单导出性能优化", "内联标量");
includes(out, "需求编号:", "空值键仅留键名");
includes(out, "功能点:\n  - 分页导出\n  - 异步任务通知", "列表项保持");
includes(out, "进展说明: |-\n  第一行\n  第二行", "多行文本用 |- 块");
includes(out, "预估工作量: 43", "数字原样");
includes(out, "重点项目: true", "布尔原样");

console.log("4. 列表风格空值 → 仅键行（可再补 chips）");
const out2 = serializeFrontmatter([{ key: "业务对接人", style: "list" }], { "业务对接人": [] });
ok(out2 === "业务对接人:", "空列表只留键名");

console.log("5. formatListValue / formatInlineValue（与 ProgressModal 共用的格式化）");
includes(formatListValue("第一行\n第二行"), "  - 第一行\n  第二行", "列表风格多行续行缩进");
ok(formatInlineValue("单行") === " 单行", "inline 单行前缀空格");
includes(formatInlineValue("第一行\n第二行"), "|-\n  第一行\n  第二行", "inline 多行 |- 块");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
