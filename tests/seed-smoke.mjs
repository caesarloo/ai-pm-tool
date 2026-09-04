/**
 * seed 冒烟测试：极简模板/规则种子内容解析 + 缺失检测 + 幂等生成
 * 运行：node tests/seed-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
 * 覆盖：规则文件（1 环节 4 区域）、示例需求笔记、通讯录示例、邮件模板示例、checkSeedMissing、ensureMinimalSetup 幂等
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TFile } from "./obsidian-stub.mjs";

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

// ===== 临时入口：re-export 被测模块（bundle 为一个 ESM；产物放 tests 下以解析 node_modules） =====
const outDir = mkdtempSync(join(import.meta.dirname, ".tmp-seed-"));
const entry = join(outDir, "entry.mjs");
const src = import.meta.dirname + "/../src";
const abs = (p) => join(src, p).replace(/\\/g, "/");
writeFileSync(
  entry,
  [
    `export { ensureMinimalSetup, checkSeedMissing, SEED_RULES_FILE, SEED_MAIL_TEMPLATE, SEED_CONTACT_BOOK, SEED_SAMPLE_NOTE } from "${abs("setup/seed.ts")}";`,
    `export { parseRules } from "${abs("rules.ts")}";`,
    `export { parseRequirementNote } from "${abs("notes/parser.ts")}";`,
    `export { parseContactBook } from "${abs("notes/contacts.ts")}";`,
    `export { parseMailTemplate } from "${abs("view/MailModal.ts")}";`,
  ].join("\n")
);
const outFile = join(outDir, "bundle.mjs");
const stubPath = join(import.meta.dirname, "obsidian-stub.mjs");
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["child_process", "iconv-lite", "node:fs", "node:fs/promises", "node:path", "node:net", "node:tls", "node:util", "@caesarloo/simple-svn-client"],
  plugins: [
    {
      name: "obsidian-stub-external",
      setup(b) {
        // external 而非 alias：保证 bundle 内 TFile 与测试文件共享同一 stub 实例（instanceof 一致性）
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: pathToFileURL(stubPath).href, external: true }));
      },
    },
  ],
  outfile: outFile,
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outFile).href);
const { ensureMinimalSetup, checkSeedMissing, SEED_RULES_FILE, SEED_MAIL_TEMPLATE, SEED_CONTACT_BOOK, SEED_SAMPLE_NOTE, parseRules, parseRequirementNote, parseContactBook, parseMailTemplate } = mod;

console.log("1. 极简规则文件解析（1 环节 / 4 区域）");
const rules = parseRules(SEED_RULES_FILE);
eq(rules.stages.length, 1, "环节数 1（极简）");
eq(rules.stages[0], { key: "上线审核邮件", label: "上线审核", optional: false }, "唯一环节：上线审核（与内置兜底一致）");
eq(rules.context.length, 3, "上下文区 3 个字段");
eq(rules.context.map((f) => f.field), ["项目名称", "负责人", "重点项目"], "上下文区行序");
eq(rules.form.length, 3, "表单区 3 个字段（极简）");
eq(rules.form[0], {
  field: "项目状态",
  source: "项目状态",
  control: "select",
  values: ["未开始", "进行中", "已上线", "暂停", "终止", "忽略"],
  style: "list",
}, "项目状态：下拉/枚举/列表写入");
eq(rules.form[1], { field: "计划上线日期", source: "计划上线日期", control: "date", values: [], style: "inline" }, "计划上线日期：日期/内联");
eq(rules.form[2], { field: "进展说明", source: "进展说明", control: "textarea", values: [], style: "inline" }, "进展说明：多行文本/内联");
eq(rules.readOnly.length, 3, "只读字段区 3 个（极简）");
eq(rules.readOnly.map((f) => f.field), ["预估工作量", "需求背景简述", "功能点"], "只读区行序");

console.log("2. 示例需求笔记解析（frontmatter → RequirementNote）");
const note = parseRequirementNote("AI-PM-TOOL/需求笔记/示例需求.md", SEED_SAMPLE_NOTE, ["上线审核邮件"]);
eq(note.name, "示例需求", "笔记名");
eq(note.projectStatus, "进行中", "项目状态");
eq(note.requestStatus, "已评审通过", "需求状态");
eq(note.roles["项目经理"], ["张三"], "项目经理角色（列表风格）");
eq(note.roles["产品经理"], ["李四"], "产品经理角色");
eq(note.effort, "5 人天", "预估工作量");
eq(note.planOnlineDate, "2026-06-30", "计划上线日期");
eq(note.mailFlags["上线审核邮件"], false, "上线审核邮件标志 false");
ok(note.keyProject === false, "重点项目 false");
ok((note.progress ?? "").includes("上线审核"), "进展说明内容");

console.log("3. 通讯录示例解析（收件人名单/抄送名单 + 公共邮箱）");
const book = parseContactBook(SEED_CONTACT_BOOK);
eq(book.byName.get("张三"), "zhangsan@example.com", "张三 → 邮箱");
eq(book.byName.get("李四"), "lisi@example.com", "李四 → 邮箱");
eq(book.groups, ["project@example.com"], "抄送名单（默认抄送）");
eq(book.groupNames.get("project@example.com"), "项目组", "抄送名单名称");
ok(book.byId === undefined, "无 byId 索引（格式已简化为姓名/邮箱）");

console.log("4. 邮件模板示例解析（## 主题 / ## 正文）");
const tpl = parseMailTemplate(SEED_MAIL_TEMPLATE);
ok(tpl.subject.includes("上线审核") && tpl.subject.includes("[项目名称]"), "主题小节含占位符");
ok(tpl.body.includes("各位好") && tpl.body.includes("[项目名称]"), "正文小节含占位符");
ok(!tpl.body.includes("## 主题"), "正文不吞并其他小节");

console.log("5. checkSeedMissing 缺失检测");
const store = new Map(); // 文件 path -> content
const dirs = new Set(); // 目录 path
const fakeApp = {
  vault: {
    getAbstractFileByPath(p) {
      if (store.has(p)) {
        const f = new TFile();
        f.path = p;
        return f;
      }
      if (dirs.has(p)) return { path: p };
      return null;
    },
    async create(p, content) {
      store.set(p, content);
      let d = p.split("/").slice(0, -1).join("/");
      while (d) {
        dirs.add(d);
        d = d.split("/").slice(0, -1).join("/");
      }
    },
  },
};
const s0 = { attachmentTemplateDir: "", contactBookPath: "", requirementDir: "" };
const m0 = checkSeedMissing(fakeApp, s0);
ok(m0.any && m0.missingRules && m0.missingContactBook && m0.missingRequirementDir, "空设置 → 全部缺失");
const s1 = { attachmentTemplateDir: "模板", contactBookPath: "通讯录.md", requirementDir: "需求" };
const m1 = checkSeedMissing(fakeApp, s1);
ok(m1.any && m1.missingRules && m1.missingContactBook && m1.missingRequirementDir, "指向不存在路径 → 缺失");
store.set("模板/01-AI-PM-TOOL规则文件.md", "x");
store.set("通讯录.md", "y");
dirs.add("需求");
const m2 = checkSeedMissing(fakeApp, s1);
ok(!m2.any && !m2.missingRules && !m2.missingContactBook && !m2.missingRequirementDir, "路径齐全 → 无缺失");

console.log("6. ensureMinimalSetup 幂等生成 + 设置联动");
const s = { attachmentTemplateDir: "", contactBookPath: "", requirementDir: "" };
const r1 = await ensureMinimalSetup(fakeApp, s);
eq(r1.createdFiles.length, 5, "首次创建 5 个文件（规则/邮件模板/通讯录/README/示例笔记）");
ok(r1.settingsChanged, "首次调整设置");
eq(s.attachmentTemplateDir, "AI-PM-TOOL", "模板目录 → AI-PM-TOOL");
eq(s.contactBookPath, "AI-PM-TOOL/通讯录名单.md", "通讯录路径 → 种子文件");
eq(s.requirementDir, "AI-PM-TOOL/需求笔记", "需求目录 → 种子目录");
ok(store.has("AI-PM-TOOL/01-AI-PM-TOOL规则文件.md"), "规则文件已创建");
ok(store.has("AI-PM-TOOL/邮件模板/01-上线审核邮件.md"), "邮件模板已创建");
ok(store.has("AI-PM-TOOL/需求笔记/示例需求.md"), "示例需求笔记已创建");
ok(store.has("AI-PM-TOOL/通讯录名单.md") && store.has("AI-PM-TOOL/00-README.md"), "通讯录 + README 已创建");

const r2 = await ensureMinimalSetup(fakeApp, s);
eq(r2.createdFiles.length, 0, "再次调用不创建任何文件（幂等）");
ok(!r2.settingsChanged, "设置不再调整");
eq(s.requirementDir, "AI-PM-TOOL/需求笔记", "需求目录保持不覆盖");

// 已配置且有效的设置：不被种子干扰（用户已有自己的模板目录；独立 store 模拟全新 vault）
const store2 = new Map();
const dirs2 = new Set();
const fakeApp2 = {
  vault: {
    getAbstractFileByPath(p) {
      if (store2.has(p)) {
        const f = new TFile();
        f.path = p;
        return f;
      }
      if (dirs2.has(p)) return { path: p };
      return null;
    },
    async create(p, content) {
      store2.set(p, content);
      let d = p.split("/").slice(0, -1).join("/");
      while (d) {
        dirs2.add(d);
        d = d.split("/").slice(0, -1).join("/");
      }
    },
  },
};
store2.set("模板/01-AI-PM-TOOL规则文件.md", "x");
store2.set("通讯录.md", "y");
dirs2.add("需求");
const s3 = { attachmentTemplateDir: "模板", contactBookPath: "通讯录.md", requirementDir: "需求" };
const r3 = await ensureMinimalSetup(fakeApp2, s3);
eq(r3.createdFiles.length, 4, "用户已有模板/通讯录/需求目录 → 仅补齐种子文件（不含示例笔记）");
ok(!r3.settingsChanged, "已配置设置不被覆盖");
eq(s3.attachmentTemplateDir, "模板", "模板目录保持用户配置");
eq(s3.contactBookPath, "通讯录.md", "通讯录路径保持用户配置");
eq(s3.requirementDir, "需求", "需求目录保持用户配置");
ok(!store2.has("AI-PM-TOOL/需求笔记/示例需求.md"), "不向用户已有需求目录塞示例笔记");

// 已配置模板目录（存在）但缺规则文件：保留用户设置，规则文件补齐到原目录（不覆盖邮件模板配置）
const store4 = new Map();
const dirs4 = new Set();
const fakeApp4 = {
  vault: {
    getAbstractFileByPath(p) {
      if (store4.has(p)) {
        const f = new TFile();
        f.path = p;
        return f;
      }
      if (dirs4.has(p)) return { path: p };
      return null;
    },
    async create(p, content) {
      store4.set(p, content);
      let d = p.split("/").slice(0, -1).join("/");
      while (d) {
        dirs4.add(d);
        d = d.split("/").slice(0, -1).join("/");
      }
    },
  },
};
dirs4.add("模板");
const s4 = { attachmentTemplateDir: "模板", contactBookPath: "", requirementDir: "" };
await ensureMinimalSetup(fakeApp4, s4); // 规则文件补齐到原模板目录
ok(store4.has("模板/01-AI-PM-TOOL规则文件.md"), "规则文件补齐到原模板目录（设置保留）");
ok(!store4.has("模板/邮件模板"), "不向用户模板目录塞邮件模板示例");
eq(s4.attachmentTemplateDir, "模板", "已配置模板目录不被覆盖");
eq(s4.contactBookPath, "AI-PM-TOOL/通讯录名单.md", "通讯录缺失 → 指向种子");
eq(s4.requirementDir, "AI-PM-TOOL/需求笔记", "需求目录缺失 → 指向种子");
ok(store4.has("AI-PM-TOOL/需求笔记/示例需求.md"), "需求目录缺失时生成示例笔记");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
