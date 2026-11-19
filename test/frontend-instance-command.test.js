import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildInstallInstanceFlag,
  buildUninstallScopeFlag,
  hasInvalidInstanceChars,
  normalizeInstanceName
} from '../src/frontend/utils/instance-command.js'
import {
  buildAutoDiscoveryInstallCommand,
  buildCustomInstallCommand,
  buildUninstallCommand
} from '../src/frontend/utils/install-command.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readSource = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

const HOST = 'https://api.test'
const SECRET = 'sec123'
const SERVER_ID = 'SID'
const RAW_BASE = 'https://raw.githubusercontent.com/huilang-me/cfsm-agent/main'
const trans = {
  dedicatedUserUninstallUnsupported: 'unsupported',
  nonRootUninstallUserMissing: 'missing',
  nonRootInstallSudoRequired: 'sudo required',
  dedicatedUserSystemdRequired: 'systemd required',
  nonRootInstallRunStep: 'install'
}

test('normalizeInstanceName trims, strips unsafe characters and caps the length', () => {
  assert.equal(normalizeInstanceName('  alpha  '), 'alpha')
  assert.equal(normalizeInstanceName('a b!@#'), 'ab')
  assert.equal(normalizeInstanceName('测试'), '')
  assert.equal(normalizeInstanceName('a\nb'), 'ab')
  assert.equal(normalizeInstanceName(null), '')
  assert.equal(normalizeInstanceName(undefined), '')
  assert.equal(normalizeInstanceName('a'.repeat(40)).length, 32)
})

test('hasInvalidInstanceChars reports unsafe input without flagging surrounding whitespace', () => {
  assert.equal(hasInvalidInstanceChars('alpha'), false)
  assert.equal(hasInvalidInstanceChars('  alpha  '), false)
  assert.equal(hasInvalidInstanceChars('my instance'), true)
  assert.equal(hasInvalidInstanceChars('测试'), true)
  assert.equal(hasInvalidInstanceChars('a'.repeat(33)), true)
})

test('buildInstallInstanceFlag emits a sanitized -instance flag only when needed', () => {
  assert.equal(buildInstallInstanceFlag(''), '')
  assert.equal(buildInstallInstanceFlag('   '), '')
  assert.equal(buildInstallInstanceFlag('alpha'), '-instance=alpha')
  assert.equal(buildInstallInstanceFlag('a b'), '-instance=ab')
  assert.equal(buildInstallInstanceFlag('a;rm -rf /'), '-instance=arm-rf')
})

test('buildUninstallScopeFlag prefers --all over an instance name', () => {
  assert.equal(buildUninstallScopeFlag({}), '')
  assert.equal(buildUninstallScopeFlag({ instance: 'alpha' }), '-instance=alpha')
  assert.equal(buildUninstallScopeFlag({ all: true }), '--all')
  assert.equal(buildUninstallScopeFlag({ instance: 'alpha', all: true }), '--all')
})

// 以下用例直接调用 index.vue 使用的命令构建函数，断言最终命令字符串，
// 覆盖参数顺序、空格与引号，而不是只检查源码里的片段。

test('uninstall command: default instance has no scope flag', () => {
  assert.equal(
    buildUninstallCommand({ host: HOST }),
    `curl -fsSL '${RAW_BASE}/install.sh' | sh -s -- uninstall`
  )
})

test('uninstall command: instance and --all produce the expected scope flag', () => {
  const base = { host: HOST }
  assert.equal(
    buildUninstallCommand({ ...base, instance: 'alpha' }),
    `curl -fsSL '${RAW_BASE}/install.sh' | sh -s -- uninstall -instance=alpha`
  )
  assert.equal(
    buildUninstallCommand({ ...base, instance: 'alpha', all: true }),
    `curl -fsSL '${RAW_BASE}/install.sh' | sh -s -- uninstall --all`
  )
  assert.equal(
    buildUninstallCommand({ ...base, all: true, ghProxy: 'https://ghfast.top/' }),
    `curl -fsSL 'https://ghfast.top/${RAW_BASE}/install.sh' | sh -s -- uninstall --all --install-ghproxy='https://ghfast.top/'`
  )
})

test('uninstall command: mac uses sudo and windows wraps the script download', () => {
  assert.equal(
    buildUninstallCommand({ host: HOST, targetOs: 'mac', instance: 'alpha' }),
    `curl -fsSL '${RAW_BASE}/install.sh' | sudo sh -s -- uninstall -instance=alpha`
  )
  assert.equal(
    buildUninstallCommand({ host: HOST, targetOs: 'windows', all: true }),
    '$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ' +
      `'${RAW_BASE}/install.ps1' -OutFile $script -UseBasicParsing; ` +
      'PowerShell -ExecutionPolicy Bypass -File $script uninstall --all'
  )
})

test('uninstall command: legacy shell version ignores instance flags', () => {
  assert.equal(
    buildUninstallCommand({ host: HOST, version: 'shell', instance: 'alpha', all: true }),
    `curl -fsSL '${HOST}/uninstall.sh' | sh -s`
  )
  assert.equal(
    buildUninstallCommand({ host: HOST, version: 'shell', targetOs: 'windows' }),
    '$script = Join-Path (Get-Location) \'uninstall-cf-probe.ps1\'; ' +
      `Invoke-WebRequest -Uri '${HOST}/uninstall.ps1' -OutFile $script -UseBasicParsing; ` +
      'PowerShell -ExecutionPolicy Bypass -File $script'
  )
})

test('uninstall command: cfsm-user mode wraps the final command for the dedicated user', () => {
  const runuser = `runuser -u cfsm -- env HOME="\${CFSM_HOME}" XDG_RUNTIME_DIR="/run/user/\${CFSM_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\${CFSM_UID}/bus" sh -c "curl -fsSL '${RAW_BASE}/install.sh' | sh -s -- uninstall -instance=alpha"`
  const expected = [
    '(',
    'set -e',
    'if ! command -v runuser >/dev/null 2>&1; then echo "unsupported" >&2; exit 1; fi',
    'id cfsm >/dev/null 2>&1 || { echo "missing" >&2; exit 1; }',
    'CFSM_UID=$(id -u cfsm)',
    'CFSM_HOME=$(getent passwd cfsm | cut -d: -f6); [ -n "${CFSM_HOME}" ] || CFSM_HOME=/home/cfsm',
    'if [ "$(id -u)" -eq 0 ]; then',
    `  ${runuser}`,
    'elif command -v sudo >/dev/null 2>&1; then',
    `  sudo ${runuser}`,
    'else',
    '  echo "sudo required" >&2; exit 1',
    'fi',
    ')'
  ].join('\n')
  assert.equal(
    buildUninstallCommand({
      host: HOST,
      instance: 'alpha',
      installMode: 'cfsm-user',
      trans
    }),
    expected
  )
})

test('custom install command: linux keeps the required params in order', () => {
  assert.equal(
    buildCustomInstallCommand({ host: HOST, serverId: SERVER_ID, secret: SECRET }),
    `curl -fsSL '${RAW_BASE}/install.sh' | sh -s -- install -id=${SERVER_ID} -secret='${SECRET}' -url=${HOST}/update -auto_update=0`
  )
})

test('custom install command: instance, proxy, version, UA and auto update are all emitted', () => {
  assert.equal(
    buildCustomInstallCommand({
      host: HOST,
      serverId: SERVER_ID,
      secret: SECRET,
      targetOs: 'linux',
      instance: 'alpha',
      ghProxy: 'https://ghfast.top/',
      version: '1.1.4',
      autoUpdate: true,
      ua: 'myUA'
    }),
    `curl -fsSL 'https://ghfast.top/${RAW_BASE}/install.sh' | sh -s -- install ` +
      `--install-ghproxy='https://ghfast.top/' --install-version='1.1.4' -instance=alpha ` +
      `-id=${SERVER_ID} -secret='${SECRET}' -url=${HOST}/update -auto_update=1 -ua='myUA'`
  )
})

test('custom install command: windows uses the instance flag and PowerShell quoting', () => {
  assert.equal(
    buildCustomInstallCommand({
      host: HOST,
      serverId: SERVER_ID,
      secret: SECRET,
      targetOs: 'windows',
      instance: 'beta'
    }),
    '$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ' +
      `'${RAW_BASE}/install.ps1' -OutFile $script -UseBasicParsing; ` +
      `PowerShell -ExecutionPolicy Bypass -File $script install -instance=beta -id='${SERVER_ID}' ` +
      `-secret='${SECRET}' -url='${HOST}/update' -auto_update='0'`
  )
})

test('custom install command: docker ignores the instance name', () => {
  const expected = [
    'docker run -d --name cf-probe --restart=unless-stopped --network=host --pid=host --cap-drop=ALL --cap-add=NET_RAW \\',
    '  -v cf-probe-data:/data \\',
    '  -v /etc/os-release:/etc/os-release:ro \\',
    `  -e SERVER_ID='${SERVER_ID}' -e SECRET='${SECRET}' -e WORKER_URL='${HOST}/update' -e UA='myUA' \\`,
    '  ghcr.io/huilang-me/cfsm-agent:1.1.4'
  ].join('\n')
  assert.equal(
    buildCustomInstallCommand({
      host: HOST,
      serverId: SERVER_ID,
      secret: SECRET,
      targetOs: 'docker',
      instance: 'alpha',
      version: '1.1.4',
      ua: 'myUA'
    }),
    expected
  )
})

test('auto discovery command: linux installs by secret only, with instance and name', () => {
  assert.equal(
    buildAutoDiscoveryInstallCommand({
      host: HOST,
      secret: SECRET,
      instance: 'beta',
      name: 'My Server',
      autoUpdate: true
    }),
    `curl -fsSL '${RAW_BASE}/install.sh' | sh -s -- install -instance=beta ` +
      `-secret='${SECRET}' -url=${HOST}/update -auto_update=1 -name='My Server'`
  )
})

test('auto discovery command: windows includes the instance flag', () => {
  assert.equal(
    buildAutoDiscoveryInstallCommand({
      host: HOST,
      secret: SECRET,
      targetOs: 'windows',
      instance: 'beta'
    }),
    '$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ' +
      `'${RAW_BASE}/install.ps1' -OutFile $script -UseBasicParsing; ` +
      `PowerShell -ExecutionPolicy Bypass -File $script install -instance=beta -secret='${SECRET}' ` +
      `-url='${HOST}/update' -auto_update='0'`
  )
})

test('index.vue delegates command generation to the pure module', () => {
  const source = readSource('src/frontend/views/admin/index.vue')
  assert.match(source, /buildUninstallCommand\(\{/, 'uninstall should use the shared builder')
  assert.match(source, /buildCustomInstallCommand\(\{/, 'custom install should use the shared builder')
  assert.match(source, /buildAutoDiscoveryInstallCommand\(\{/, 'auto discovery should use the shared builder')
  // 命令拼接逻辑只允许存在于共享模块，避免后台命令与表单提示使用不同规则。
  assert.doesNotMatch(source, /const normalizeInstanceName\s*=/)
  assert.doesNotMatch(source, /const buildGhRawUrl\s*=/)
  assert.doesNotMatch(source, /const quotePosixShellArg\s*=/)
})

test('all three command modals surface invalid instance name feedback', () => {
  const modals = [
    'src/frontend/views/admin/components/CopyCommandModal.vue',
    'src/frontend/views/admin/components/AutoDiscoveryCommandModal.vue',
    'src/frontend/views/admin/components/DeleteServerModal.vue'
  ]
  for (const modal of modals) {
    const source = readSource(modal)
    assert.match(source, /hasInvalidInstanceChars/, `${modal} should import the shared validator`)
    assert.match(source, /instanceHasInvalidChars/, `${modal} should compute the warning state`)
    assert.match(source, /trans\.instanceNameInvalid/, `${modal} should render the warning`)
    assert.match(source, /text-red text-sm/, `${modal} warning should use the defined red text class`)
    assert.doesNotMatch(source, /text-danger/, `${modal} should not use the undefined text-danger class`)
  }
})

test('copy command modal hides the instance field when Docker is selected', () => {
  const source = readSource('src/frontend/views/admin/components/CopyCommandModal.vue')
  assert.match(
    source,
    /<div v-if="targetOs !== 'docker'" class="form-row">/,
    'the row containing the instance field should be hidden for docker'
  )
})

test('uninstall-all hides the instance warning while the input is disabled', () => {
  const source = readSource('src/frontend/views/admin/components/DeleteServerModal.vue')
  assert.match(
    source,
    /v-if="instanceHasInvalidChars && !deleteAllInstances"/,
    'warning should not show while uninstall-all disables the instance input'
  )
})
