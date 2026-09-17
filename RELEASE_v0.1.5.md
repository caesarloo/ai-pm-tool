# AI PM Tool v0.1.5

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-17

### Update

v0.1.5 replaces the specific port number used in the custom-proxy example with a neutral one.

The error message, the setting description and the source comments all illustrated the "custom proxy" option with one particular port. That number happens to be a common default for local proxy tools, so the example could be read as the value you are expected to enter rather than as a placeholder.

Fix (example text only, no behavior change):

1. Every occurrence now reads `http://127.0.0.1:8080`.
2. Nothing in the proxy path changed: the URL is still parsed, validated and used exactly as before, and any `host:port` value remains acceptable.
3. The three source files that carry the example — `src/llm/gateway.ts`, `src/settings.ts`, `src/types.ts` — are now consistent.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-17

### 版本更新

v0.1.5 把「自定义代理」的示例端口改为中性值。

错误提示、设置项描述与源码注释里的示例都写着一个特定端口号，而它恰好是某些本地代理工具的常见默认值——使用者容易把它理解成「应该填这个值」，而不是「这只是格式示例」。

修复（仅示例文案，行为不变）：

1. 所有出现处统一为 `http://127.0.0.1:8080`。
2. 代理处理链路完全未动：地址的解析、校验与使用方式与之前一致，任何 `host:port` 形式都仍然接受。
3. 承载该示例的三个源码文件 `src/llm/gateway.ts`、`src/settings.ts`、`src/types.ts` 现在保持一致。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
