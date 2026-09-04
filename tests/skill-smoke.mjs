/**
 * SKILL 章节提取 / 编码映射 / 允许列表 / 规则校验 冒烟测试（P1 · 0.1.0 生成需求审核）
 * 运行：node tests/skill-smoke.mjs（经 esbuild 打包后执行，见 package.json test 脚本）
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

// ===== 精简 SKILL 样例（结构与真实 SKILL 一致；其中组织/编码均为虚构占位「示例」/AA-BB-CC 系，非真实公司信息）=====
const SAMPLE = `# 需求提报助手

## 工作流概览
（无关内容：会议纪要等杂项不应进入审核上下文）

### 场景1: 需求名称生成
### 触发条件
用户填写了需求归属、业务需求分类、需求背景后需要生成三段式需求名称。
### 命名规则
**格式**: [需求命名财务编码]-[业务需求分类]-[需求描述][标识]
### 需求归属 → 财务编码映射表
| 需求归属（缩写） | 需求命名财务编码 |
|-----------------|-----------------|
| 示例一 | AA |
| 示例-二 | BB01 |
| 示例三（试行） | CC02 |
### 名称生成规则
1. 需求描述控制在 8-15 字以内
2. 去除冗余词：如"实现"、"开发"、"功能"等
### 示例
| 输入 | 输出 |
|------|------|
| 示例一 / 示例分类一 / 需求描述示例 | AA-示例分类一-需求描述示例 |

### 场景2: 预期价值审核
### 触发条件
用户填写了需求描述和预期价值后，需要对预期价值描述进行质量审核。
### 审核标准
#### 通过条件（满足其一即可）
1. 完全量化且逻辑自洽：包含历史基线值、目标值、提升/下降比例
2. 核心要素存在但比例缺失（宽容通过）
### 输出格式
{"审核结果":"通过/不通过","不通过原因":["原因"],"改进建议":["建议"]}

### 场景3: 需求归属校验（规划接口）
调用 https://plan.example.com 接口校验需求归属是否在规划内（本插件不调用网络接口）。

### 场景4: 业务需求分类校验
### 触发条件
用户填写产品线/需求分类后，需校验分类是否在允许范围内。
### 允许的产品线/需求分类列表
示例分类一、示例分类二、示例分类三、示例分类四、示例分类五、示例分类六、示例分类七、示例分类八、示例分类九、示例分类十
### 校验规则
- 输入值必须在上述列表中（精确匹配，忽略前后空格）

### 场景5: 汇总判断与Excel输出
（跳过，非审核规则）

### 场景6: 用户输入字段
### 成本承担方可选项
示例一、示例-二、示例三（试行）、示例四、示例五、示例六

### 场景8: 从流程表转换为填报模板
（跳过）

### 场景8: 手工审核已填报模板
### 审核清单
#### 1. 字段完整性检查
- 必填字段是否都有值
#### 3. 成本承担方校验
- 值必须在成本承担方可选列表中
#### 5. 预期价值审核（人工预审标准）
- 数值内部矛盾（最容易被忽略）
`;

const outDir = mkdtempSync(join(tmpdir(), "ai-pm-skill-"));
const stubPath = join(import.meta.dirname, "obsidian-stub.mjs");
await build({
  entryPoints: ["src/review/skill.ts", "src/review/checks.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  external: ["node:fs", "node:path", "node:util", stubPath],
  plugins: [
    {
      name: "obsidian-stub-external",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: pathToFileURL(stubPath).href, external: true }));
      },
    },
  ],
  outdir: outDir,
  logLevel: "silent",
});
const skillMod = await import(pathToFileURL(join(outDir, "skill.js")).href);
const checkMod = await import(pathToFileURL(join(outDir, "checks.js")).href);
const { parseReviewSkill, normText } = skillMod;
const { checkRequirementName, checkDateField, checkRequirementId, checkValuesInList } = checkMod;

console.log("1. 章节提取：命中 需求名称/预期价值/业务分类/手工审核，排除 规划接口/汇总/转换 场景");
const skill = parseReviewSkill(SAMPLE);
ok(skill !== null, "解析成功");
ok(skill.context.includes("需求归属 → 财务编码映射表"), "场景1 名称规则（映射表）入上下文");
ok(skill.context.includes("命名规则"), "场景1 命名规则入上下文");
ok(!skill.context.includes("plan.example.com"), "场景3（规划接口）不入上下文");
ok(skill.context.includes("允许的产品线/需求分类列表"), "场景4 分类列表入上下文");
ok(!skill.context.includes("Excel输出"), "场景5 汇总不入上下文");
ok(skill.context.includes("字段完整性检查"), "场景8 手工审核清单入上下文");
ok(skill.valueRules.includes("审核标准"), "valueRules = 场景2 预期价值审核章节");
ok(!skill.valueRules.includes("字段完整性"), "valueRules 不含手工清单章节");

console.log("2. 编码映射 / 允许列表 / 成本承担方可选项解析");
eq(skill.codeByBearer.get("示例一"), "AA", "示例一 → AA");
eq(skill.codeByBearer.get(normText("示例二")), "BB01", "归一化匹配：示例-二 → BB01");
eq(skill.codeByBearer.get(normText("示例三试行")), "CC02", "归一化匹配：示例三（试行）→ CC02");
eq(skill.bearerByCode.get("AA"), "示例一", "反查：AA → 示例一");
ok(skill.bizCategories.includes("示例分类一") && skill.bizCategories.includes("示例分类十"), "业务分类列表解析");
eq(skill.bizCategories.length, 10, "业务分类列表完整（10 项样例）");
ok(skill.costBearers.includes("示例一") && skill.costBearers.includes("示例三（试行）"), "成本承担方可选项解析");
eq(skill.costBearers.length, 6, "成本承担方可选项完整（6 项样例）");

console.log("3. 需求名称三段式校验（R）");
const pass = checkRequirementName("AA01-示例分类一-示例需求描述一", skill);
eq(pass.level, "pass", "合规三段式通过（编码前缀容错 AA01 → AA）");
const badCode = checkRequirementName("NN99-示例分类一-示例需求描述一", skill);
eq(badCode.level, "fail", "首段编码不在映射 → fail");
const badCat = checkRequirementName("AA01-未列分类-示例需求描述一", skill);
eq(badCat.level, "fail", "中段分类不在允许列表 → fail");
const shortName = checkRequirementName("AA01-示例分类一-样例", skill);
eq(shortName.level, "warn", "描述过短（<4 字）→ warn");
const tooShort = checkRequirementName("示例需求描述一", skill);
eq(tooShort.level, "fail", "不足三段 → fail");
const noSkill = checkRequirementName("示例需求描述一", null);
eq(noSkill.level, "pass", "SKILL 缺失 → 名称校验跳过（pass）");

console.log("4. 日期 / 需求编号 / 列表值校验");
const dOk = checkDateField("需求评审日期", "2026-10-02", { "需求评审日期": "2026-10-02", "开发投入日期": "2026-10-17", "计划上线日期": "2026-10-30" });
eq(dOk.level, "pass", "日期格式正确且先后有序 → pass");
const dBad = checkDateField("计划上线日期", "2026-10-01", { "需求评审日期": "2026-10-02", "开发投入日期": "2026-10-17", "计划上线日期": "2026-10-01" });
eq(dBad.level, "warn", "上线早于评审 → warn");
const dFmt = checkDateField("需求评审日期", "2026/10/02", {});
eq(dFmt.level, "fail", "日期格式非 YYYY-MM-DD → fail");
eq(checkRequirementId("").level, "warn", "需求编号留空 → warn（预期状态）");
eq(checkRequirementId("2026-001").level, "pass", "需求编号已填 → pass");
const lst = checkValuesInList("归属业务线", ["示例单位一"], ["示例分类一", "示例分类二"]);
eq(lst.level, "warn", "列表值不在允许列表 → warn");

console.log("5. 全无审核章节 → null（提取失败）");
const noSec = parseReviewSkill("# 标题\n\n只有普通内容，没有场景标题\n");
eq(noSec, null, "无审核场景 → null（调用方跳过审核并提示一次）");

// ===== 公司口径「需求内容生成 SKILL」（03）同构样例（组织/编码均为虚构占位「示例」/AA 系）=====
const SAMPLE_03 = `# 需求内容生成（公司口径）

对应公司《需求提报规范》。本文件只用于「✨ 新增需求」内容生成，审核以审核 SKILL（02）为准。

## 场景1: 需求名称生成

### 命名规则

格式：\`[财务编码]-[产品线]-[需求名]\`（示例：\`AA01-示例产品一-示例需求甲\`）
- 财务编码两档：档位一 → AA01；档位二（档位二子情形）→ AA03；不要用裸 AA / AA02

### 示例

| 输入 | 输出 |
|------|------|
| 示例输入一 | AA01-示例产品一-示例需求甲 |
| 示例输入二 | AA03-示例产品三-示例需求乙 |

### 需求归属 → 财务编码映射表

| 需求归属（业务域） | 需求命名财务编码 |
|-------------------|-----------------|
| 示例域一 | AA01 |
| 示例域二 | AA03 |

### 业务部门 → 产品线映射表

| 业务部门 | 产品线 |
|---------|--------|
| 示例单位一 | 示例产品一 |
| 示例单位三 | 示例产品三 |
| 示例单位五 | 示例产品五 |

### 允许的产品线/需求分类列表

示例产品一、示例产品二、示例产品三、示例产品四、示例产品五、示例产品六

### 允许的业务部门列表

示例单位一、示例单位二、示例单位三、示例单位四、示例单位五、其他

### 名称生成规则

1. 判定档位：属于档位二的情形 → AA03；否则 AA01
2. 中段产品线只取允许列表中的一项

### 生成输出要求

- 需求名称 = 建议文件名（不带 .md）
- 不要输出：需求编号、状态、邮件标志键
`;

console.log("6. 内容生成 SKILL（03 口径）解析：编码/产品线/业务部门/上下文");
const gen = parseReviewSkill(SAMPLE_03);
ok(gen !== null, "03 解析成功");
eq(gen.codeByBearer.get(normText("示例域一")), "AA01", "示例域一 → AA01（档位一编码）");
eq(gen.codeByBearer.get(normText("示例域二")), "AA03", "示例域二 → AA03（档位二编码）");
ok(![...gen.codeByBearer.values()].includes("AA"), "不含裸 AA（两档编码 AA01/AA03）");
eq(gen.bearerByCode.get("AA01"), "示例域一", "反查：AA01 → 示例域一");
ok(gen.bizCategories.includes("示例产品一") && gen.bizCategories.includes("示例产品六"), "产品线列表解析");
eq(gen.bizCategories.length, 6, "产品线列表 6 项（公司口径）");
ok(gen.depts.includes("示例单位一") && gen.depts.includes("示例单位五"), "业务部门列表解析");
eq(gen.depts.length, 6, "业务部门列表 6 项");
ok(gen.context.includes("示例需求甲") && gen.context.includes("示例需求乙"), "context 含命名示例");
ok(gen.context.includes("不要输出：需求编号"), "context 覆盖到文件尾部小节（单场景收集）");

console.log("7. 03 口径名称校验（R，内容 SKILL 数据源）");
const okGen1 = checkRequirementName("AA01-示例产品一-示例需求甲", gen);
eq(okGen1.level, "pass", "AA01-示例产品一-示例需求甲（规范原例）→ pass");
const okGen2 = checkRequirementName("AA03-示例产品三-示例需求乙", gen);
eq(okGen2.level, "pass", "AA03-示例产品三-…（产品线在列表）→ pass");
const mixGen = checkRequirementName("AA03-示例产品二-示例需求丙", gen);
eq(mixGen.level, "pass", "R 只查格式：首段 AA03 + 中段产品线均在允许集合 → pass（档位语义一致性靠 L 审核与人工）");
const badGenCat = checkRequirementName("AA01-未列产品线-示例需求甲", gen);
eq(badGenCat.level, "fail", "中段不在 6 产品线 → fail");

rmSync(outDir, { recursive: true, force: true });
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
