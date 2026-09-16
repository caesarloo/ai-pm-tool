/**
 * filters 冒烟测试：总览组合筛选（我的任务 与 项目状态 等维度 AND 组合、互不排斥）+ 文件选择器枚举兜底
 * - applyNoteFilters：我的任务 + 项目状态 可同时生效（回归：此前二者互斥、只能二选一）
 * - listMarkdownFiles：目录留空（无目录上下文）时回退整个仓库，仍能匹配到文件
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
const { listMarkdownFiles } = vaultFs;

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

console.log("4. 文件选择器枚举：有目录上下文 → 仅该目录");
const mk = (path, folder = "") => {
  const f = new TFile();
  f.path = path;
  f.extension = "md";
  f.parent = folder;
  return f;
};
const dirStore = {
  产品需求: { files: ["产品需求/需求A.md", "产品需求/说明.txt"], folders: ["产品需求/子目录"] },
  "产品需求/子目录": { files: ["产品需求/子目录/需求D.md"], folders: [] },
};
const fakeApp = {
  vault: {
    adapter: {
      async list(d) {
        if (!(d in dirStore)) throw new Error("ENOENT");
        return dirStore[d];
      },
    },
    getRoot() {
      const root = new TFolder();
      root.path = "/";
      root.children = [];
      return root;
    },
    getAbstractFileByPath(p) {
      return p.endsWith(".md") ? mk(p) : null;
    },
  },
};
const scoped = await listMarkdownFiles(fakeApp, "产品需求");
// 排序用 localeCompare，中文顺序随运行环境 locale 变化（Windows zh = 拼音序，Linux en/ICU = 根序），
// 故断言按 locale 无关的 code-point 序比较集合（.sort() 默认即 code-point）。
eq(
  [...scoped].sort(),
  ["产品需求/需求A.md", "产品需求/子目录/需求D.md"].sort(),
  "目录上下文：递归 + 仅 .md（不含 .txt）"
);
ok(!scoped.some((p) => p.endsWith(".txt")), "非 Markdown 文件被过滤");

console.log("5. 文件选择器枚举：目录留空（无目录上下文）→ 回退整个仓库");
const fileA = new TFile();
fileA.path = "产品需求/需求A.md";
const fileB = new TFile();
fileB.path = "其他/笔记.md";
const fileTxt = new TFile();
fileTxt.path = "根说明.txt";
const sub = new TFolder();
sub.path = "产品需求/子目录";
const fileD = new TFile();
fileD.path = "产品需求/子目录/需求D.md";
sub.children = [fileD];
const top = new TFolder();
top.path = "产品需求";
top.children = [fileA, sub];
const root = new TFolder();
root.path = "/";
root.children = [top, fileB, fileTxt];
const rootApp = {
  vault: {
    getRoot: () => root,
    getAbstractFileByPath(p) {
      return p.endsWith(".md") ? mk(p) : null;
    },
  },
};
const all = await listMarkdownFiles(rootApp, "");
eq(
  [...all].sort(),
  ["产品需求/需求A.md", "产品需求/子目录/需求D.md", "其他/笔记.md"].sort(),
  "留空：整个仓库的 Markdown（递归、不含非 md）"
);
const allTrim = await listMarkdownFiles(rootApp, "   ");
eq(allTrim, all, "留空（含空白字符）同样回退整个仓库");
ok(allTrim.length > 0, "留空时选择器可匹配到文件（此前返回空列表）");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
