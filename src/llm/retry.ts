/**
 * LLM 调用失败可重试性判定（创建需求自动重试用，§「LLM 自动重试」）。
 * - 不可重试：401/403/404 及其它 4xx（429 限流除外——稍候重试有意义）、参数/配置类错误
 * - 可重试：模型空响应（HTTP 200 但 body/内容为空，网关偶发）、请求超时、网络瞬断、429、5xx、未知错误
 * - 沿 Error.cause 链逐层判定：gateway 抛 LlmError（带 status）后可能被业务层以
 *   new Error(msg, { cause }) 包装，需剥开包装看原始 LlmError
 */
export function isRetryableLlmError(e: unknown): boolean {
  let cur: unknown = e;
  const seen = new Set<unknown>();
  while (cur !== null && cur !== undefined && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const c = cur as { status?: unknown; message?: unknown; cause?: unknown };
    const status = typeof c.status === "number" ? c.status : undefined;
    if (status !== undefined) {
      if (status === 401 || status === 403 || status === 404) return false;
      if (status >= 400 && status < 500 && status !== 429) return false;
      return true; // 429 / 5xx / 其它状态：可重试
    }
    const msg = typeof c.message === "string" ? c.message : "";
    // 无 status 的参数/配置/认证类错误：重试无意义
    if (/^(未启用任何模型|模型地址未配置|未配置 API Key|模型地址需以 http|自定义代理地址无效|认证失败)/.test(msg)) return false;
    if (/请求超时/.test(msg)) return true;
    cur = c.cause;
  }
  return true; // 无 status 且非配置类的未知错误（含模型空响应）：默认可重试
}
