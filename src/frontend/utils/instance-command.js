// 实例名会作为服务名、配置路径和容器名的后缀。清洗与命令片段逻辑集中在这里，
// 既供后台命令生成复用，也供表单给出可见的非法字符提示，同时便于单测覆盖。
export const INSTANCE_NAME_MAX_LENGTH = 32

const INSTANCE_NAME_ALLOWED = /^[A-Za-z0-9_-]*$/

export function normalizeInstanceName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, INSTANCE_NAME_MAX_LENGTH)
}

// 首尾空白会被自动去掉，不算非法输入，避免误报。
export function hasInvalidInstanceChars(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > INSTANCE_NAME_MAX_LENGTH || !INSTANCE_NAME_ALLOWED.test(trimmed)
}

export function buildInstallInstanceFlag(value) {
  const instance = normalizeInstanceName(value)
  return instance ? `-instance=${instance}` : ''
}

// --all 优先于实例名；普通用户只清自家目录，root 只清系统级实例。
export function buildUninstallScopeFlag({ instance = '', all = false } = {}) {
  if (all) return '--all'
  return buildInstallInstanceFlag(instance)
}
