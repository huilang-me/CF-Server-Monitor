// 安装 / 卸载命令的最终字符串生成逻辑集中在这里，作为纯函数便于 Node 端到端测试。
// index.vue 只负责把响应式状态打包成参数传入，不保留任何命令拼接逻辑。
// 这样测试断言的就是前端真正使用的命令字符串，而不是源码里的片段。

import {
  buildInstallInstanceFlag,
  buildUninstallScopeFlag
} from './instance-command.js'

export const buildGhRawUrl = (proxy, path) => {
  const base = 'https://raw.githubusercontent.com'
  if (!proxy) return `${base}${path}`
  const cleanProxy = proxy.replace(/\/$/, '')
  return `${cleanProxy}/${base}${path}`
}

export const quotePosixShellArg = (value) => `'${String(value).replaceAll("'", `'\"'\"'`)}'`

export const quotePowerShellArg = (value) => `'${String(value).replaceAll("'", "''")}'`

export const quotePosixDoubleShellArg = (value) => `"${String(value)
  .replaceAll('\\', '\\\\')
  .replaceAll('"', '\\"')
  .replaceAll('$', '\\$')
  .replaceAll('`', '\\`')}"`

export function buildUninstallAsCfsmCommand(command, trans = {}) {
  const runuserCommand = `runuser -u cfsm -- env HOME="\${CFSM_HOME}" XDG_RUNTIME_DIR="/run/user/\${CFSM_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\${CFSM_UID}/bus" sh -c ${quotePosixDoubleShellArg(command)}`
  return [
    '(',
    'set -e',
    `if ! command -v runuser >/dev/null 2>&1; then echo ${quotePosixDoubleShellArg(trans.dedicatedUserUninstallUnsupported)} >&2; exit 1; fi`,
    `id cfsm >/dev/null 2>&1 || { echo ${quotePosixDoubleShellArg(trans.nonRootUninstallUserMissing)} >&2; exit 1; }`,
    'CFSM_UID=$(id -u cfsm)',
    'CFSM_HOME=$(getent passwd cfsm | cut -d: -f6); [ -n "${CFSM_HOME}" ] || CFSM_HOME=/home/cfsm',
    'if [ "$(id -u)" -eq 0 ]; then',
    `  ${runuserCommand}`,
    'elif command -v sudo >/dev/null 2>&1; then',
    `  sudo ${runuserCommand}`,
    'else',
    `  echo ${quotePosixDoubleShellArg(trans.nonRootInstallSudoRequired)} >&2; exit 1`,
    'fi',
    ')'
  ].join('\n')
}

export function buildInstallAsCfsmCommand(command, runStep, trans = {}) {
  const lines = [
    '(',
    'set -e',
    `if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1 || ! command -v loginctl >/dev/null 2>&1 || ! command -v useradd >/dev/null 2>&1 || ! command -v runuser >/dev/null 2>&1; then echo ${quotePosixDoubleShellArg(trans.dedicatedUserSystemdRequired)} >&2; exit 1; fi`,
    'if [ "$(id -u)" -eq 0 ]; then',
    '  as_root() { "$@"; }',
    'elif command -v sudo >/dev/null 2>&1; then',
    '  as_root() { sudo "$@"; }',
    'else',
    `  echo ${quotePosixDoubleShellArg(trans.nonRootInstallSudoRequired)} >&2; exit 1`,
    'fi'
  ]

  lines.push(
    'id cfsm >/dev/null 2>&1 || as_root useradd -m -s /bin/sh cfsm',
    'as_root loginctl enable-linger cfsm'
  )

  lines.push(
    'CFSM_UID=$(id -u cfsm)',
    'as_root systemctl start user@${CFSM_UID}.service',
    'if command -v getent >/dev/null 2>&1; then CFSM_HOME=$(getent passwd cfsm | cut -d: -f6); else CFSM_HOME=/home/cfsm; fi; [ -n "${CFSM_HOME}" ] || CFSM_HOME=/home/cfsm',
    '',
    `# ${runStep}`,
    `as_root runuser -u cfsm -- env HOME="\${CFSM_HOME}" XDG_RUNTIME_DIR="/run/user/\${CFSM_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\${CFSM_UID}/bus" sh -c ${quotePosixDoubleShellArg(command)}`,
    ')'
  )
  return lines.join('\n')
}

export function buildUninstallCommand({
  host = '',
  targetOs = 'linux',
  version = 'go',
  ghProxy = '',
  installMode = 'current-user',
  instance = '',
  all = false,
  trans = {}
} = {}) {
  const isGo = version === 'go'
  const proxy = isGo ? String(ghProxy || '').trim() : ''
  if (isGo) {
    const scopeFlag = buildUninstallScopeFlag({ instance, all })
    const scopeParam = scopeFlag ? ` ${scopeFlag}` : ''
    if (targetOs === 'windows') {
      const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.ps1')
      const proxyParam = proxy ? ` --install-ghproxy=${quotePowerShellArg(proxy)}` : ''
      return `$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ${quotePowerShellArg(ghUrl)} -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script uninstall${scopeParam}${proxyParam}`
    }
    const sudoPrefix = targetOs === 'mac' ? 'sudo ' : ''
    const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.sh')
    const proxyParam = proxy ? ` --install-ghproxy=${quotePosixShellArg(proxy)}` : ''
    const uninstallCommand = `curl -fsSL ${quotePosixShellArg(ghUrl)} | ${sudoPrefix}sh -s -- uninstall${scopeParam}${proxyParam}`
    if (targetOs === 'linux' && installMode === 'cfsm-user') {
      return buildUninstallAsCfsmCommand(uninstallCommand, trans)
    }
    return uninstallCommand
  }
  if (targetOs === 'windows') {
    return `$script = Join-Path (Get-Location) 'uninstall-cf-probe.ps1'; Invoke-WebRequest -Uri '${host}/uninstall.ps1' -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script`
  }
  return `curl -fsSL '${host}/uninstall.sh' | sh -s`
}

export function buildCustomInstallCommand({
  host = '',
  targetOs = 'linux',
  installMode = 'current-user',
  ghProxy = '',
  version = '',
  instance = '',
  autoUpdate = false,
  serverId = '',
  secret = '',
  ua = '',
  trans = {}
} = {}) {
  const autoUpdateFlag = autoUpdate ? 1 : 0
  const proxy = String(ghProxy || '').trim()
  const safeVersion = String(version || '').trim()
  const instanceFlag = buildInstallInstanceFlag(instance)
  const isDedicatedUserInstall = targetOs === 'linux' && installMode === 'cfsm-user'
  if (targetOs === 'windows') {
    const params = ['install']
    if (proxy) params.push(`--install-ghproxy=${quotePowerShellArg(proxy)}`)
    if (safeVersion) params.push(`--install-version=${quotePowerShellArg(safeVersion)}`)
    if (instanceFlag) params.push(instanceFlag)
    params.push(
      `-id='${serverId}'`,
      `-secret=${quotePowerShellArg(secret)}`,
      `-url='${host}/update'`,
      `-auto_update='${autoUpdateFlag}'`
    )
    if (ua) params.push(`-ua=${quotePowerShellArg(ua)}`)
    const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.ps1')
    return `$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ${quotePowerShellArg(ghUrl)} -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script ${params.join(' ')}`
  }
  if (targetOs === 'docker') {
    const safeTag = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(safeVersion) ? safeVersion : 'latest'
    const image = `ghcr.io/huilang-me/cfsm-agent:${safeTag}`
    const uaEnv = ua ? ` -e UA=${quotePosixShellArg(ua)}` : ''
    return [
      'docker run -d --name cf-probe --restart=unless-stopped --network=host --pid=host --cap-drop=ALL --cap-add=NET_RAW \\',
      '  -v cf-probe-data:/data \\',
      '  -v /etc/os-release:/etc/os-release:ro \\',
      `  -e SERVER_ID=${quotePosixShellArg(serverId)} -e SECRET=${quotePosixShellArg(secret)} -e WORKER_URL=${quotePosixShellArg(`${host}/update`)}${uaEnv} \\`,
      `  ${image}`
    ].join('\n')
  }
  const params = ['install']
  if (proxy) params.push(`--install-ghproxy=${quotePosixShellArg(proxy)}`)
  if (safeVersion) params.push(`--install-version=${quotePosixShellArg(safeVersion)}`)
  if (instanceFlag) params.push(instanceFlag)
  params.push(
    `-id=${serverId}`,
    `-secret=${quotePosixShellArg(secret)}`,
    `-url=${host}/update`,
    `-auto_update=${autoUpdateFlag}`
  )
  if (ua) params.push(`-ua=${quotePosixShellArg(ua)}`)
  const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.sh')
  const installCommand = `curl -fsSL ${quotePosixShellArg(ghUrl)} | sh -s -- ${params.join(' ')}`
  if (!isDedicatedUserInstall) return installCommand

  return buildInstallAsCfsmCommand(installCommand, trans.nonRootInstallRunStep, trans)
}

// 自动发现模式下安装命令不带 -id：Agent 首次上报时由服务端自动创建服务器。
// name 留空时服务端回退到请求来源 IP；安装用户、代理、版本、名称与自动更新仅影响本次生成的命令。
export function buildAutoDiscoveryInstallCommand({
  host = '',
  targetOs = 'linux',
  installMode = 'current-user',
  ghProxy = '',
  name = '',
  instance = '',
  version = '',
  autoUpdate = false,
  secret = '',
  ua = '',
  trans = {}
} = {}) {
  const proxy = String(ghProxy || '').trim()
  const agentVersion = String(version || '').trim()
  const instanceFlag = buildInstallInstanceFlag(instance)
  const autoUpdateFlag = autoUpdate ? 1 : 0
  const serverName = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 100)

  if (targetOs === 'windows') {
    const params = ['install']
    if (proxy) params.push(`--install-ghproxy=${quotePowerShellArg(proxy)}`)
    if (agentVersion) params.push(`--install-version=${quotePowerShellArg(agentVersion)}`)
    if (instanceFlag) params.push(instanceFlag)
    params.push(
      `-secret=${quotePowerShellArg(secret)}`,
      `-url='${host}/update'`,
      `-auto_update='${autoUpdateFlag}'`
    )
    if (serverName) params.push(`-name=${quotePowerShellArg(serverName)}`)
    if (ua) params.push(`-ua=${quotePowerShellArg(ua)}`)
    const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.ps1')
    return `$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ${quotePowerShellArg(ghUrl)} -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script ${params.join(' ')}`
  }

  const params = ['install']
  if (proxy) params.push(`--install-ghproxy=${quotePosixShellArg(proxy)}`)
  if (agentVersion) params.push(`--install-version=${quotePosixShellArg(agentVersion)}`)
  if (instanceFlag) params.push(instanceFlag)
  params.push(
    `-secret=${quotePosixShellArg(secret)}`,
    `-url=${host}/update`,
    `-auto_update=${autoUpdateFlag}`
  )
  if (serverName) params.push(`-name=${quotePosixShellArg(serverName)}`)
  if (ua) params.push(`-ua=${quotePosixShellArg(ua)}`)
  const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.sh')
  const installCommand = `curl -fsSL ${quotePosixShellArg(ghUrl)} | sh -s -- ${params.join(' ')}`
  if (targetOs !== 'linux' || installMode !== 'cfsm-user') return installCommand

  return buildInstallAsCfsmCommand(installCommand, trans.nonRootInstallRunStep, trans)
}
