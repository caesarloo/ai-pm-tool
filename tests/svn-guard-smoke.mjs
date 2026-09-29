/**
 * SVN 冲突判据冒烟测试（fail-closed 守卫的纯文本部分）
 * - 覆盖：冲突标记行识别（含本次事故的「粘连」形态）、行号、去重、冲突条目文案、阻断错误
 * - 运行：node tests/svn-guard-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
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

const outDir = mkdtempSync(join(tmpdir(), "ai-pm-svnguard-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/utils/svnConflictText.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: outFile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outFile).href);

// ==== 1. 真实事故形态：标记与内容粘连（取自已入库的 ZF03 冲突块）====
const INCIDENT = [
  "## 工作量评估邮件",
  "<<<<<<< .mine邮件发送时间：2026-09-28 17:00",
  "收件人：张旭东（17122212@suning.com）",
  "=======邮件发送时间：",
  "邮件截图：",
  "![Pasted image](产品需求/Attachments/x.png)",
  ">>>>>>> .theirs",
  "## 上线审核邮件",
].join("\n");

console.log("1. 冲突标记识别（含粘连形态）");
ok(m.hasConflictMarkers(INCIDENT), "粘连形态的冲突块被识别");
eq(m.findConflictMarkerLines(INCIDENT), [2, 4, 7], "标记行号为 2 / 4 / 7");
eq(m.findConflictMarkerLines("## 需求评审邮件\n邮件发送时间：2026-09-28 16:56\n"), [], "普通邮件记录不误判");
eq(m.findConflictMarkerLines("> 各位同事好\n> ----\n"), [], "引用块与分隔线不误判");

// ==== 2. 标准形态（标记独占一行）====
const STANDARD = ["<<<<<<< .mine", "a", "=======", "b", ">>>>>>> .r17783"].join("\n");
console.log("2. 标准形态");
ok(m.hasConflictMarkers(STANDARD), "标准形态被识别");
eq(m.findConflictMarkerLines(STANDARD), [1, 3, 5], "标准形态行号 1 / 3 / 5");

// ==== 3. 去重与文案 ====
console.log("3. 去重与文案");
const dup = [
  { path: "产品需求/A.md", source: "status", detail: "conflicted" },
  { path: "产品需求/A.md", source: "marker", detail: "文件内含冲突标记" },
  { path: "产品需求/A.md", source: "marker", detail: "文件内含冲突标记" },
];
eq(m.dedupeConflicts(dup).length, 2, "同 path+source 去重（保留两种来源）");
const text = m.describeConflicts(dup);
ok(text.includes("产品需求/A.md"), "文案含路径");
ok(text.includes("SVN 状态位为冲突"), "文案含 status 来源中文说明");
ok(text.includes("文件内含冲突标记"), "文案含 marker 来源中文说明");

// ==== 4. 阻断错误（fail-closed 的统一信号）====
console.log("4. 阻断错误");
const err = new m.SvnConflictBlockedError([{ path: "产品需求/A.md", source: "marker", detail: "第 2 行" }], "写回笔记");
eq(err.name, "SvnConflictBlockedError", "错误名可判别");
ok(err.userMessage.includes("已阻止写回笔记"), "userMessage 含被阻止的动作");
ok(err.userMessage.includes("svn resolve"), "userMessage 给出解决方式");
ok(m.isConflictBlocked(err), "isConflictBlocked 命中本类型");
ok(!m.isConflictBlocked(new Error("普通错误")), "普通错误不被误判为冲突阻断");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
