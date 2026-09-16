/**
 * filters 冒烟测试：总览组合筛选（我的任务 与 项目状态 等维度 AND 组合、互不排斥）+ 文件选择器枚举兜底
 * - applyNoteFilters：我的任务 + 项目状态 可同时生效（回归：此前二者互斥、只能二选一）
 * - listVaultMarkdownFiles：设置项文件选择器的枚举范围为整个仓库（不限目录）
 * 运行：node tests/filters-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TFile, TFolder } from "./obsidian-stub.mjs";

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

// ===== 打包并加载源码（obsidian external 指向 stub） =====
const outDir = mkdtempSync(join(tmpdir(), "ai-pm-filters-"));
const stubPath = join(import.meta.dirname, "obsidian-stub.mjs");
await build({
  entryPoints: ["src/store/repo.ts", "src/utils/vaultFs.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: [stubPath],
  plugins: [
    {
      name: "obsidian-stub-external",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: pathToFileURL(stubPath).href, external: true }));
      },
    },
  ],
  outdir: outDir,
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});
const repo = await import(pathToFileURL(join(outDir, "store", "repo.mjs")).href);
const vaultFs = await import(pathToFileURL(join(outDir, "utils", "vaultFs.mjs")).href);
const { applyNoteFilters } = repo;
const { listVaultMarkdownFiles } = vaultFs;

// ===== 用例数据：4 条需求 =====
const note = (path, projectStatus, roles, extra = {}) => ({
  path,
  name: path.replace(/\.md$/, ""),
  requestStatus: extra.requestStatus ?? null,
  projectStatus,
  roles,
  effort: null,
  reviewDate: null,
  devStartDate: null,
  planOnlineDate: null,
  progress: null,
  keyProject: false,
  mailFlags: {},
  raw: extra.raw ?? {},
});
const NOTES = [
  note("需求A.md", "进行中", { 产品经理: ["张三"] }, { requestStatus: "已评审通过", raw: { 已批准: true } }),
  note("需求B.md", "已上线", { 技术经理: ["张三"] }),
  note("需求C.md", "进行中", { 产品经理: ["李四"] }, { raw: { 已驳回: true } }),
  note("需求D.md", "进行中", { 业务对接人: ["张三"] }, { requestStatus: "进行中" }),
];
const ME = "张三";
const names = (list) => list.map((n) => n.name);

console.log("1. 单维度筛选");
eq(names(applyNoteFilters(NOTES, { mineOnly: true, me: ME })), ["需求A", "需求B", "需求D"], "我的任务（张三负责人）");
eq(names(applyNoteFilters(NOTES, { projectStatus: "进行中" })), ["需求A", "需求C", "需求D"], "项目状态=进行中");

console.log("2. 我的任务 + 项目状态 同时生效（回归：此前互斥，只能二选一）");
eq(
  names(applyNoteFilters(NOTES, { mineOnly: true, me: ME, projectStatus: "进行中" })),
  ["需求A", "需求D"],
  "我的任务 + 进行中（两维度 AND）"
);
eq(
  names(applyNoteFilters(NOTES, { mineOnly: true, me: ME, projectStatus: "已上线" })),
  ["需求B"],
  "我的任务 + 已上线（状态切换不受「我的」影响）"
);
eq(
  names(applyNoteFilters(NOTES, { mineOnly: true, me: ME, projectStatus: "暂停" })),
  [],
  "我的任务 + 无匹配状态 → 空列表"
);

console.log("3. 四维度 AND 组合（我的 + 项目 + 需求 + 审批 + 关键词）");
eq(
  names(applyNoteFilters(NOTES, { mineOnly: true, me: ME, projectStatus: "进行中", requestStatus: "已评审通过" })),
  ["需求A"],
  "我的任务 + 进行中 + 已评审通过"
);
eq(names(applyNoteFilters(NOTES, { mineOnly: true, me: ME, approval: "已批准" })), ["需求A"], "我的任务 + 已批准");
eq(names(applyNoteFilters(NOTES, { projectStatus: "进行中", approval: "已驳回" })), ["需求C"], "进行中 + 已驳回");
eq(names(applyNoteFilters(NOTES, { mineOnly: true, me: ME, keyword: "需求d" })), ["需求D"], "我的任务 + 关键词");
eq(names(applyNoteFilters(NOTES, {})), ["需求A", "需求B", "需求C", "需求D"], "无筛选条件 → 全部");
eq(names(applyNoteFilters(NOTES, { mineOnly: false, me: ME, projectStatus: "" })), ["需求A", "需求B", "需求C", "需求D"], "「我的」关闭 + 状态不过滤 → 全部");

console.log("4. 文件选择器枚举：整个仓库（不限目录，任意层级/顶层目录都能搜到）");
const mk = (path) => {
  const f = new TFile();
  f.path = path;
  return f;
};
// 仓库结构：产品需求/(需求A.md, 说明.txt, 子目录/需求D.md)、其他/笔记.md、项目/模板/需求笔记模板.md
const fileA = mk("产品需求/需求A.md");
const fileTxt = mk("产品需求/说明.txt");
const sub = new TFolder();
sub.path = "产品需求/子目录";
const fileD = mk("产品需求/子目录/需求D.md");
sub.children = [fileD];
const top = new TFolder();
top.path = "产品需求";
top.children = [fileA, fileTxt, sub];
const other = new TFolder();
other.path = "其他";
const fileB = mk("其他/笔记.md");
other.children = [fileB];
const tplFolder = new TFolder();
tplFolder.path = "项目/模板";
const fileTpl = mk("项目/模板/需求笔记模板.md");
tplFolder.children = [fileTpl];
const proj = new TFolder();
proj.path = "项目";
proj.children = [tplFolder];
const root = new TFolder();
root.path = "/";
root.children = [top, other, proj];
const rootApp = { vault: { getRoot: () => root } };
const all = listVaultMarkdownFiles(rootApp).map((f) => f.path);
// 排序用 localeCompare，中文顺序随运行环境 locale 变化（Windows zh = 拼音序，Linux en/ICU = 根序），
// 故断言按 locale 无关的 code-point 序比较集合（.sort() 默认即 code-point）。
eq(
  [...all].sort(),
  [
    "产品需求/需求A.md",
    "产品需求/子目录/需求D.md",
    "其他/笔记.md",
    "项目/模板/需求笔记模板.md",
  ].sort(),
  "整个仓库：任意顶层目录 + 递归子目录，仅 .md"
);
ok(!all.some((p) => p.endsWith(".txt")), "非 Markdown 文件被过滤");
eq(all.length, 4, "无目录上下文时全库 Markdown 一个不漏");
ok(all.includes("项目/模板/需求笔记模板.md"), "深层目录（模板）也能被选择器搜到");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
