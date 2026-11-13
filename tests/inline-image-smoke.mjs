/**
 * 正文图片引用解析冒烟测试（src/mail/inlineImages.ts）
 * - 覆盖：wikilink `![[...]]` / markdown `![](...)`、别名与锚点、URL 编码、外链跳过、非图片跳过、
 *   文件不存在跳过、同一张图重复引用复用 Content-ID、无图片时正文不变
 * - 运行：node tests/inline-image-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
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

const outDir = mkdtempSync(join(tmpdir(), "ai-pm-inline-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/mail/inlineImages.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: outFile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outFile).href);

// ---- 模拟 vault：鸭子类型的 TFile（path/extension/name） ----
const FILES = {
  "产品需求/Attachments/a.png": { path: "产品需求/Attachments/a.png", name: "a.png", extension: "png" },
  "附件/中文 图.jpg": { path: "附件/中文 图.jpg", name: "中文 图.jpg", extension: "jpg" },
  "附件/说明.pdf": { path: "附件/说明.pdf", name: "说明.pdf", extension: "pdf" },
};
const APP = {
  vault: {
    getAbstractFileByPath: (p) => FILES[p] ?? null,
    readBinary: async () => new Uint8Array([137, 80, 78, 71]).buffer,
  },
  metadataCache: {
    // 模拟 Obsidian 的最短路径/同名解析
    getFirstLinkpathDest: (target) =>
      Object.values(FILES).find((f) => f.path === target || f.name === target || f.path.endsWith("/" + target)) ?? null,
  },
};
const collect = (body, app = APP) => m.collectInlineImages(app, body, "产品需求/ZF01-测试需求.md");

console.log("1. 工具函数");
eq(m.imageMimeByPath("a.png"), "image/png", "png → image/png");
eq(m.imageMimeByPath("a.JPG"), "image/jpeg", "大写扩展名也识别");
eq(m.imageMimeByPath("a.pdf"), null, "pdf 不算图片");
eq(m.normalizeImageTarget("https://example.com/a.png"), null, "外链不内嵌");
eq(m.normalizeImageTarget("产品需求/Attachments/a.png"), "产品需求/Attachments/a.png", "普通路径原样");
eq(m.normalizeImageTarget("<附件/a.png>"), "附件/a.png", "尖括号包裹去壳");
eq(m.normalizeImageTarget("附件/a.png \"标题\""), "附件/a.png", "去掉 title");

console.log("2. wikilink 引用");
{
  const r = await collect("看图：![[Attachments/a.png]]");
  eq(r.images.length, 1, "命中 1 张图");
  eq(r.images[0].mime, "image/png", "MIME 正确");
  eq(r.images[0].filename, "a.png", "文件名取自 TFile.name");
  ok(!r.body.includes("![[Attachments/a.png]]"), "原引用被替换为 token");
  ok(r.body.includes(r.images[0].token), "正文里是占位 token");
  ok(/^ai-pm-.+@ai-pm-tool$/.test(r.images[0].cid), "Content-ID 形态正确");
}
{
  const r = await collect("![[a.png|300]]");
  eq(r.images.length, 1, "带 |别名 仍能解析");
}
{
  const r = await collect("![[a.png#锚点]]");
  eq(r.images.length, 1, "带 #锚点 仍能解析");
}

console.log("3. markdown 引用 + URL 编码");
{
  const r = await collect("![](产品需求/Attachments/a.png)");
  eq(r.images.length, 1, "标准 markdown 图片解析");
  eq(r.skipped.length, 0, "无跳过项");
}
{
  const r = await collect("![](附件/%E4%B8%AD%E6%96%87%20%E5%9B%BE.jpg)");
  eq(r.images.length, 1, "URL 编码路径可解码");
  eq(r.images[0].filename, "中文 图.jpg", "中文文件名保留");
}

console.log("4. 不内嵌的形态（保留原文并计入 skipped）");
{
  const r = await collect("![外链](https://example.com/a.png) 和 ![[说明.pdf]] 和 ![[missing.png]]");
  eq(r.images.length, 0, "外链/非图片/不存在 → 0 张内嵌");
  eq(r.skipped.length, 3, "三处都计入 skipped");
  ok(r.body.includes("https://example.com/a.png"), "外链原文保留");
  ok(r.body.includes("![[说明.pdf]]"), "非图片原文保留");
  ok(r.body.includes("![[missing.png]]"), "缺失文件原文保留");
}

console.log("5. 重复引用复用 Content-ID");
{
  const r = await collect("![[a.png]]\n\n再次 ![[a.png]]");
  eq(r.images.length, 1, "同一张图只内嵌一次");
  eq(r.body.split(r.images[0].token).length - 1, 2, "两处都替换成同一 token");
}

console.log("6. 无图片时正文不变");
{
  const body = "各位好：\n\n本周进展正常，无附图。\n\n谢谢！";
  const r = await collect(body);
  eq(r.body, body, "正文原样返回");
  eq(r.images.length, 0, "无内嵌图");
  eq(r.skipped.length, 0, "无跳过项");
}

console.log("7. 读取失败（文件被删）不阻塞");
{
  const app = {
    vault: { getAbstractFileByPath: () => FILES["产品需求/Attachments/a.png"], readBinary: async () => { throw new Error("EACCES"); } },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
  const r = await collect("![[a.png]]", app);
  eq(r.images.length, 0, "读取失败 → 不内嵌");
  eq(r.skipped.length, 1, "计入 skipped");
  ok(r.body.includes("![[a.png]]"), "原文保留，不丢内容");
}

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
