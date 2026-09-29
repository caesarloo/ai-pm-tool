/**
 * SVN 安全自动合并冒烟测试（结构感知三方合并的纯函数部分）
 * - 覆盖：冲突标记还原两版、frontmatter 按键合并、正文按小节合并、双边改动拒绝、顺序与安全网
 * - 关键用例：本次事故（ZF03）的真实形态 —— 必须合并成功且不丢「项目准入邮件」段
 * - 运行：node tests/svn-merge-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
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

const outDir = mkdtempSync(join(tmpdir(), "ai-pm-svnmerge-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/utils/svnAutoMerge.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: outFile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outFile).href);

// ============ 1. 冲突标记还原两版 ============
console.log("1. splitConflictVersions");
const WORKING = [
  "head",
  "<<<<<<< .mine邮件发送时间：2026-09-28 17:00",
  "收件人：张旭东",
  "=======邮件发送时间：",
  "邮件截图：",
  ">>>>>>> .theirs",
  "tail",
].join("\n");
const sv = m.splitConflictVersions(WORKING);
eq(sv.blocks, 1, "识别 1 个冲突块");
eq(sv.mine, "head\n邮件发送时间：2026-09-28 17:00\n收件人：张旭东\ntail", "本地侧（含粘连标记行的内容）");
eq(sv.theirs, "head\n邮件发送时间：\n邮件截图：\ntail", "仓库侧");
ok(!m.splitConflictVersions(WORKING).mine.includes("<<<<<<<"), "还原结果不含标记");
const d3 = m.splitConflictVersions(["a", "<<<<<<< .mine", "M", "||||||| .r1", "B", "=======", "T", ">>>>>>> .r2", "z"].join("\n"));
eq(d3.mine, "a\nM\nz", "diff3 风格：本地侧");
eq(d3.theirs, "a\nT\nz", "diff3 风格：仓库侧（base 段丢弃）");

// ============ 2. 本次事故的真实形态 ============
console.log("2. 真实事故形态（ZF03）：本地改工作量段、仓库未改、项目准入段仅在仓库侧");
const FM = ["---", "需求背景简述: 结售汇风控改造", "工作量评估邮件: false", "项目准入邮件: false", "---"];
const TAIL = ["", "## 上线审核邮件", "邮件发送时间：", "邮件截图："];
const WORK_OLD = [
  "## 工作量评估邮件",
  "邮件发送时间：",
  "邮件截图：",
  "![Pasted image 20260824174320](产品需求/Attachments/Pasted%20image%2020260824174320.png)",
];
const ADMIT_OLD = [
  "## 项目准入邮件",
  "邮件发送时间：",
  "邮件截图：",
  "![Pasted image 20260824174243](产品需求/Attachments/Pasted%20image%2020260824174243.png)",
];
const WORK_NEW = [
  "## 工作量评估邮件",
  "邮件发送时间：2026-09-28 17:00",
  "收件人：张旭东（17122212@suning.com）",
  "主题：【ZF03-跨境-结售汇风控改造】工作量评估会议纪要",
  "正文（文本存档）：",
  "",
  "> 各位同事好，",
  "> 以下为【ZF03-跨境-结售汇风控改造】工作量评估会议纪要。",
];
const baseText = [...FM, ...WORK_OLD, ...ADMIT_OLD, ...TAIL].join("\n");
const theirsText = baseText; // 仓库侧与 base 相同（远端未改）
const mineText = [...FM.map((l) => (l === "工作量评估邮件: false" ? "工作量评估邮件: true" : l)), ...WORK_NEW, ...TAIL].join("\n");

const r = m.autoMergeThreeWay(baseText, mineText, theirsText);
ok(r.ok, "合并成功（不因本地缺失小节而拒绝）");
ok(r.merged.includes("邮件发送时间：2026-09-28 17:00"), "保留本地新格式工作量记录");
ok(r.merged.includes("## 项目准入邮件"), "不丢「项目准入邮件」段（保守保留）");
ok(r.merged.includes("![Pasted image 20260824174243]"), "项目准入段内容完整");
ok(r.merged.includes("工作量评估邮件: true"), "frontmatter 键取本地改动值");
ok(!/^(?:<{7}|={7}|>{7})/m.test(r.merged), "合并结果不含任何冲突标记");
const idxWork = r.merged.indexOf("## 工作量评估邮件");
const idxAdmit = r.merged.indexOf("## 项目准入邮件");
const idxOnline = r.merged.indexOf("## 上线审核邮件");
ok(idxWork < idxAdmit && idxAdmit < idxOnline, "小节顺序为 工作量 → 项目准入 → 上线审核");
ok(r.conflicts.length === 0, "无待人工项");

// ============ 3. 仅仓库侧改动 → 取仓库 ============
console.log("3. 单侧改动");
const base2 = ["---", "k: v", "---", "## A邮件", "old"].join("\n");
const mine2 = base2;
const theirs2 = ["---", "k: v", "---", "## A邮件", "new"].join("\n");
const r2 = m.autoMergeThreeWay(base2, mine2, theirs2);
ok(r2.ok && r2.merged.includes("new"), "仅仓库侧改小节 → 取仓库");
const theirs3 = base2;
const mine3 = ["---", "k: v2", "---", "## A邮件", "old"].join("\n");
const r3 = m.autoMergeThreeWay(base2, mine3, theirs3);
ok(r3.ok && r3.merged.includes("k: v2"), "仅本地侧改字段 → 取本地");

// ============ 4. 双边改动不一致 → 拒绝 ============
console.log("4. 双边改动（必须拒绝自动）");
const mine4 = ["---", "k: mine", "---", "## A邮件", "old"].join("\n");
const theirs4 = ["---", "k: theirs", "---", "## A邮件", "old"].join("\n");
const r4 = m.autoMergeThreeWay(base2, mine4, theirs4);
ok(!r4.ok, "同一字段两侧都改且不一致 → 拒绝");
ok(r4.conflicts.some((c) => c.includes("k")), "冲突项指出具体字段 k");
const mine5 = ["---", "k: v", "---", "## A邮件", "mine-line"].join("\n");
const theirs5 = ["---", "k: v", "---", "## A邮件", "theirs-line"].join("\n");
const r5 = m.autoMergeThreeWay(base2, mine5, theirs5);
ok(!r5.ok, "同一小节两侧都改且不一致 → 拒绝");
ok(r5.conflicts.some((c) => c.includes("## A邮件")), "冲突项指出具体小节");

// ============ 5. 新增小节与顺序 ============
console.log("5. 新增小节");
const base6 = ["## A", "a"].join("\n");
const mine6 = ["## A", "a", "## B", "b"].join("\n");
const theirs6 = ["## A", "a", "## C", "c"].join("\n");
const r6 = m.autoMergeThreeWay(base6, mine6, theirs6);
ok(r6.ok, "各自新增不同小节 → 合并成功");
ok(r6.merged.includes("## B") && r6.merged.includes("## C"), "两侧新增小节均保留");

// ============ 6. 换行差异不误判 ============
console.log("6. 换行归一");
const crlf = base2.replace(/\n/g, "\r\n");
const r7 = m.autoMergeThreeWay(base2, crlf, theirs2);
ok(r7.ok, "CRLF 与 LF 差异不误判为双边冲突");

// ============ 7. 安全网：结果不含标记 ============
console.log("7. 安全网");
ok(m.normalizeEol("a\r\nb\rc\n") === "a\nb\nc\n", "normalizeEol 归一 CRLF/裸 CR");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
