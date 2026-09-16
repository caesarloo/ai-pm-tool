# AI PM Tool v0.1.2

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-16

### Update

v0.1.2 clears the four warnings from the automated Obsidian plugin review and promotes the matching rules into the local lint config so they cannot come back:

1. **`@typescript-eslint/no-unsafe-argument` (parser)** — in the frontmatter serializer an inline key holding a list went through `Array.isArray(raw)`, which widens `unknown` to `any[]`; the items were passed straight into a `string` parameter. Items are now read as `unknown[]` and converted with `String(…)` before the single-line cleanup — identical output, no `any` leak.
2. **Promise in a void-expecting argument (settings)** — the model provider "Test" button passed an `async` closure to `addEventListener`. The work moved into a named `runProbe(): Promise<void>` with a synchronous `() => void runProbe()` wrapper. Behaviour is unchanged.
3. **`window.setTimeout` (settings)** — `setTimeout(syncTitle, 0)` in the long-path input helper is now `window.setTimeout(…)` for popout-window compatibility.
4. **CSS `extended-system-fonts`** — the requirement-body textarea font stack used `ui-monospace` (`font-family: var(--font-monospace, ui-monospace, Consolas, monospace)`), a browser feature not supported by Obsidian 1.11.4. The `ui-monospace` fallback was dropped; the stack is now `var(--font-monospace, Consolas, monospace)`. The rest of the stylesheet was checked — no other `ui-*` / `system-ui` font family remains, and no bare `setTimeout` / `setInterval` / `requestAnimationFrame` call remains in `src/`.

Also in this release: `eslint.config.mjs` now enforces `obsidianmd/prefer-window-timers`, `@typescript-eslint/no-unsafe-argument` and `@typescript-eslint/no-misused-promises` (all at error level, verified with `--print-config`), so local `npm run lint` matches what the review bot scans.

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-16

### 版本更新

v0.1.2 清掉 Obsidian 自动化插件审核的 4 条 warning，并把对应规则前移到本地 lint，避免再次出现：

1. **`@typescript-eslint/no-unsafe-argument`（parser）** — frontmatter 序列化中「内联键但值为列表」分支经 `Array.isArray(raw)` 把 `unknown` 收窄成 `any[]`，列表项直接流入 `string` 参数。现按 `unknown[]` 读取、先 `String(…)` 再单行化——输出完全一致，不再有 `any` 泄漏。
2. **Promise 传入 void 回调（settings）** — 模型 provider 的「测试」按钮把 `async` 闭包直接交给 `addEventListener`。现改为命名函数 `runProbe(): Promise<void>` + 同步包装 `() => void runProbe()`，行为不变。
3. **`window.setTimeout`（settings）** — 长路径输入框辅助函数里的 `setTimeout(syncTitle, 0)` 改为 `window.setTimeout(…)`（popout 窗口兼容）。
4. **CSS `extended-system-fonts`** — 需求正文 textarea 的字体栈用了 `ui-monospace`（`font-family: var(--font-monospace, ui-monospace, Consolas, monospace)`），该浏览器特性在 Obsidian 1.11.4 不受支持。已去掉 `ui-monospace`，现为 `var(--font-monospace, Consolas, monospace)`。全样式表已复查：无其他 `ui-*` / `system-ui` 字体族；`src/` 中也无裸 `setTimeout` / `setInterval` / `requestAnimationFrame` 调用。

本次同时在 `eslint.config.mjs` 启用 `obsidianmd/prefer-window-timers`、`@typescript-eslint/no-unsafe-argument`、`@typescript-eslint/no-misused-promises`（均为 error 级，已用 `--print-config` 验证生效），本地 `npm run lint` 与审核 bot 扫描口径一致。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
