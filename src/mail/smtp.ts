/**
 * 极简 SMTP 客户端（§4.6 邮件发送）
 * - 纯 Node net/tls 实现，零第三方依赖（Obsidian 插件运行时可用，与 LLM 网关同环境）
 * - 支持三种加密：none(25 明文) / starttls(587 升级) / tls(465 直连 SSL)
 * - 中文主题/发件人名称按 RFC2047 =?UTF-8?B?...?= 编码；正文 UTF-8 8bit + 点填充
 * - 单次会话：EHLO → (STARTTLS+EHLO) → AUTH LOGIN → MAIL FROM → RCPT TO×N → DATA → QUIT
 */
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { log } from "../utils/logger";
import { maskAccount } from "../utils/secure";

export interface SmtpConfig {
  host: string;
  port: number;
  encryption: "none" | "starttls" | "tls";
  user: string;
  pass: string;
  from: string;
  fromName: string;
  timeoutMs?: number;
  skipTlsVerify?: boolean; // 忽略 TLS 证书校验（自签名/内网证书服务器专用；默认 false = 校验证书）
}

/** MIME 附件（二进制内容随邮件发送） */
export interface MailAttachment {
  filename: string;
  mime: string; // 如 application/pdf；缺省按扩展名推断
  data: ArrayBuffer | Uint8Array; // 文件二进制内容
}

export interface MailMessage {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachments?: MailAttachment[];
}

export interface SmtpResult {
  ok: boolean;
  message: string;
}

const CRLF = "\r\n";

/** 单条 SMTP 命令等待响应的超时（服务器中途挂起时避免永久等待；超时即判定会话失效并关闭连接） */
const CMD_TIMEOUT_MS = 15000;

/** DATA 阶段等待最终响应的超时：大附件/服务器病毒扫描时可能远超普通命令（发布审核 P1-3，避免误判超时导致重复发信） */
const DATA_TIMEOUT_MS = 60000;

/** 常见扩展名 → MIME（input.type 为空时兜底） */
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
  rar: "application/vnd.rar",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};

/** 附件 MIME：显式类型优先，其次扩展名推断，兜底 octet-stream */
function mimeFor(a: MailAttachment): string {
  if (a.mime && a.mime !== "application/octet-stream") return a.mime;
  const ext = (a.filename.split(".").pop() ?? "").toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}

/** ASCII 安全文件名原样返回；非 ASCII 用 RFC2047 编码词（Outlook 兼容，扩展名包含在编码中） */
function quotedFilename(name: string): string {
  return /^[\x20-\x7e]+$/.test(name) && !/["\\]/.test(name) ? name : `=?UTF-8?B?${b64(name)}?=`;
}

/** 附件文件名 Content-Disposition：ASCII 直接 filename="name"；非 ASCII 用 RFC2047（filename=…）+
 *  RFC2231（filename*=UTF-8''…）双保险，客户端至少认其中一个且扩展名完整 */
function dispositionFilename(name: string): string {
  const q = quotedFilename(name);
  if (q === name) return `filename="${name}"`;
  return `filename="${q}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** 二进制 → Base64（每行 76 字符，RFC2045） */
function b64Binary(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (typeof Buffer !== "undefined") {
    try {
      const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
      return b.replace(/(.{76})/g, "$1" + CRLF);
    } catch {
      /* 走手写实现 */
    }
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? "=" : chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? "=" : chars[b2 & 63];
  }
  return out.replace(/(.{76})/g, "$1" + CRLF);
}

/** UTF-8 → Base64（Buffer 优先，兜底 TextEncoder 手写） */
function b64(s: string): string {
  if (typeof Buffer !== "undefined") {
    try {
      return Buffer.from(s, "utf8").toString("base64");
    } catch {
      /* 继续走兜底 */
    }
  }
  const bytes = new TextEncoder().encode(s);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? "=" : chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? "=" : chars[b2 & 63];
  }
  return out;
}

/** 非 ASCII 头部值（主题/发件人名称）按 RFC2047 B 编码；纯 ASCII 原样 */
function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`;
}

/** 响应首行三位状态码 */
function respCode(lines: string[]): number {
  const m = /^(\d{3})/.exec(lines[0] ?? "");
  return m ? Number(m[1]) : -1;
}

/** HTML 转义（先转义再套行内标记，避免注入） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 行内 Markdown → HTML（加粗/斜体/行内代码/链接） */
function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Markdown → HTML（标题/表格/待办/无序与有序列表/段落；中文序号「一、」等按普通段落） */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | null = null;
  const closeList = (): void => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };
  // 表格分隔行：| --- | :---: | --- |
  const isSep = (l: string): boolean => /^\|[\s:|-]+\|?$/.test(l);
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      closeList();
      i++;
      continue;
    }
    // 表格：行首 | 且连续 ≥2 行（或含分隔行）
    if (t.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].trim());
        i++;
      }
      const hasSep = rows.length >= 2 && isSep(rows[1]);
      if (hasSep || rows.length >= 2) {
        closeList();
        const cells = (r: string): string[] =>
          r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inlineMd(c.trim()));
        const th = cells(rows[0]).map((c) => `<th style="border:1px solid #ccc;padding:6px 8px;background:#f5f5f5;text-align:left">${c}</th>`).join("");
        out.push(`<table style="border-collapse:collapse;width:100%;margin:8px 0">`);
        out.push(`<thead><tr>${th}</tr></thead>`);
        const bodyRows = hasSep ? rows.slice(2) : rows.slice(1);
        if (bodyRows.length > 0) {
          out.push(`<tbody>${bodyRows.map((r) => `<tr>${cells(r).map((c) => `<td style="border:1px solid #ccc;padding:6px 8px">${c}</td>`).join("")}</tr>`).join("")}</tbody>`);
        }
        out.push("</table>");
        continue;
      }
      // 单行 | 无表格结构：按段落处理
      closeList();
      out.push(`<p>${inlineMd(t)}</p>`);
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      closeList();
      const n = h[1].length;
      out.push(`<h${n}>${inlineMd(h[2])}</h${n}>`);
      i++;
      continue;
    }
    // 待办：- [ ] / - [x]
    const todo = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(t);
    if (todo) {
      if (inList !== "ul") {
        closeList();
        out.push('<ul style="list-style:none;padding-left:4px;margin:8px 0">');
        inList = "ul";
      }
      const done = todo[1] !== " ";
      out.push(`<li style="margin:2px 0">${done ? '<span style="color:#16a34a">☑</span>' : '<span style="color:#7c3aed">☐</span>'} ${inlineMd(todo[2])}</li>`);
      i++;
      continue;
    }
    const ul = /^[-*•]\s+(.*)$/.exec(t);
    if (ul) {
      if (inList !== "ul") {
        closeList();
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${inlineMd(ul[1])}</li>`);
      i++;
      continue;
    }
    const ol = /^(\d+)[.、)]\s+(.*)$/.exec(t);
    if (ol) {
      if (inList !== "ol") {
        closeList();
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${inlineMd(ol[2])}</li>`);
      i++;
      continue;
    }
    closeList();
    out.push(`<p>${inlineMd(t)}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}

/** Markdown → 纯文本（表格转 "a | b" 行、待办转 ☐/☑；去标题/列表/加粗等标记，供纯文本客户端与回写留痕） */
function mdToPlain(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].trim());
        i++;
      }
      // 跳过分隔行，其余行转 "a | b"（空行隔开）
      const body = rows.filter((r) => !/^\|[\s:|-]+\|?$/.test(r));
      if (body.length > 0) {
        out.push("");
        out.push(...body.map((r) => r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).join(" | ")));
        out.push("");
      }
      continue;
    }
    out.push(t);
    i++;
  }
  return out
    .join("\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+\[( |x|X)\]\s+/gm, (_m, s: string) => (s === " " ? "☐ " : "☑ "))
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.、)]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1（$2）");
}

/**
 * 组装 MIME 报文
 * - multipart/mixed：正文 multipart/alternative（纯文本 + HTML，Markdown 自动转标准格式）+ 附件（Base64）
 * - 点填充（行首 "." 加倍）在 sendMail 中对整个报文执行；结束 "." 分隔符在 sendData 中追加
 */
function buildMessage(cfg: SmtpConfig, msg: MailMessage): string {
  const date = new Date().toUTCString();
  const fromAddr = cfg.from.trim();
  const fromName = cfg.fromName.trim();
  const boundary = `=_ai-pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const head: string[] = [];
  head.push(`From: ${fromName ? `${encodeHeader(fromName)} <${fromAddr}>` : fromAddr}`);
  if (msg.to.length > 0) head.push(`To: ${msg.to.join(", ")}`);
  if (msg.cc.length > 0) head.push(`Cc: ${msg.cc.join(", ")}`);
  head.push(`Subject: ${encodeHeader(msg.subject)}`);
  head.push(`Date: ${date}`);
  head.push("MIME-Version: 1.0");
  head.push(
    msg.attachments && msg.attachments.length > 0
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : `Content-Type: multipart/alternative; boundary="${boundary}"`
  );
  head.push("");

  const html = `<html><body style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.7;color:#222">${mdToHtml(
    msg.body
  )}</body></html>`;
  const altBoundary = `=_ai-pm-alt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const altParts: string[] = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    mdToPlain(msg.body),
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${altBoundary}--`,
    "",
  ];

  const parts: string[] = [];
  if (msg.attachments && msg.attachments.length > 0) {
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    parts.push("");
    parts.push(...altParts);
    for (const a of msg.attachments) {
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${mimeFor(a)}; name="${quotedFilename(a.filename)}"`);
      parts.push("Content-Transfer-Encoding: base64");
      parts.push(`Content-Disposition: attachment; ${dispositionFilename(a.filename)}`);
      parts.push("");
      parts.push(b64Binary(a.data));
    }
    parts.push(`--${boundary}--`);
    parts.push("");
  } else {
    parts.push(`--${boundary}`);
    parts.push('Content-Type: text/plain; charset="UTF-8"');
    parts.push("Content-Transfer-Encoding: 8bit");
    parts.push("");
    parts.push(mdToPlain(msg.body));
    parts.push(`--${boundary}`);
    parts.push('Content-Type: text/html; charset="UTF-8"');
    parts.push("Content-Transfer-Encoding: 8bit");
    parts.push("");
    parts.push(html);
    parts.push(`--${boundary}--`);
    parts.push("");
  }
  return head.join(CRLF) + CRLF + parts.join(CRLF);
}

/** SMTP 会话：逐命令 请求/响应（响应以 `250 ` 这类「三位码+空格」行收尾，支持 250- 多行） */
class SmtpSession {
  private sock: Socket | null = null;
  private buf = "";
  private pendingLines: string[] = [];
  private idleLines: string[] = []; // 无等待者时收到的行（如服务器初始 220 问候）
  private responders: Array<(lines: string[]) => void> = [];
  private closed = false;

  private onData(chunk: Buffer | string): void {
    this.buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      if (this.responders.length > 0) {
        this.pendingLines.push(line);
        if (/^\d{3} /.test(line)) {
          const resp = this.pendingLines.splice(0);
          const resolve = this.responders.shift()!;
          resolve(resp);
        }
      } else {
        // 尚无等待者：缓存起来（服务器主动推送的行，典型是连接后的 220 问候）
        this.idleLines.push(line);
      }
    }
  }

  /** 读取服务器主动推送的行（连接后的初始 220 问候）；已收到则立即返回；timeoutMs 内未收到返回空数组（不阻塞） */
  greeting(timeoutMs?: number): Promise<string[]> {
    if (this.idleLines.length > 0) {
      const resp = this.idleLines.splice(0);
      return Promise.resolve(resp);
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          const i = this.responders.indexOf(waiter);
          if (i >= 0) this.responders.splice(i, 1);
          resolve([]);
        }, timeoutMs);
      }
      const waiter = (lines: string[]): void => {
        if (timer) clearTimeout(timer);
        resolve(lines);
      };
      this.responders.push(waiter);
    });
  }

  private failAll(e: Error): void {
    const waiters = this.responders.splice(0);
    this.pendingLines = [];
    for (const w of waiters) w([`999 ${e.message}`]);
  }

  connect(host: string, port: number, encryption: SmtpConfig["encryption"], timeoutMs: number, skipTlsVerify = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const raw: Socket =
        encryption === "tls"
          ? tlsConnect({ host, port, servername: host, rejectUnauthorized: !skipTlsVerify })
          : netConnect({ host, port });
      const timer = setTimeout(() => {
        raw.destroy();
        reject(new Error(`连接超时（${host}:${port}）`));
      }, timeoutMs);
      raw.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      raw.once("connect", () => {
        clearTimeout(timer);
        this.attach(raw);
        resolve();
      });
      raw.once("secureConnect", () => {
        clearTimeout(timer);
        this.attach(raw);
        resolve();
      });
    });
  }

  private attach(s: Socket): void {
    if (this.sock === s) return; // TLS 直连时 socket 会先发 connect 再发 secureConnect，防止 data 监听重复注册
    this.sock = s;
    s.on("data", (chunk) => this.onData(chunk));
    s.on("error", (e) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    s.on("close", () => {
      this.closed = true;
      this.failAll(new Error("SMTP 连接已关闭"));
    });
  }

  /** 发送单行命令并等待完整响应 */
  cmd(line: string): Promise<string[]> {
    return this.sendData(line + CRLF);
  }

  /** 写入原始数据（DATA 内容 + 结束点），并等待下一条响应；超时无响应则判定会话超时并关闭连接（DATA 阶段用更长超时） */
  sendData(data: string, timeoutMs = CMD_TIMEOUT_MS): Promise<string[]> {
    if (this.closed || !this.sock) return Promise.resolve(["999 SMTP 连接不可用"]);
    return new Promise((resolve) => {
      const respond = (lines: string[]): void => {
        clearTimeout(timer);
        resolve(lines);
      };
      const timer = setTimeout(() => {
        const i = this.responders.indexOf(respond);
        if (i >= 0) this.responders.splice(i, 1);
        this.failAll(new Error(`SMTP 响应超时（${timeoutMs}ms 未收到响应）`));
        this.close();
        resolve([`999 SMTP 响应超时（${timeoutMs}ms），连接已关闭`]);
      }, timeoutMs);
      this.responders.push(respond);
      this.sock!.write(data, (err) => {
        if (err) {
          const i = this.responders.indexOf(respond);
          if (i >= 0) this.responders.splice(i, 1);
          clearTimeout(timer);
          resolve([`999 ${err.message}`]);
        }
      });
    });
  }

  /** STARTTLS 后升级为 TLS 连接（复用原 socket，重建 data 监听） */
  upgradeTls(servername: string, skipTlsVerify = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const raw = this.sock;
      if (!raw) return reject(new Error("连接不可用"));
      raw.removeAllListeners("data");
      const tlsSock = tlsConnect({ socket: raw, servername, rejectUnauthorized: !skipTlsVerify });
      tlsSock.once("error", (e) => reject(e));
      tlsSock.once("secureConnect", () => {
        this.attach(tlsSock);
        resolve();
      });
    });
  }

  close(): void {
    this.closed = true;
    try {
      this.sock?.destroy();
    } catch {
      /* 忽略 */
    }
    this.sock = null;
  }
}

/** 常见网络错误 → 中文排查提示 */
function hintFor(e: Error): string {
  const msg = `${e.name} ${e.message}`;
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME/.test(msg)) return "域名解析失败（DNS）——检查网络连接或主机名是否正确";
  if (/ECONNREFUSED/.test(msg)) return "连接被拒绝——端口未开放或服务器未监听该端口";
  if (/ECONNRESET|EPIPE/.test(msg)) return "连接被重置——服务器可能要求加密（STARTTLS/SSL）或拒绝当前端口";
  if (/ETIMEDOUT|timeout|超时/i.test(msg)) return "连接超时——网络不通或端口被防火墙/运营商拦截";
  if (/certificate|CERT_|self.signed/i.test(msg)) return "TLS 证书校验失败";
  return "";
}

/** SMTP 邮箱地址合法性：拒绝 CR/LF/NUL/空白及 SMTP 特殊字符（<>()[]\\",;:），防邮件头/命令注入 */
export function isValidEmailAddr(s: string): boolean {
  return /^[^\s@<>()[\]\\",;:]+@[^\s@<>()[\]\\",;:]+\.[^\s@<>()[\]\\",;:]+$/.test(s);
}

/** 发送一封邮件；失败返回 ok:false + 原因（不抛异常） */
export async function sendMail(cfg: SmtpConfig, msg: MailMessage): Promise<SmtpResult> {
  const host = cfg.host.trim();
  const from = cfg.from.trim();
  if (!host) return { ok: false, message: "未配置 SMTP 服务器" };
  if (!from) return { ok: false, message: "未配置发件人邮箱" };
  if (!isValidEmailAddr(from)) return { ok: false, message: `发件人邮箱格式非法：${maskAccount(from)}（不能含空格/换行等字符）` };
  const port = cfg.port || (cfg.encryption === "tls" ? 465 : cfg.encryption === "starttls" ? 587 : 25);
  const timeoutMs = cfg.timeoutMs ?? 20000;
  if (cfg.encryption === "none" && (cfg.user || cfg.pass)) {
    log.warn(`SMTP 明文（无加密）发送：${host}:${port} 上账号密码将明文传输，建议改用 SSL/TLS（465）或 STARTTLS（587）`);
  }
  log.debug(`SMTP 发送开始：${host}:${port} 加密=${cfg.encryption} 账号=${cfg.user ? maskAccount(cfg.user) : "(空)"} 收件人=${msg.to.length} 抄送=${msg.cc.length}`);

  const s = new SmtpSession();
  try {
    await s.connect(host, port, cfg.encryption, timeoutMs, cfg.skipTlsVerify);

    // 先消费服务器主动推送的 220 问候，避免其与 EHLO 响应混淆（经典竞态）
    const greet = await s.greeting(10000);
    if (greet.length > 0 && respCode(greet) !== 220) throw new Error(`服务器初始响应异常：${greet.join(" ")}`);

    let resp = await s.cmd(`EHLO ${host}`);
    if (respCode(resp) !== 250) {
      // 老服务器不支持 EHLO：回退 HELO
      resp = await s.cmd(`HELO ${host}`);
      if (respCode(resp) !== 250) throw new Error(`EHLO/HELO 失败：${resp.join(" ")}`);
    }

    if (cfg.encryption === "starttls") {
      resp = await s.cmd("STARTTLS");
      if (respCode(resp) !== 220) throw new Error(`STARTTLS 失败：${resp.join(" ")}`);
      await s.upgradeTls(host, cfg.skipTlsVerify);
      // 部分服务器 TLS 握手后重发 220 问候，先消费掉（2 秒内没收到则不阻塞）
      await s.greeting(2000);
      resp = await s.cmd(`EHLO ${host}`);
      if (respCode(resp) !== 250) throw new Error(`TLS 升级后 EHLO 失败：${resp.join(" ")}`);
    }

    // 身份验证：优先 AUTH LOGIN；服务器不支持时回退 AUTH PLAIN（`\0账号\0密码`）
    const AUTH_FAIL_HINT = "请检查用户名与密码/授权码（企业邮箱通常要求客户端授权码而非登录密码；部分服务器要求账号不带域名后缀）";
    resp = await s.cmd("AUTH LOGIN");
    if (respCode(resp) === 334) {
      const authLogin = async (user: string): Promise<string[]> => {
        let r = await s.cmd(b64(user));
        if (respCode(r) !== 334) throw new Error(`认证失败（账号）：${r.join(" ")}。${AUTH_FAIL_HINT}`);
        r = await s.cmd(b64(cfg.pass));
        return r;
      };
      resp = await authLogin(cfg.user);
      if (respCode(resp) === 535 && cfg.user.includes("@")) {
        // 部分企业服务器要求账号不带域名后缀：535 已中止 AUTH 交换，需重新发起 AUTH LOGIN 再用 @ 前缀重试
        const bare = cfg.user.split("@")[0];
        log.debug(`AUTH 535：重新发起 AUTH LOGIN，用裸账号 ${maskAccount(bare)} 重试一次`);
        resp = await s.cmd("AUTH LOGIN");
        if (respCode(resp) === 334) resp = await authLogin(bare);
      }
      if (respCode(resp) !== 235) throw new Error(`认证失败（${resp.join(" ")}）。${AUTH_FAIL_HINT}`);
    } else if (respCode(resp) === 504 || respCode(resp) === 502) {
      // 服务器不支持 AUTH LOGIN：尝试 AUTH PLAIN
      resp = await s.cmd(`AUTH PLAIN ${b64(`\u0000${cfg.user}\u0000${cfg.pass}`)}`);
      if (respCode(resp) !== 235) throw new Error(`认证失败（AUTH PLAIN：${resp.join(" ")}）。${AUTH_FAIL_HINT}`);
    } else if (respCode(resp) === 999) {
      // 会话级错误（命令超时/连接关闭）：直接透出原始信息
      throw new Error(resp.join(" "));
    } else if (respCode(resp) !== 503) {
      throw new Error(`服务器不支持 AUTH LOGIN：${resp.join(" ")}`);
    }

    resp = await s.cmd(`MAIL FROM:<${from}>`);
    if (respCode(resp) !== 250) throw new Error(`MAIL FROM 被拒：${resp.join(" ")}`);

    const tos = [...new Set([...msg.to, ...msg.cc].map((x) => x.trim()).filter(Boolean))];
    if (tos.length === 0) throw new Error("没有可发送的收件人");
    const invalid = tos.filter((t) => !isValidEmailAddr(t));
    if (invalid.length > 0) throw new Error(`以下收件人地址非法（不能含空格/换行等字符）：${invalid.join("、")}`);
    for (const t of tos) {
      resp = await s.cmd(`RCPT TO:<${t}>`);
      if (respCode(resp) !== 250 && respCode(resp) !== 251) throw new Error(`收件人 ${t} 被拒：${resp.join(" ")}`);
    }

    // 附件总大小上限（25MB）：超出直接拒绝，避免全量内存 base64 膨胀拖垮 Obsidian
    const atts = msg.attachments ?? [];
    const attTotal = atts.reduce((n, a) => n + a.data.byteLength, 0);
    if (attTotal > 25 * 1024 * 1024) {
      throw new Error(`附件总大小超过上限（${(attTotal / 1048576).toFixed(1)}MB > 25MB），请压缩后重试`);
    }

    resp = await s.cmd("DATA");
    if (respCode(resp) !== 354) throw new Error(`DATA 被拒：${resp.join(" ")}`);
    // 整个报文统一 CRLF 行尾 + 点填充（行首 "." 加倍），最后追加结束 "." 分隔符
    const data = buildMessage(cfg, msg).replace(/\r?\n/g, CRLF).replace(/^\./gm, "..") + CRLF + "." + CRLF;
    resp = await s.sendData(data, DATA_TIMEOUT_MS);
    if (respCode(resp) !== 250) {
      // 结果不确定（999 超时/连接中断）：服务器可能已接收，明确提示先检查收件箱再决定是否重发（发布审核 P1-3，避免重复发信）
      if (respCode(resp) === 999) {
        throw new Error(`邮件投递结果不确定（${resp.join(" ")}）：服务器可能已接收，请先检查收件箱再决定是否重新发送`);
      }
      throw new Error(`邮件内容被拒：${resp.join(" ")}`);
    }

    await s.cmd("QUIT").catch(() => undefined);
    const attN = atts.length;
    log.debug(`SMTP 发送成功：${host}:${port}${attN > 0 ? `，附件 ${attN} 个` : ""}`);
    return { ok: true, message: `已发送（${host}:${port}，收件人 ${tos.length} 人${attN > 0 ? `，附件 ${attN} 个` : ""}）` };
  } catch (e) {
    const raw = (e as Error).message;
    // 会话级错误（999：命令超时/连接关闭）本身已说明原因，不再叠加网络排查提示
    const hint = raw.startsWith("999 ") ? "" : hintFor(e as Error);
    log.warn(`SMTP 发送失败：${raw}${hint ? `（${hint}）` : ""}`);
    return { ok: false, message: `${raw}${hint ? `；${hint}` : ""}` };
  } finally {
    s.close();
  }
}
