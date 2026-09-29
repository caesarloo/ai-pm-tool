# AI PM Tool v0.1.9

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-09-29

### Update

v0.1.9 is a source-only fix: it clears the three review warnings reported on `src/utils/svnConflictText.ts` and changes no runtime behaviour — the rebuilt bundle is byte-for-byte identical to the v0.1.8 release asset.

**1. Redundant `string` removed from the conflict-source union**

The conflict descriptor declared its source as `"status" | "tree" | "marker" | string`. A trailing `string` absorbs the three literals, so the type collapsed back to plain `string` and static review reported each literal as "overridden by string in this union type" — three warnings out of one line.

The union is now closed: `"status" | "tree" | "marker"`. That matches the shape it was written to mirror — `SvnConflict.source` in `@caesarloo/simple-svn-client@0.2.0` is already declared as exactly this closed union — so every assignment site still type-checks, and an unknown source coming from the client can no longer pass unnoticed.

**2. No behaviour change**

The edit is a type annotation, which the bundler erases. The rebuilt `dist/main.js` is byte-for-byte identical to the v0.1.8 release asset (SHA256 `F77BFBF4385B5D93DAE1C2A6B318B9202D1F7AE45E9E2F69A74AF4114AE969C6`, measured 2026-09-29). Upgrading or rolling back is therefore risk-free with respect to runtime behaviour.

**3. Compatibility**

- No new Obsidian API is used, so `minAppVersion` remains 1.13.0.
- No configuration, note format or SVN handling changed.

`npm run typecheck`, `npm run lint` (0 warnings), `npm test` (12 suites) and `npm run build` all pass (measured 2026-09-29).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-09-29

### 版本更新

v0.1.9 是纯源码层修复：清掉 `src/utils/svnConflictText.ts` 上的三条审核告警，运行时行为零变化——重新构建的产物与 v0.1.8 发布附件逐字节一致。

**1. 去掉冲突来源联合类型里冗余的 `string`**

冲突条目的来源此前声明为 `"status" | "tree" | "marker" | string`。尾部的 `string` 会把前面三个字面量整体吸收，类型退化成普通 `string`，于是静态审核逐条报出「被 string 覆盖」——一行代码报出三条告警。

现在联合类型收口为 `"status" | "tree" | "marker"`。这正是它本要镜像的形状：`@caesarloo/simple-svn-client@0.2.0` 的 `SvnConflict.source` 本就声明为该封闭联合；因此所有赋值点仍然通过类型检查，同时来自组件的未知来源不再可能被无声放行。

**2. 无行为变化**

本次改动只是类型标注，会被打包器擦除。重新构建的 `dist/main.js` 与 v0.1.8 发布附件逐字节一致（SHA256 `F77BFBF4385B5D93DAE1C2A6B318B9202D1F7AE45E9E2F69A74AF4114AE969C6`，2026-09-29 实测）。就运行时行为而言，升级或回退都无风险。

**3. 兼容性**

- 未使用新的 Obsidian API，`minAppVersion` 仍为 1.13.0。
- 配置、笔记格式、SVN 处理方式均未变化。

`npm run typecheck`、`npm run lint`（0 warning）、`npm test`（12 套）、`npm run build` 全部通过（2026-09-29 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
