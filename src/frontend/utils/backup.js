// 兼容两代备份格式：
// - 旧版：纯服务器数组 [{ id, name, ... }]
// - 新版：{ format, version, exported_at, servers, settings }
// 解析结果统一成 { servers, settings }，settings 缺失时返回 null，只导入服务器。
export function parseServerBackup(text) {
  const parsed = JSON.parse(text);

  if (Array.isArray(parsed)) {
    return { servers: parsed, settings: null };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { servers: [], settings: null };
  }

  const settings = parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)
    ? parsed.settings
    : null;

  return {
    servers: Array.isArray(parsed.servers) ? parsed.servers : [],
    settings
  };
}
