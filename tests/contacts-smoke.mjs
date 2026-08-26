/**
 * contacts 冒烟测试：通讯录解析（姓名/邮箱 索引 + 公共邮箱名称）+ 收件人「名称（邮箱）」展示格式
 * - 新格式：姓名|邮箱 两列；兼容旧版 姓名|工号|邮箱 三列（忽略工号列，不再按工号推导邮箱）
 * 运行：node tests/contacts-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
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

// ===== 样例（新格式两列：姓名|邮箱；数据为虚构占位） =====
const SAMPLE = `# 通讯录名单（示例）

## 一、全体名单

| 姓名 | 邮箱 |
| --- | --- |
| 张三 | zhangsan@example.com |
| 李四 | lisi@example.com |
| 待补充 | sunqi@example.com |

## 二、公共邮箱（部门邮件组）

| 名称 | 邮箱 |
| -- | -- |
| 项目公共组 | project-group@example.com |
`;

// ===== 打包并加载源码 =====
// 注：obsidian 用 onResolve external 指向 stub 文件（而非 alias 内联），
// 保证 bundle 与测试脚本 import 的是同一模块实例（TFile instanceof 判定需要）
const outDir = mkdtempSync(join(tmpdir(), "ai-pm-contact-"));
const outFile = join(outDir, "bundle.mjs");
const stubPath = join(import.meta.dirname, "obsidian-stub.mjs");
await build({
  entryPoints: ["src/notes/contacts.ts"],
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
const { parseContactBook, emptyContactBook, formatRecipient, loadContactBook, appendContactToBook } = mod;

// ===== 用例 =====
console.log("1. 通讯录解析（姓名|邮箱 两列）");
const book = parseContactBook(SAMPLE);
eq(book.byName.get("张三"), "zhangsan@example.com", "姓名 → 邮箱");
eq(book.byName.get("李四"), "lisi@example.com", "李四 → 邮箱");
eq(book.byEmail.get("zhangsan@example.com"), "张三", "邮箱 → 姓名（展示反查）");
ok(!book.byEmail.has("sunqi@example.com"), "「待补充」姓名不入 byEmail（展示回退原邮箱）");
eq(book.groups, ["project-group@example.com"], "公共邮箱列表");
eq(book.groupNames.get("project-group@example.com"), "项目公共组", "公共邮箱 → 名称");
eq(emptyContactBook().groups, [], "空通讯录结构完整");
ok(book.byId === undefined, "不再有 工号 → 邮箱 索引（byId 已移除）");

console.log("2. 收件人「名称（邮箱）」展示格式");
eq(formatRecipient("zhangsan@example.com", book), "张三（zhangsan@example.com）", "个人：名称（邮箱）");
eq(formatRecipient("project-group@example.com", book), "项目公共组（project-group@example.com）", "公共邮箱：名称（邮箱）");
eq(formatRecipient("sunqi@example.com", book), "sunqi@example.com", "待补充无名称 → 原样邮箱");
eq(formatRecipient("unknown@example.com", book), "unknown@example.com", "陌生邮箱 → 原样");
eq(formatRecipient("赵七", book), "赵七", "中文姓名占位 → 原样");
eq(formatRecipient("zhangsan@example.com", null), "zhangsan@example.com", "无通讯录 → 原样");
eq(formatRecipient("", book), "", "空值 → 空串");
eq(formatRecipient("  zhangsan@example.com  ", book), "张三（zhangsan@example.com）", "邮箱首尾空白容错");

console.log("3. loadContactBook 路径语义（留空不加载 / 显式路径唯一入口）");
const bookStore = {
  "自定义/通讯录名单.md": SAMPLE,
  "模板目录/通讯录名单.md": SAMPLE,
};
// 模拟 Obsidian normalizePath（折叠 ./.. 段）——getAbstractFileByPath 会对路径做规范化
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
      if (!(key in bookStore)) return null;
      const f = new TFile();
      f.path = key;
      return f;
    },
    async read(f) {
      return bookStore[f.path];
    },
  },
};
const b1 = await loadContactBook(fakeApp, "自定义/通讯录名单.md");
eq(b1.byName.get("张三"), "zhangsan@example.com", "显式路径命中 → 载入通讯录");
const b2 = await loadContactBook(fakeApp, "");
eq(b2.byName.size, 0, "留空 → 不加载通讯录（即使模板目录下存在同名文件）");
eq(b2.groups.length, 0, "留空 → 公共邮箱列表为空");
const b3 = await loadContactBook(fakeApp, undefined);
eq(b3.groups.length, 0, "未传参 → 同留空，不加载");
const b4 = await loadContactBook(fakeApp, "  自定义/通讯录名单.md  ");
eq(b4.byName.get("李四"), "lisi@example.com", "显式路径首尾空白容错");
const b5 = await loadContactBook(fakeApp, "不存在的/通讯录.md");
eq(b5.groups.length, 0, "显式路径未命中 → 空通讯录（不自动回退）");

console.log("4. appendContactToBook 自动补充（用户维护邮箱 → 写入「全体名单」表）");
const appended = appendContactToBook(SAMPLE, "孙七", "sunqi7@example.com");
eq(appended.includes("| 孙七 | sunqi7@example.com |"), true, "两列表 → 新行按两列追加");
eq(appended.indexOf("| 孙七 |") < appended.indexOf("## 二、公共邮箱"), true, "追加位置在公共邮箱小节之前");
eq(appended.split("| 孙七 | sunqi7@example.com |").length, 2, "未重复追加");
const parsedAfter = parseContactBook(appended);
eq(parsedAfter.byName.get("孙七"), "sunqi7@example.com", "追加后可解析 姓名 → 邮箱");
const noTable = appendContactToBook("## 通讯录\n\n没有表格的文档", "张三", "a@b.com");
eq(noTable, "## 通讯录\n\n没有表格的文档", "无表格 → 原样返回不落盘");

console.log("5. 旧三列格式兼容（姓名|工号|邮箱：忽略工号列，不再按工号推导邮箱）");
const LEGACY = `# 通讯录名单

## 一、收件人名单

| 姓名  | 工号       | 邮箱                  |
| --- | -------- | ------------------- |
| 周杰  | 04070344 | zhoujie@example.com |
| 吴敏  | 10085332 | wumin@example.com  |

## 二、抄送邮箱

| 名称 | 邮箱 |
| -- | -- |
| 产研组 | cy@example.com |
`;
const b6 = parseContactBook(LEGACY);
eq(b6.byName.get("周杰"), "zhoujie@example.com", "三列旧格式 → 第三列邮箱正常解析（工号列忽略）");
eq(b6.groups, ["cy@example.com"], "「抄送邮箱」标题识别为公共邮箱列表");
eq(b6.groupNames.get("cy@example.com"), "产研组", "抄送邮箱 → 名称");
const b6b = parseContactBook(`## 收件人名单

| 姓名 | 工号 | 邮箱 |
| --- | --- | --- |
| 张三 | 10001 | |
`);
eq(b6b.byName.size, 0, "旧格式仅工号无邮箱 → 跳过（不再推导 工号@域名）");
const appended2 = appendContactToBook(LEGACY, "孙七", "sunqi7@example.com");
eq(appended2.includes("| 孙七 | 待补充 | sunqi7@example.com |"), true, "旧三列表 → 新行按三列追加（工号填待补充，保持列对齐）");
const parsedLegacy = parseContactBook(appended2);
eq(parsedLegacy.byName.get("孙七"), "sunqi7@example.com", "三列追加后 姓名 → 邮箱 正常解析");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
