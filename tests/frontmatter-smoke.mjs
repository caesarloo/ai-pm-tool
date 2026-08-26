/**
 * ProgressModal.updateFrontmatter 冒烟测试
 * 运行：node tests/frontmatter-smoke.mjs
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}\n     期望:\n${expected}\n     实际:\n${actual}`);
  }
}
function includes(haystack, needle, label) {
  if (haystack.includes(needle)) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}\n     缺少片段: ${needle}\n---\n${haystack}\n---`);
  }
}

const outDir = mkdtempSync(join(import.meta.dirname, ".tmp-fm-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/view/ProgressModal.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["child_process", "iconv-lite", "node:fs", "node:fs/promises", "node:path", "node:net", "node:tls", "node:util", "@caesarloo/simple-svn-client"],
  alias: { obsidian: join(import.meta.dirname, "obsidian-stub.mjs") },
  outfile: outFile,
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outFile).href);
const { updateFrontmatter } = mod;

console.log("1. 内联值 → 列表风格");
const a = updateFrontmatter("---\n项目状态: 进行中\n---\n\n正文", "项目状态", "已上线");
includes(a, "项目状态:\n  - 已上线", "内联键转为列表风格");
eq(a.split("---")[0].includes("进行中"), false, "旧值已移除");

console.log("2. 多行列表替换全部旧项（不残留）");
const b = updateFrontmatter("---\n进展说明:\n  - 行1\n  - 行2\n  - 行3\n---\n", "进展说明", "新进展");
includes(b, "  - 新进展", "写入新值");
eq(b.includes("行1") || b.includes("行2") || b.includes("行3"), false, "旧行全部清除");

console.log("3. 多行值续行缩进（不破坏 frontmatter）");
const c = updateFrontmatter("---\n进展说明: 旧\n---\n", "进展说明", "第一行\n第二行\n第三行");
includes(c, "  - 第一行\n  第二行\n  第三行", "续行统一缩进");
includes(c, "第三行\n---", "frontmatter 闭合结构保持");

console.log("4. 键不存在时插入");
const d = updateFrontmatter("---\n项目状态: 进行中\n---\n", "计划上线日期", "2026-08-25");
includes(d, "计划上线日期:\n  - 2026-08-25", "新键插入");

console.log("5. 无 frontmatter 时创建");
const e = updateFrontmatter("# 纯正文", "项目状态", "进行中");
includes(e, "---\n项目状态:\n  - 进行中\n---", "创建 frontmatter");

console.log("6. 日期清空（空值写入）");
const f = updateFrontmatter("---\n计划上线日期:\n  - 2026-08-25\n---\n", "计划上线日期", "");
includes(f, "计划上线日期:\n  - ", "空值写入（允许清空）");

console.log("7. inline 文本模式（进展说明，§4.5 文本格式非列表）");
const g = updateFrontmatter("---\n进展说明: 旧进展\n项目状态: 进行中\n---\n", "进展说明", "编码完成 80%", "inline");
includes(g, "进展说明: 编码完成 80%", "内联文本写入");
eq(g.includes("进展说明:\n  - "), false, "不转列表风格");

console.log("8. inline 多行值 → |- 块（仍是文本非列表）");
const h = updateFrontmatter("---\n进展说明: 旧\n---\n", "进展说明", "第一行\n第二行", "inline");
includes(h, "进展说明: |-\n  第一行\n  第二行", "多行文本用 |- 块");

console.log("9. 键不存在时 inline 插入");
const i = updateFrontmatter("---\n项目状态: 进行中\n---\n", "进展说明", "新进展", "inline");
includes(i, "进展说明: 新进展", "inline 插入新键");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
