/**
 * parser 冒烟测试：用真实产品需求模板样例验证 frontmatter 解析
 * 运行：node tests/parser-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
 * 注：通过 esbuild bundle 运行，因为 src 使用无扩展名相对导入。
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ===== 通用样例（frontmatter 结构示例；业务内容完全虚构） =====
const SAMPLE_REQ = `---
需求名称: 订单导出性能优化
需求编号: 2026-001
需求背景简述: 导出功能在数据量增大后响应超时
功能点:
  - 分页导出
  - 异步任务通知
预估工作量: 43人天
需求评审日期: 2026-07-21
需求状态: 已评审通过
开发投入日期: 2026-08-01
计划上线日期: 2026-08-25
项目状态: 进行中
重点项目: true
已批准: false
进展说明: 接口改造完成 80%
项目经理: 张三
产品经理: 王五
技术经理: 赵六
业务对接人: 李四
需求评审邮件: true
工作量评估邮件: true
项目准入邮件: true
上线审核邮件: false
报备客服邮件: false
生产验证邮件: false
生产监控邮件: false
商户接入文档评审邮件: false
商户上线申请单评审邮件: false
测试案例评审: false
---

# 订单导出性能优化
正文…
`;

const SAMPLE_EMPTY = `# 无 frontmatter`;

const SAMPLE_NEWFORMAT = `---
需求名称: 新格式需求
需求编号: 2026-099
功能点: 单行功能点
需求状态: 未开始
---

# 新格式需求
`;

// ===== 断言工具 =====
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

// ===== 打包并加载源码 =====
const outDir = mkdtempSync(join(tmpdir(), "ai-pm-test-"));
const outFile = join(outDir, "bundle.mjs");
await build({
  entryPoints: ["src/notes/parser.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: outFile,
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outFile).href);
const { extractFrontmatterBlock, parseFrontmatter, parseRequirementNote, isNewFormatVariant } = mod;

// ===== 用例 =====
console.log("1. frontmatter 区块提取");
ok(extractFrontmatterBlock(SAMPLE_REQ) !== null, "需求笔记含 frontmatter");
ok(extractFrontmatterBlock(SAMPLE_EMPTY) === null, "无 frontmatter 返回 null");

console.log("2. 需求笔记解析");
const req = parseRequirementNote("产品需求/订单导出性能优化.md", SAMPLE_REQ);
eq(req.name, "订单导出性能优化", "笔记名（去 .md）");
eq(req.requestStatus, "已评审通过", "需求状态");
eq(req.projectStatus, "进行中", "项目状态");
eq(req.effort, "43人天", "预估工作量");
eq(req.reviewDate, "2026-07-21", "需求评审日期");
eq(req.devStartDate, "2026-08-01", "开发投入日期");
eq(req.planOnlineDate, "2026-08-25", "计划上线日期");
eq(req.progress, "接口改造完成 80%", "进展说明");
eq(req.keyProject, true, "重点项目");
eq(req.roles["项目经理"], ["张三"], "项目经理角色");
eq(req.roles["产品经理"], ["王五"], "产品经理角色");
eq(req.roles["技术经理"], ["赵六"], "技术经理角色");
eq(req.mailFlags["需求评审邮件"], true, "需求评审邮件标志 true");
eq(req.mailFlags["上线审核邮件"], false, "上线审核邮件标志 false");
eq(req.mailFlags["测试案例评审"], false, "测试案例评审标志 false");

console.log("3. 新格式变体容错");
const nf = parseRequirementNote("产品需求/新格式需求.md", SAMPLE_NEWFORMAT);
eq(nf.projectStatus, null, "新格式无项目状态 → null（不报错）");
ok(isNewFormatVariant(nf.raw), "识别需求名称/需求编号变体");
eq(parseFrontmatter(SAMPLE_EMPTY), {}, "无 frontmatter 返回空对象");

console.log("4. 类型转换");
const fm = parseFrontmatter(SAMPLE_REQ);
eq(fm["重点项目"], true, "boolean true");
eq(fm["已批准"], false, "boolean false");
eq(typeof fm["预估工作量"], "string", "工作量保持字符串");
eq(fm["功能点"], ["分页导出", "异步任务通知"], "列表解析");

console.log("5. 列表风格布尔/数字（updateFrontmatter 写入后的回读，§4.6 邮件标志）");
const fmList = parseFrontmatter(`---
上线审核邮件:
  - true
预估工作量:
  - 43
项目状态:
  - 进行中
---

# 测试
`);
eq(fmList["上线审核邮件"], [true], "列表项 true → boolean 数组");
eq(fmList["预估工作量"], [43], "列表项 43 → number 数组");
eq(fmList["项目状态"], ["进行中"], "列表项中文保持字符串");

console.log("5b. 邮件标志回读（parseRequirementNote 视角，§4.6 关键路径）");
const reqList = parseRequirementNote("产品需求/测试.md", `---
上线审核邮件:
  - true
重点项目:
  - true
报备客服邮件: false
---

# 测试
`);
eq(reqList.mailFlags["上线审核邮件"], true, "列表风格 true → mailFlags true");
eq(reqList.mailFlags["报备客服邮件"], false, "内联 false → mailFlags false");
eq(reqList.keyProject, true, "列表风格重点项目 → true");

console.log("6. 内联列表类型转换");
const fmInline = parseFrontmatter(`---
负责人: [张三, 王五]
重点项目: [true, false]
---

# 测试
`);
eq(fmInline["负责人"], ["张三", "王五"], "内联列表中文");
eq(fmInline["重点项目"], [true, false], "内联列表布尔");

rmSync(outDir, { recursive: true, force: true });

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
