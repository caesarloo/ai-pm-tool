/**
 * LLM 网关（§5）
 * - OpenAI 兼容协议（/v1/chat/completions），支持任意兼容模型服务（本地/云端，统称自定义模型）
 * - 可配置多个 provider，单选启用一个，所有场景统一使用
 * - 网络方式（设置 → 网络方式，§5）：
 *   跟随系统代理（Electron/Chromium fetch，默认，继承操作系统代理设置）
 *   直连无代理（Node https，绕过系统代理直接连接）
 *   自定义代理（Node https + CONNECT 隧道，如 http://127.0.0.1:7897）
 * - 敏感信息脱敏（§5 / §7）；所有请求均输出详细日志（模式/地址/耗时/错误码），便于排查网络问题
 */
import { requestUrl } from "obsidian";
import type { AIPMSettings, LLMProvider } from "../types";
import { log } from "../utils/logger";
import { request as nodeHttpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { request as nodeHttpsRequest, Agent as HttpsAgent, type RequestOptions as HttpsRequestOptions } from "node:https";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";
import type { Duplex } from "node:stream";

/** LLM 思考硬开关（全局默认）：true = 请求附 thinking:{"type":"disabled"}——
 *  ⚠️ 2026-09 实测：SMB 网关未透传该参数（响应仍含 reasoning_content；同请求重试秒回缓存同 id），
 *  当前网关下实际无效、无害保留（兼容未来支持/其它网关）；防截断靠 max_tokens 放大；
 *  若网关 400 拒绝该字段，改回 false 移除 */
const LLM_DISABLE_THINKING = true;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 调用结果：正文 + 用量（输入/输出/缓存命中，兼容 DeepSeek prompt_cache_hit_tokens 与 OpenAI prompt_tokens_details.cached_tokens）+ 耗时 */
export interface ChatResult {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cacheHitTokens?: number;
  };
  elapsedMs: number;
}

/** 上限探测结果（设置页「测试上限」）：可用输出上限（最后成功档位）+ 错误消息解析出的模型上下文上限（若有） */
export interface OutputLimitProbe {
  maxOutputTokens: number; // 实测可用的 max_tokens 档位（安全保守值）
  contextTokens?: number; // 网关错误消息解析的模型上下文上限
  note: string;
}

export class LlmError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** 敏感信息脱敏：手机号/邮箱/金额/连续数字串 -> 占位符（§5 脱敏） */
export function maskSensitive(text: string): string {
  return text
    .replace(/1[3-9]\d{9}/g, "[手机号]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱]")
    .replace(/(?:人民币|￥|¥)\s?\d[\d,.]*/g, "[金额]")
    .replace(/\b\d{8,}\b/g, "[长数字]");
}

/** 解析代理地址（http://主机:端口），非法返回 null */
function parseProxyUrl(raw: string): { host: string; port: number } | null {
  if (!raw) return null;
  const m = /^https?:\/\/([^:/]+)(?::(\d+))?/.exec(raw.trim());
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : 80 };
}

/** 从网关错误消息解析模型上下文上限（vllm/OpenAI 常见措辞），解析不到返回 undefined */
function extractContextLimit(text: string): number | undefined {
  const m =
    /maximum\s+(?:context|model)\s+length\s+is\s+(\d+)/i.exec(text) ??
    /max_model_len[^\d]{0,24}(\d+)/i.exec(text) ??
    /(\d{4,})\s+tokens?/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

/** HTTPS 走 HTTP 代理（CONNECT 隧道）的 Agent：先连代理发 CONNECT，再 TLS 到目标 */
class ConnectAgent extends HttpsAgent {
  constructor(
    private proxyHost: string,
    private proxyPort: number
  ) {
    super({ keepAlive: false });
  }
  createConnection(options: ConnectionOptions, cb: (err: Error | null, socket?: Duplex) => void): Duplex {
    const host = String(options.host ?? "");
    const port = Number(options.port ?? 443);
    const raw = netConnect({ host: this.proxyHost, port: this.proxyPort });
    raw.on("error", (e) => cb(e, undefined));
    raw.on("connect", () => {
      raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const idx = buffered.indexOf("\r\n\r\n");
      if (idx < 0) return;
      raw.off("data", onData);
      const head = buffered.subarray(0, idx).toString("latin1");
      const m = /^HTTP\/1\.[01]\s+(\d{3})/.exec(head);
      if (!m || m[1] !== "200") {
        raw.destroy();
        cb(new Error(`代理 CONNECT 失败：${head.split("\r\n")[0] || head}`), undefined);
        return;
      }
      const rest = buffered.subarray(idx + 4);
      const tls = tlsConnect({
        socket: raw,
        servername: host,
        host,
        port,
      });
      if (rest.length > 0) tls.unshift(rest);
      cb(null, tls);
    };
    raw.on("data", onData);
    // 关键：不能 return raw —— Node https.Agent 在 createConnection 有返回值时使用返回值并忽略回调
    // （实测会以明文 HTTP 经隧道发往目标 443，HTTPS 请求失败且请求内容明文过代理）。
    // 与 npm `tunnel` 包一致：仅通过回调返回 TLS socket，返回值保持 undefined。
    return undefined as unknown as Duplex;
  }
}

/** 用 Node http/https 发 POST（不走 Electron fetch，可绕开/使用代理）；proxy=null 时直连 */
function requestWithNode(
  url: URL,
  headers: Record<string, string>,
  body: string,
  proxy: { host: string; port: number } | null,
  timeoutMs: number
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let req: ClientRequest;
    const onResponse = (res: IncomingMessage): void => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    };
    if (url.protocol === "https:") {
      const opts: HttpsRequestOptions = {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        headers,
        // 自定义代理用 CONNECT 隧道 Agent；直连用 agent:false（绕过任何全局代理）
        agent: proxy ? new ConnectAgent(proxy.host, proxy.port) : false,
      };
      req = nodeHttpsRequest(opts, onResponse);
    } else if (proxy) {
      // http 目标走代理：请求行直接写完整 URL
      req = nodeHttpRequest(
        { hostname: proxy.host, port: proxy.port, method: "POST", path: url.href, headers },
        onResponse
      );
    } else {
      req = nodeHttpRequest(
        { method: "POST", hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, headers },
        onResponse
      );
    }
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export class LLMGateway {
  constructor(private settings: AIPMSettings) {}

  getActiveProvider(): LLMProvider | null {
    const p = this.settings.llmProviders.find((x) => x.id === this.settings.activeProviderId);
    return p ?? null;
  }

  /** 探测指定 provider 的 max_tokens 可用上限（设置页「测试上限」按钮；与启用状态无关）：
   *  小 prompt（"hi"）先试 32768 → 131072；32768 被拒则降档 8192 → 4096；
   *  400 错误体按 vllm/OpenAI 常见措辞解析「模型上下文上限」一并返回；最多 4 次请求 */
  async probeOutputLimit(provider: LLMProvider): Promise<OutputLimitProbe> {
    if (!provider.baseUrl) throw new LlmError("模型地址未配置");
    if (!provider.apiKey) throw new LlmError("未配置 API Key：请先在密钥栏填写");
    const base = provider.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) throw new LlmError("模型地址需以 http:// 或 https:// 开头");
    const url = new URL(base + "/chat/completions");
    const mode: "system" | "direct" | "custom" = this.settings.llmProxyMode ?? "system";
    const proxy = mode === "custom" ? parseProxyUrl(this.settings.llmProxyUrl) : null;
    if (mode === "custom" && !proxy) {
      throw new LlmError("自定义代理地址无效：请填写形如 http://127.0.0.1:7897 的代理地址");
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    };
    if (mode !== "system") {
      // Node 请求默认 UA 是 "node"，部分网关/WAF 会拦截；与 chat 同模拟浏览器 UA
      headers["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    }
    const send = async (maxTokens: number): Promise<{ status: number; text: string }> => {
      const body = JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: "hi" }],
        temperature: 0,
        max_tokens: maxTokens,
      });
      if (mode === "system") {
        let timer: number | undefined;
        try {
          const req = requestUrl({
            url: url.href,
            method: "POST",
            contentType: "application/json",
            headers,
            body,
            throw: false,
          }).then((r) => ({ status: r.status, text: r.text }));
          const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new LlmError("探测请求超时（30s）")), 30000);
          });
          return await Promise.race([req, timeout]);
        } finally {
          if (timer !== undefined) window.clearTimeout(timer);
        }
      }
      return requestWithNode(url, headers, body, proxy, 30000);
    };
    const tryStep = async (t: number): Promise<{ ok: true; status: number } | { ok: false; status: number; text: string }> => {
      try {
        const r = await send(t);
        return r.status === 200 ? { ok: true, status: r.status } : { ok: false, status: r.status, text: r.text };
      } catch (e) {
        return { ok: false, status: 0, text: (e as Error).message };
      }
    };

    // ① 连通性验证：512 对任何模型都远低于上限——失败即为地址/密钥/网络问题，先于上限试探报错（语义清晰）
    const conn = await tryStep(512);
    if (!conn.ok) {
      const st = conn.status;
      if (st === 401 || st === 403) {
        throw new LlmError(`测试失败：认证错误（${st}）——API Key 无效或网关拒绝，请核对密钥后重试`, st);
      }
      if (st === 0) throw new LlmError(`测试失败（网络错误）：${conn.text}`);
      throw new LlmError(`测试失败（HTTP ${st}）：${conn.text.slice(0, 160)}`, st);
    }

    // ① 升档：32768 可用则再试 131072（确认是否大上下文）
    const hi = await tryStep(32768);
    if (hi.ok) {
      const hi2 = await tryStep(131072);
      if (hi2.ok) return { maxOutputTokens: 131072, note: "131072 档可用（上限 ≥ 131072，远大于插件默认）" };
      const c2 = extractContextLimit(hi2.text);
      return {
        maxOutputTokens: 32768,
        contextTokens: c2,
        note: c2 ? `131072 档被拒（模型上下文上限 ${c2.toLocaleString()}）→ 按 32768 保存` : "131072 档被拒 → 按 32768 保守保存",
      };
    }
    // ② 降档确认：32768 被拒（超上下文）→ 8192 → 4096
    const context = extractContextLimit(hi.text);
    const mid = await tryStep(8192);
    if (mid.ok) {
      return {
        maxOutputTokens: 8192,
        contextTokens: context,
        note: context ? `32768 被拒（模型上下文上限 ${context.toLocaleString()}）→ 8192 可用` : "32768 被拒 → 8192 档可用",
      };
    }
    const low = await tryStep(4096);
    if (low.ok) {
      return {
        maxOutputTokens: 4096,
        contextTokens: context,
        note: context ? `上限较紧（模型上下文 ${context.toLocaleString()}）→ 按 4096 保存` : "32768/8192 被拒 → 4096 档可用",
      };
    }
    const tail = (hi.text || mid.text || low.text || "").slice(0, 160).replace(/\s+/g, " ");
    throw new LlmError(
      `上限探测失败：4096 档仍不可用${context ? `（错误提示上下文上限 ${context.toLocaleString()}）` : ""}${tail ? `——响应：${tail}` : "（请检查地址/密钥/模型名）"}`
    );
  }

  /** 调用当前启用模型（单选；无启用模型时抛错）；返回正文 + 用量 + 耗时 */
  async chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; disableThinking?: boolean } = {}): Promise<ChatResult> {
    const provider = this.getActiveProvider();
    if (!provider) throw new LlmError("未启用任何模型：请在设置中启用一个「自定义模型」（单选）");
    if (!provider.baseUrl) throw new LlmError("模型地址未配置");
    if (!provider.apiKey) {
      throw new LlmError("未配置 API Key：请在 设置 → 大模型（自定义模型）→ 密钥 中填写");
    }

    // 仅允许 http/https，且日志前剥除 URL 中的 userinfo 凭据（防 baseUrl 含 user:pass 时泄露到日志）
    const base = provider.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) throw new LlmError("模型地址需以 http:// 或 https:// 开头");
    const url = new URL(base + "/chat/completions");
    const urlForLog = url.href.replace(/\/\/([^/@]+)@/, "//***@");

    const mode: "system" | "direct" | "custom" = this.settings.llmProxyMode ?? "system";
    const proxy = mode === "custom" ? parseProxyUrl(this.settings.llmProxyUrl) : null;
    if (mode === "custom" && !proxy) {
      throw new LlmError("自定义代理地址无效：请填写形如 http://127.0.0.1:7897 的代理地址");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;
    if (mode !== "system") {
      // Node 请求默认 UA 是 "node"，部分网关/WAF 会拦截；模拟浏览器 UA
      headers["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    }

    const payload: Record<string, unknown> = {
      model: provider.model,
      messages: messages.map((m) =>
        this.settings.maskSensitive ? { ...m, content: maskSensitive(m.content) } : m
      ),
      temperature: opts.temperature ?? 0.3,
      // 推理模型（DeepSeek-V4-Flash 等）的 reasoning_content 思考也计入 max_tokens，且思考长度不稳定
      // （同描述曾 2000~2600 tokens，也曾 >4000 截断致 content 为空）：上限给 16384（实测该网关 ≥131072 可用），
      // 思考自然收敛后 content 必有空间；也保证「重试=新请求」（请求体变化绕过网关同响应缓存）
      max_tokens: opts.maxTokens ?? 16384,
    };
    const disableThinking = opts.disableThinking ?? LLM_DISABLE_THINKING;
    if (disableThinking) {
      // 关闭思考（DeepSeek 官方兼容参数 thinking:{type:"disabled"}）：默认全局硬编码生效；
      // ⚠️ 实测 SMB 网关未透传（响应仍带 reasoning_content）——无害保留，兼容未来支持/其它网关；
      // reasoning_effort（low/medium/high）实测同样无效已于 2026-09 移除；若网关 400 拒绝该字段，改常量 LLM_DISABLE_THINKING=false
      payload.thinking = { type: "disabled" };
    }
    const body = JSON.stringify(payload);

    const t0 = Date.now();
    const modeName = mode === "system" ? "跟随系统代理" : mode === "direct" ? "直连无代理" : `自定义代理 ${proxy ? proxy.host + ":" + proxy.port : ""}`;
    log.debug(
      `LLM 请求开始：网络方式=${modeName} url=${urlForLog} model=${provider.model} 超时=60s` +
        (provider.apiKey ? ` apiKey=${provider.apiKey.length}字符` : " apiKey=未配置") +
        (disableThinking ? " 思考=禁用" : " 思考=开启")
    );

    let res: { status: number; text: string };
    if (mode === "system") {
      // Obsidian requestUrl（Electron 网络栈）：继承操作系统代理设置
      try {
        let timer: number | undefined;
        try {
          const request = requestUrl({
            url: url.href,
            method: "POST",
            contentType: "application/json",
            headers,
            body,
            throw: false,
          }).then((r) => ({ status: r.status, text: r.text }));
          const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new LlmError("模型请求超时（60s）：请检查网络或模型服务响应速度")),
              60000
            );
          });
          res = await Promise.race([request, timeout]);
        } finally {
          if (timer !== undefined) window.clearTimeout(timer);
        }
        log.debug(`LLM 响应：status=${res.status} 耗时=${Date.now() - t0}ms`);
      } catch (e) {
        log.error(`LLM 请求失败（跟随系统代理）耗时=${Date.now() - t0}ms`, e);
        throw new LlmError(this.describeError(e, "跟随系统代理"));
      }
    } else {
      try {
        res = await requestWithNode(url, headers, body, proxy, 60000);
        log.debug(`LLM 响应：status=${res.status} 耗时=${Date.now() - t0}ms`);
      } catch (e) {
        log.error(`LLM 请求失败（${modeName}）耗时=${Date.now() - t0}ms`, e);
        throw new LlmError(this.describeError(e, modeName));
      }
    }

    if (res.status !== 200) {
      if (res.status === 401 || res.status === 403) {
        // 诊断日志：记录响应体与 key 长度（不记录 key 值），用于区分「key 无效」与「保存/读取链路问题」
        log.warn(
          `LLM 认证失败（${res.status}）：响应体=${res.text.slice(0, 100)} apiKey长度=${provider.apiKey?.length ?? 0}`
        );
        throw new LlmError(
          `认证失败（${res.status}）：API Key 无效或未正确保存。请在 设置 → 大模型（自定义模型）→ 密钥 中重新输入后重试`,
          res.status
        );
      }
      throw new LlmError(`模型返回错误 ${res.status}：${res.text.slice(0, 100)}`, res.status);
    }
    let data: {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    try {
      data = JSON.parse(res.text) as typeof data;
    } catch {
      // 诊断日志：记录状态码/耗时/响应体长度与片段——用于区分「网关返回空 body」与「返回非 JSON 的错误页/提示」
      log.warn(
        `LLM 响应非 JSON：status=${res.status} 耗时=${Date.now() - t0}ms body长度=${res.text.length} 片段=${res.text.slice(0, 120).replace(/\s+/g, " ")}`
      );
      throw new LlmError(`模型返回非 JSON 内容：${res.text.slice(0, 200)}`);
    }
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      // 诊断日志：HTTP 200 但 content 缺失/为空（choices 结构异常或空 content）——
      // 记录 body 片段与首个 message 的键清单：区分「真·空 content」与「内容在其它字段（reasoning 等）/结构变异」
      const msg0 = data.choices?.[0]?.message;
      const msgKeys = msg0 && typeof msg0 === "object" ? Object.keys(msg0).join(",") : "—";
      log.warn(
        `LLM 空响应：status=${res.status} 耗时=${Date.now() - t0}ms body长度=${res.text.length} choices=${data.choices?.length ?? 0} message键=${msgKeys} 片段=${res.text.slice(0, 300).replace(/\s+/g, " ")}`
      );
      throw new LlmError("模型返回内容为空");
    }
    const elapsedMs = Date.now() - t0;
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          cacheHitTokens: data.usage.prompt_cache_hit_tokens ?? data.usage.prompt_tokens_details?.cached_tokens,
        }
      : undefined;
    log.debug(
      `LLM 完成：耗时=${elapsedMs}ms 内容长度=${text.length}` +
        (usage ? ` 输入=${usage.promptTokens ?? "—"} 输出=${usage.completionTokens ?? "—"} 缓存命中=${usage.cacheHitTokens ?? 0}` : "")
    );
    return { text, usage, elapsedMs };
  }

  /** 错误信息增强：附带错误码与网络排查提示（§5 排查） */
  private describeError(e: unknown, modeName: string): string {
    const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
    const cause = err.cause && typeof err.cause === "object" ? err.cause : null;
    const code = err.code ?? cause?.code;
    const msg = err.message ?? String(e);
    let hint = "";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      hint = "（域名解析失败：目标地址可能在内网，请检查网络/内网 VPN，或改用「自定义代理/直连」网络方式）";
    } else if (code === "ECONNREFUSED") {
      hint = "（连接被拒绝：请检查代理地址与端口是否正确、代理是否已启动）";
    } else if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") {
      hint = "（连接被重置/超时：请检查网络与代理连通性）";
    } else if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || /certificate/i.test(msg)) {
      hint = "（TLS 证书校验失败）";
    } else if (/failed to fetch/i.test(msg)) {
      hint = "（网络请求失败：请确认域名可解析、系统代理已配置；可尝试「直连无代理」或「自定义代理」网络方式）";
    }
    return `模型请求失败（${modeName}）：${msg}${code ? ` [${code}]` : ""}${hint}`;
  }
}
