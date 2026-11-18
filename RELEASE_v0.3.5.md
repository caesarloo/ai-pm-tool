# AI PM Tool v0.3.5

[English](#english) | [中文](#chinese)

---

## English

**Release Date:** 2026-11-18

### Update

v0.3.5 fixes the "wrong mailbox password loses the draft" dead end: when a mail fails to send, the result page now offers a **Modify mail settings** button that opens the plugin's SMTP settings page without closing the mail dialog, so the edited recipients, subject, body and attachments are kept. No configuration or data-format change.

**1. Edit SMTP settings without leaving the dialog**

When sending fails (for example a wrong mailbox password / authorization code), the result page previously offered only "Back to preview" and "Send again". To change the password you had to close the dialog, go to Settings, and the edited mail was lost. A third button, **Modify mail settings**, now opens this plugin's settings tab (`Settings → AI PM Tool → Mail (SMTP)`) while the mail dialog stays open; fix the password, come back and press "Send again" — the new settings are read at send time, so no restart is needed.

**2. Clearer failure hint**

The failure message now reads "not written back to the requirement note; you can retry, go back to edit, or modify the mail settings".

**3. Compatibility**

- No configuration or data-format change; existing notes and sent-mail records are untouched.
- `minAppVersion` remains 1.13.0; no new Obsidian API is used.
- Sending success, attachment reading and inline-image behavior are unchanged.

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass (measured 2026-11-18).

### Release Assets

- `dist/main.js` - Plugin main program
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

---

## Chinese / 中文

**发布日期：** 2026-11-18

### 版本更新

v0.3.5 修掉「邮箱密码错误就丢稿」的死路：发送失败的结果页新增 **⚙️ 修改邮箱配置** 按钮，点击可打开插件设置里的 SMTP 配置页而**不关闭邮件弹窗**，已编辑的收件人、主题、正文和附件都保留。配置与数据格式均未变化。

**1. 不离开弹窗就能改邮箱配置**

发送失败（如邮箱密码／授权码错误）时，结果页原先只有「返回预览修改」和「重新发送」。要改密码就得关掉弹窗去设置，已编辑的邮件随之丢失。现在新增第三个按钮 **⚙️ 修改邮箱配置**，点击打开本插件设置页（设置 → AI PM Tool → 邮件发送（SMTP）），邮件弹窗保持打开；改好密码回到弹窗点「重新发送」即可——发送时会重新读取配置，无需重启。

**2. 失败提示更明确**

失败提示改为「未回写需求笔记，可重试、返回修改或修改邮箱配置」。

**3. 兼容性**

- 配置与数据格式均未变化；既有笔记与已发送邮件记录不受影响。
- `minAppVersion` 仍为 1.13.0；未使用新的 Obsidian API。
- 发送成功路径、附件读取与正文内嵌图行为均未改动。

`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部通过（2026-11-18 实测）。

### 发布附件

- `dist/main.js` - 插件主程序
- `dist/manifest.json` - 插件清单
- `dist/styles.css` - 插件样式
