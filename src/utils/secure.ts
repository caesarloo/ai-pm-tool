/**
 * 密钥存储（Obsidian SecretStorage 官方密钥库）
 *
 * 统一采用 Obsidian 原生 SecretStorage API（app.secretStorage，Obsidian 1.11.4+）：
 * - 跨平台（Windows DPAPI / macOS 钥匙串 / Linux 密钥环由 Obsidian 自行实现，底层 Electron safeStorage）
 * - 密钥值存于 Obsidian 本地，data.json 只保存引用 `secret:v1:<id>`，不随仓库/云盘同步
 * - 多插件共享；换机/换用户后需重新录入（与系统密钥环相同）
 *
 * 引用格式：`secret:v1:<id>`；id 仅含 [a-z0-9-]（Obsidian 校验规则）、≤64 字符，
 * 以 ai-pm-tool- 前缀命名空间避免与其他插件冲突。
 */
export const SECRET_REF_PREFIX = "secret:v1:";

/** 账号掩码：@ 前（账号/部门）隐藏、@ 后正常显示；无 @ 时隐藏前部、显示后 3 位（设置页与日志共用，防明文落盘/落屏） */
export function maskAccount(v: string): string {
  const at = v.lastIndexOf("@");
  if (at > 0) {
    return "•".repeat(at) + v.slice(at); // 如 ••••••••@example.com
  }
  return v.length > 3 ? "•".repeat(v.length - 3) + v.slice(-3) : "•".repeat(v.length);
}

/** 生成 SecretStorage 条目 id（仅 [a-z0-9-]、≤64 字符；加 ai-pm-tool- 前缀避免与其他插件冲突） */
export function secretStorageId(
  field: "smtp-user" | "smtp-pass" | "smtp-from" | "smtp-from-name" | "current-user" | "provider",
  providerId?: string
): string {
  const base =
    field === "smtp-pass"
      ? "smtp-pass"
      : field === "smtp-user"
        ? "smtp-user"
        : field === "smtp-from"
          ? "smtp-from"
          : field === "smtp-from-name"
            ? "smtp-from-name"
            : field === "current-user"
              ? "current-user"
              : `provider-${String(providerId ?? "default").toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  return `ai-pm-tool-${base}`.slice(0, 64);
}

/** 构造存储引用值（secret:v1:<id>） */
export function secretRef(id: string): string {
  return SECRET_REF_PREFIX + id;
}

/** 从存储值解析条目 id；非 SecretStorage 引用（明文旧数据）返回 null */
export function secretRefId(stored: string): string | null {
  return stored.startsWith(SECRET_REF_PREFIX) ? stored.slice(SECRET_REF_PREFIX.length) : null;
}
