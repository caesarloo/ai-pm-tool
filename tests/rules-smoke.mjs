/**
 * rules 冒烟测试：规则文件解析（环节 + 上下文区/表单区/只读字段区）+ loadRules 路径语义
 * 运行：node tests/rules-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
 * 注：样例结构与模板目录下 01-AI-PM-TOOL规则文件.md 一致（4 区域结构）
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TFile } from "./obsidian-stub.mjs"; // 与 esbuild external 指向同一实例，供 fakeApp 构造 TFile

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

// ===== 样例（结构同 01-AI-PM-TOOL规则文件.md，4 区域） =====
const SAMPLE = `# AI-PM-TOOL规则文件

## 一、项目环节

| 序号 | 环节 | frontmatter 邮件标志 | 可选 |
| --- | --- | --- | --- |
| 1 | 环节一 | 环节一邮件 | |
| 2 | 环节二 | 环节二邮件 | |
| 3 | 环节三 | 环节三邮件 | ✅ 可选 |

- 当前环节 = 第一个未完成节点。

## 二、项目进展（进展弹窗四个展示区域）

### 2.1 上下文区（弹窗顶部）

| 序号 | 字段   | 来源（frontmatter） | 展示方式 |
| --- | --- | --- | --- |
| 1 | 项目名称 | 文件名 | 链接（点击打开笔记） |
| 2 | 负责人  | 项目经理 / 产品经理 / 技术经理 / 业务对接人 | 角色人员合并展示 |
| 3 | 重点项目 | 重点项目 | 标注（重点项目时显示） |

### 2.2 环节时间轴

由「一、项目环节」驱动：✅ 已完成 / ▶ 当前 / ○ 待进行。

### 2.3 表单区（可编辑字段，按行序生成控件）

| 序号 | 字段     | 来源（frontmatter） | 控件   | 取值 / 格式                        | 写入风格       |
| --- | ------ | -------------- | ---- | ------------------------------ | ---------- |
| 1 | 项目状态   | 项目状态           | 下拉   | 未开始 / 进行中 / 已上线 / 暂停 / 终止 / 忽略 | 列表（list）   |
| 2 | 需求状态   | 需求状态           | 下拉   | 未开始 / 已评审通过 / 不涉及 / 取消 / 进行中   | 列表（list）   |
| 3 | 进展说明   | 进展说明           | 多行文本 | 自由文本（谁、做了什么、下一步）               | 内联（inline） |
| 4 | 需求评审日期 | 需求评审日期         | 日期   | YYYY-MM-DD（可清空）                | 内联（inline） |
| 5 | 开发投入日期 | 开发投入日期         | 日期   | YYYY-MM-DD（可清空）                | 内联（inline） |
| 6 | 计划上线日期 | 计划上线日期         | 日期   | YYYY-MM-DD（可清空）                | 内联（inline） |

### 2.4 只读字段区（frontmatter 只读展示，有值才显示）

| 序号 | 字段     | 来源（frontmatter） |
| --- | ------ | -------------- |
| 1 | 预估工作量  | 预估工作量          |
| 2 | 需求归属   | 需求归属           |
| 3 | 功能点    | 功能点            |
`;

// ===== 打包并加载源码（obsidian external 指向 stub，保证 TFile instanceof 共享） =====
const outDir = mkdtempSync(join(tmpdir(), "ai-pm-rules-"));
const outFile = join(outDir, "bundle.mjs");
const stubPath = join(import.meta.dirname, "obsidian-stub.mjs");
await build({
  entryPoints: ["src/rules.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["node:fs", "node:path", stubPath],
  plugins: [
    {
      name: "obsidian-stub-external",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: pathToFileURL(stubPath).href, external: true }));
      },
    },
  ],
  outfile: outFile,
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outFile).href);
const { parseRules, loadRules, builtinRules } = mod;

// ===== 用例 =====
console.log("1. 环节表解析（stages）");
const rules = parseRules(SAMPLE);
eq(rules.stages.length, 3, "环节数 3（动态：以规则文件为准）");
eq(rules.stages[0], { key: "环节一邮件", label: "环节一", optional: false }, "首环节 key/label/optional");
eq(rules.stages[2], { key: "环节三邮件", label: "环节三", optional: true }, "可选环节标记");
ok(!rules.stages[1].optional, "非可选环节 optional=false");

console.log("2. 上下文区解析（context）");
eq(rules.context.length, 3, "上下文区字段 3 个");
eq(rules.context[0], { field: "项目名称", source: "文件名", display: "链接（点击打开笔记）" }, "项目名称行");
eq(rules.context[2].field, "重点项目", "重点项目行");
eq(rules.context.map((f) => f.field), ["项目名称", "负责人", "重点项目"], "上下文区行序保持");

console.log("3. 表单区解析（form）");
eq(rules.form.length, 6, "表单区字段 6 个");
eq(rules.form[0], {
  field: "项目状态",
  source: "项目状态",
  control: "select",
  values: ["未开始", "进行中", "已上线", "暂停", "终止", "忽略"],
  style: "list",
}, "项目状态：下拉/枚举/列表写入");
eq(rules.form[2], { field: "进展说明", source: "进展说明", control: "textarea", values: [], style: "inline" }, "进展说明：多行文本/内联");
eq(rules.form[3].control, "date", "日期控件");
eq(rules.form.map((f) => f.field), ["项目状态", "需求状态", "进展说明", "需求评审日期", "开发投入日期", "计划上线日期"], "表单区行序保持");

console.log("4. 只读字段区解析（readOnly）");
eq(rules.readOnly.length, 3, "只读字段区 3 个");
eq(rules.readOnly[0], { field: "预估工作量", source: "预估工作量" }, "预估工作量行");
eq(rules.readOnly.map((f) => f.field), ["预估工作量", "需求归属", "功能点"], "只读区行序保持");

console.log("5. 内置默认规则（规则文件缺失兜底：只保留 1 个通用环节 + 极简通用字段）");
const builtin = builtinRules();
eq(builtin.stages.length, 1, "内置环节数 1（不预设公司流程）");
eq(builtin.stages[0], { key: "上线审核邮件", label: "上线审核", optional: false }, "兜底唯一环节：上线审核");
eq(builtin.context.map((f) => f.field), ["项目名称", "负责人"], "内置上下文区字段（无重点项目）");
eq(builtin.form.length, 4, "内置表单区字段 4 项（无需求评审/开发投入日期）");
eq(builtin.form.map((f) => f.source), ["项目状态", "需求状态", "进展说明", "计划上线日期"], "内置表单区来源");
eq(builtin.readOnly.length, 2, "内置只读字段区 2 项（极简）");
eq(builtin.readOnly[0], { field: "需求背景简述", source: "需求背景简述" }, "内置只读首项");

console.log("6. loadRules 路径语义（模板目录留空 / 文件缺失 → null）");
const ruleStore = { "模板目录/01-AI-PM-TOOL规则文件.md": SAMPLE };
const normalize = (p) => {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "..") out.pop();
    else if (part === "." || part === "") continue;
    else out.push(part);
  }
  return out.join("/");
};
const fakeApp = {
  vault: {
    getAbstractFileByPath(p) {
      const key = normalize(p);
      if (!(key in ruleStore)) return null;
      const f = new TFile();
      f.path = key;
      return f;
    },
    async read(f) {
      return ruleStore[f.path];
    },
  },
};
const r1 = await loadRules(fakeApp, "模板目录");
ok(r1 !== null && r1.stages.length === 3 && r1.form.length === 6, "模板目录命中 → 载入规则");
const r2 = await loadRules(fakeApp, "");
eq(r2, null, "模板目录留空 → null（不加载）");
const r3 = await loadRules(fakeApp, "不存在的目录");
eq(r3, null, "模板目录无规则文件 → null");
const r4 = await loadRules(fakeApp, "  模板目录  ");
ok(r4 !== null && r4.readOnly.length === 3, "模板目录首尾空白容错");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
