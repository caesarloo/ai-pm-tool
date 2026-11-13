/**
 * 邮件 MIME 组装冒烟测试（src/mail/smtp.ts 的 buildMessage）
 * - 覆盖：无图无附件（alternative）、仅内嵌图（related + Content-ID + cid 引用）、附件+内嵌图（mixed 套 related）、
 *   仅附件（mixed）、Message-ID 域名取自发件人、中文主题 RFC2047 编码、纯文本里的图片占位
 * - 运行：node tests/mail-mime-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
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

const outDir = mkdtempSync(join(tmpdir(), "ai-pm-mime-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/mail/smtp.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outFile).href);

const CFG = {
  host: "smtp.example.com",
  port: 465,
  encryption: "tls",
  user: "sender",
  pass: "secret",
  from: "sender@example.com",
  fromName: "测试发件人",
};
const IMG = {
  token: "@@AI_PM_IMG_0@@",
  cid: "ai-pm-test-0@ai-pm-tool",
  filename: "x.png",
  mime: "image/png",
  data: new Uint8Array([137, 80, 78, 71]).buffer,
};
const MSG = { to: ["a@example.com"], cc: [], subject: "测试主题", body: "正文内容" };

console.log("1. 无内嵌图、无附件");
{
  const raw = m.buildMessage(CFG, MSG);
  ok(raw.includes("Content-Type: multipart/alternative;"), "顶层 multipart/alternative");
  ok(!raw.includes("multipart/related"), "无 related");
  ok(!raw.includes("multipart/mixed"), "无 mixed");
  ok(/Message-ID: <[^>]+@example\.com>/.test(raw), "Message-ID 存在且域名取自发件人");
  ok(raw.includes("Subject: =?UTF-8?B?"), "中文主题按 RFC2047 编码");
  ok(raw.includes("Content-Type: text/plain") && raw.includes("Content-Type: text/html"), "纯文本 + HTML 双部件");
}

console.log("2. 仅内嵌图（multipart/related）");
{
  const raw = m.buildMessage(CFG, { ...MSG, body: "看图：\n\n@@AI_PM_IMG_0@@", inlineImages: [IMG] });
  ok(/Content-Type: multipart\/related; boundary="[^"]+"; type="multipart\/alternative"/.test(raw), "顶层 multipart/related");
  ok(!raw.includes("multipart/mixed"), "无 mixed");
  ok(raw.includes(`Content-ID: <${IMG.cid}>`), "图片部件带 Content-ID");
  ok(raw.includes(`<img src="cid:${IMG.cid}"`), "HTML 正文用 cid 引用图片");
  ok(!raw.includes(IMG.token), "占位 token 已全部替换");
  ok(raw.includes("[图片：x.png]"), "纯文本部件用图片说明占位");
  ok(raw.includes("Content-Disposition: inline"), "图片是 inline（不是附件）");
  ok(raw.includes("Content-Transfer-Encoding: base64"), "图片 base64 传输");
  ok(raw.indexOf(`--${/boundary="([^"]+)"/.exec(raw)[1]}`) >= 0, "顶层边界可解析");
}

console.log("3. 附件 + 内嵌图（mixed 套 related）");
{
  const raw = m.buildMessage(CFG, {
    ...MSG,
    body: "@@AI_PM_IMG_0@@",
    inlineImages: [IMG],
    attachments: [{ filename: "report.pdf", mime: "application/pdf", data: new Uint8Array([1, 2, 3]).buffer }],
  });
  ok(/Content-Type: multipart\/mixed; boundary="[^"]+"/.test(raw), "顶层 multipart/mixed");
  ok(raw.includes("Content-Type: multipart/related;"), "mixed 内套 multipart/related");
  ok(raw.includes(`Content-ID: <${IMG.cid}>`), "内嵌图 Content-ID 在");
  ok(raw.includes('Content-Disposition: attachment; filename="report.pdf"'), "附件按 attachment 处理");
}

console.log("4. 仅附件（含中文附件名）");
{
  const raw = m.buildMessage(CFG, {
    ...MSG,
    attachments: [{ filename: "报告.pdf", mime: "application/pdf", data: new Uint8Array([0]).buffer }],
  });
  ok(/Content-Type: multipart\/mixed; boundary="[^"]+"/.test(raw), "顶层 multipart/mixed");
  ok(!raw.includes("multipart/related"), "无内嵌图时没有 related");
  ok(raw.includes("Content-Disposition: attachment"), "附件部件存在");
  ok(raw.includes("filename=\"=?UTF-8?B?"), "中文附件名按 RFC2047 编码");
}

console.log("5. 边界串与结构完整性");
{
  const raw = m.buildMessage(CFG, {
    ...MSG,
    body: "@@AI_PM_IMG_0@@",
    inlineImages: [IMG],
    attachments: [{ filename: "a.txt", mime: "text/plain", data: new Uint8Array([65]).buffer }],
  });
  const bounds = [...raw.matchAll(/boundary="([^"]+)"/g)].map((x) => x[1]);
  eq(new Set(bounds).size, bounds.length, "各层边界串互不相同");
  for (const b of bounds) {
    ok(raw.includes(`--${b}--`), `边界 ${b} 有结束行`);
  }
  ok(raw.includes("\r\n"), "报文统一 CRLF");
}

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
