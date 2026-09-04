/**
 * retry 冒烟测试：isRetryableLlmError 可重试性判定（创建需求 LLM 自动重试）
 * - 401/403/404 与其它 4xx（429 除外）、参数/配置类错误 → 不可重试
 * - 空响应/超时/429/5xx/未知（含 Error.cause 链包装的 LlmError）→ 可重试
 * 运行：node tests/retry-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

// ===== 打包并加载源码（retry.ts 无外部依赖） =====
const outDir = mkdtempSync(join(tmpdir(), "ai-pm-retry-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/llm/retry.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: outFile,
  logLevel: "silent",
});
const { isRetryableLlmError } = await import(pathToFileURL(outFile).href);

// ===== 用例 =====
console.log("1. HTTP 状态码判定");
ok(!isRetryableLlmError({ status: 401, message: "认证失败（401）：API Key 无效" }), "401 → 不重试（密钥无效）");
ok(!isRetryableLlmError({ status: 403, message: "认证失败（403）" }), "403 → 不重试");
ok(!isRetryableLlmError({ status: 404, message: "模型返回错误 404" }), "404 → 不重试（地址错）");
ok(!isRetryableLlmError({ status: 400, message: "模型返回错误 400" }), "400 → 不重试（参数错）");
ok(isRetryableLlmError({ status: 429, message: "模型返回错误 429" }), "429 → 重试（限流，稍候重试有意义）");
ok(isRetryableLlmError({ status: 502, message: "模型返回错误 502" }), "5xx → 重试");

console.log("2. 无 status 的消息判定（网关/本地错误）");
ok(isRetryableLlmError({ message: "模型返回内容为空" }), "空 content → 重试（网关偶发空响应）");
ok(isRetryableLlmError({ message: "模型返回非 JSON 内容：" }), "空 body → 重试（网关偶发空响应）");
ok(isRetryableLlmError({ message: "模型请求超时（60s）：请检查网络或模型服务响应速度" }), "超时 → 重试");
ok(!isRetryableLlmError({ message: "未启用任何模型：请在设置中启用一个" }), "未启用模型 → 不重试（配置）");
ok(!isRetryableLlmError({ message: "未配置 API Key：请在 设置 → 大模型… 中填写" }), "未配置 Key → 不重试（配置）");
ok(!isRetryableLlmError({ message: "模型地址未配置" }), "地址未配置 → 不重试");
ok(!isRetryableLlmError({ message: "自定义代理地址无效" }), "代理地址无效 → 不重试");

console.log("3. Error.cause 链（业务层 new Error(msg,{cause}) 包装 LlmError）");
ok(
  isRetryableLlmError(new Error("LLM 生成失败：模型返回内容为空（已回到输入页…）", { cause: { message: "模型返回内容为空" } })),
  "cause=空响应 → 重试"
);
ok(
  !isRetryableLlmError(new Error("LLM 生成失败：认证失败（已回到输入页…）", { cause: { status: 401 } })),
  "cause=401 → 不重试"
);
ok(
  isRetryableLlmError(new Error("外层错误", { cause: new Error("中层错误", { cause: { status: 500 } }) })),
  "多层 cause 链 5xx → 重试"
);
ok(isRetryableLlmError(null), "null → 默认重试");
ok(isRetryableLlmError("字符串错误"), "非对象 → 默认重试");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
