import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentResourceUrl,
  buildPosixAgentDownloadCommand,
  buildPowerShellAgentDownloadCommand,
  normalizeAgentBaseUrl,
  normalizeAgentProxyUrl,
  quotePosixShell,
  quotePowerShell,
  resolveAgentBaseUrl
} from '../src/utils/agentNetwork.js';
import { withoutPrivateServerFields } from '../src/handlers/dashboard.js';
import { addServerColumns } from '../src/database/updateDatabase.js';
import { buildAgentInstallCommand, buildAgentUninstallCommand } from '../src/utils/agentCommands.js';
import { normalizeAgentRegion, resolveReportedAgentRegion } from '../src/utils/agentRegion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const validBaseCases = [
  ['', ''],
  ['https://example.com/', 'https://example.com'],
  ['https://example.com/agent/prefix///', 'https://example.com/agent/prefix'],
  ['http://127.0.0.1:8787/path', 'http://127.0.0.1:8787/path'],
  ['https://[2001:db8::1]:8443/probe', 'https://[2001:db8::1]:8443/probe']
];
for (const [input, expected] of validBaseCases) {
  assert.deepEqual(normalizeAgentBaseUrl(input), { valid: true, value: expected });
}

for (const input of [
  'ftp://example.com',
  'https://user:pass@example.com',
  'https://example.com/path?x=1',
  'https://example.com/path#fragment',
  'https://'
]) {
  assert.equal(normalizeAgentBaseUrl(input).valid, false, `base URL should be rejected: ${input}`);
}

assert.deepEqual(
  normalizeAgentProxyUrl('http://user:p%20a%27s%24@proxy.example.com:8080/'),
  { valid: true, value: 'http://user:p%20a%27s%24@proxy.example.com:8080' }
);
assert.deepEqual(
  normalizeAgentProxyUrl('https://[2001:db8::2]:3128'),
  { valid: true, value: 'https://[2001:db8::2]:3128' }
);
for (const input of [
  'socks5://proxy.example.com:1080',
  'http://proxy.example.com/business/path',
  'http://proxy.example.com?x=1',
  'http://proxy.example.com#fragment',
  'http://user:%ZZ@proxy.example.com:8080'
]) {
  assert.equal(normalizeAgentProxyUrl(input).valid, false, `proxy URL should be rejected: ${input}`);
}

assert.equal(resolveAgentBaseUrl('', 'https://api.example.com/root/'), 'https://api.example.com/root');
assert.equal(buildAgentResourceUrl('https://api.example.com/root', '/install.sh'), 'https://api.example.com/root/install.sh');

assert.equal(quotePosixShell("space ' quote $value"), "'space '" + '"' + "'" + '"' + "' quote $value'");
assert.equal(quotePowerShell("space ' quote $value"), "'space '' quote $value'");

const proxy = 'http://user:p%20a%27s%24@proxy.example.com:8080';
const posixDownload = buildPosixAgentDownloadCommand('https://api.example.com/root/install.sh', proxy);
assert.match(posixDownload, /^curl --noproxy '' -fsSL --proxy /);
assert.match(posixDownload, /install\.sh'$/);
assert.match(
  buildPosixAgentDownloadCommand('https://api.example.com/root/install.sh'),
  /^curl --noproxy '\*' -fsSL /
);

const powerShellDownload = buildPowerShellAgentDownloadCommand('https://api.example.com/root/cf-server-monitor.ps1', proxy);
assert.match(powerShellDownload, /ConvertTo-SecureString 'p a''s\$'/);
assert.match(powerShellDownload, /-Proxy 'http:\/\/proxy\.example\.com:8080'/);
assert.match(powerShellDownload, /-ProxyCredential \$proxyCredential/);
assert.match(
  buildPowerShellAgentDownloadCommand('https://api.example.com/root/cf-server-monitor.ps1'),
  /DefaultWebProxy = \$null/
);

const commandOptions = {
  baseUrl: 'https://api.example.com/prefix',
  proxyUrl: proxy,
  serverId: "server id'01",
  secret: "secret $value ' quoted",
  collectInterval: 1,
  reportInterval: 60,
  resetDay: 15,
  autoUpdate: true,
  customCt: 'ct.example.com:443'
};
const targetExpectations = {
  linux: ['install.sh', '| bash -s install'],
  alpine: ['install-alpine.sh', '| sh -s install'],
  openwrt: ['install-openwrt.sh', '| sh -s install'],
  mac: ['install-mac.sh', '| sudo bash -s install'],
  synology: ['install-synology.sh', '| bash -s install'],
  windows: ['cf-server-monitor.ps1', 'powershell -NoProfile -ExecutionPolicy Bypass -STA']
};
for (const [targetOs, [scriptName, invocation]] of Object.entries(targetExpectations)) {
  const installCommand = buildAgentInstallCommand({ ...commandOptions, targetOs });
  assert.match(installCommand, new RegExp(scriptName.replaceAll('.', '\\.')));
  assert.ok(installCommand.includes(invocation), `${targetOs} install invocation`);
  assert.ok(installCommand.includes(targetOs === 'windows' ? '-BaseUrl' : '-base_url='));
  assert.ok(installCommand.includes(targetOs === 'windows' ? '-ProxyUrl' : '-proxy_url='));

  const uninstallCommand = buildAgentUninstallCommand({
    targetOs,
    baseUrl: commandOptions.baseUrl,
    proxyUrl: commandOptions.proxyUrl
  });
  assert.match(uninstallCommand, new RegExp(scriptName.replaceAll('.', '\\.')));
  assert.match(uninstallCommand, /uninstall/);
}
assert.ok(
  buildAgentInstallCommand({ ...commandOptions, targetOs: 'linux' })
    .includes(`-secret='secret $value '"'"' quoted'`)
);
assert.ok(
  buildAgentInstallCommand({ ...commandOptions, targetOs: 'windows' })
    .includes("-Secret 'secret $value '' quoted'")
);

assert.equal(normalizeAgentRegion(' cn '), 'CN');
assert.equal(normalizeAgentRegion('CHN'), '');
assert.equal(
  resolveReportedAgentRegion({ agent_region: 'jp' }, { cf: { country: 'US' }, headers: new Headers() }),
  'JP'
);
assert.equal(
  resolveReportedAgentRegion({ agent_region: '' }, { cf: { country: 'US' }, headers: new Headers() }),
  '',
  'new agents with an unavailable direct lookup must not fall back to the proxy country'
);
assert.equal(
  resolveReportedAgentRegion({}, { cf: { country: 'US' }, headers: new Headers() }),
  'US',
  'legacy agents should retain edge-country fallback behavior'
);

const publicServer = withoutPrivateServerFields({
  id: 'server-id',
  name: 'server',
  agent_base_url: 'https://private.example.com/path',
  agent_proxy_url: 'http://user:secret@proxy.example.com:8080',
  auto_update: '1'
});
assert.equal(publicServer.agent_base_url, undefined);
assert.equal(publicServer.agent_proxy_url, undefined);
assert.equal(publicServer.auto_update, undefined);
assert.equal(publicServer.id, 'server-id');

const existingServerColumns = [
  'id', 'is_hidden', 'offline_notify_disabled', 'sort_order', 'tags', 'note',
  'billing_cycle', 'auto_renewal', 'currency', 'reset_day', 'collect_interval',
  'report_interval', 'auto_update', 'custom_ct', 'custom_cu', 'custom_cm',
  'custom_bd', 'rx_correction', 'tx_correction', 'traffic_calc_type',
  'history_partition_id', 'timestamp'
];
const alterStatements = [];
const fakeDb = {
  prepare(sql) {
    if (sql.includes('PRAGMA table_info(servers)')) {
      return { all: async () => ({ results: existingServerColumns.map(name => ({ name })) }) };
    }
    if (sql.startsWith('ALTER TABLE servers ADD COLUMN')) {
      alterStatements.push(sql);
      return { run: async () => ({ success: true }) };
    }
    throw new Error(`Unexpected SQL in migration test: ${sql}`);
  }
};
const migrationResult = await addServerColumns(fakeDb);
assert.equal(migrationResult.success, true);
assert.equal(migrationResult.added, 2);
assert.deepEqual(alterStatements, [
  "ALTER TABLE servers ADD COLUMN agent_base_url TEXT DEFAULT ''",
  "ALTER TABLE servers ADD COLUMN agent_proxy_url TEXT DEFAULT ''"
]);

for (const scriptName of [
  'install.sh',
  'install-alpine.sh',
  'install-openwrt.sh',
  'install-mac.sh',
  'install-synology.sh'
]) {
  const source = fs.readFileSync(path.join(projectRoot, 'public', scriptName), 'utf8');
  assert.match(source, /AGENT_VERSION="1\.3\.3"/, `${scriptName} version`);
  assert.match(source, /BASE_URL=/, `${scriptName} base URL config`);
  assert.match(source, /PROXY_URL=/, `${scriptName} proxy config`);
  assert.match(source, /agent_curl/, `${scriptName} proxied agent requests`);
  assert.match(source, /-proxy_url=/, `${scriptName} proxy argument`);
  assert.match(source, /agent_region/, `${scriptName} direct region report`);
  assert.match(source, /\.cf_region/, `${scriptName} direct region cache`);
  assert.match(source, /direct_cf_trace/, `${scriptName} TUN-bypass trace helper`);
  assert.match(source, /--interface/, `${scriptName} physical source binding`);
  assert.match(source, /Host: cloudflare\.com/, `${scriptName} fixed-IP trace host`);
  assert.match(source, /http:\/\/1\.1\.1\.1\/cdn-cgi\/trace/, `${scriptName} DNS-independent trace endpoint`);
}

const windowsSource = fs.readFileSync(path.join(projectRoot, 'public', 'cf-server-monitor.ps1'), 'utf8');
assert.match(windowsSource, /\$AGENT_VERSION = "1\.3\.3"/);
assert.match(windowsSource, /\[string\]\$BaseUrl/);
assert.match(windowsSource, /\[string\]\$ProxyUrl/);
assert.match(windowsSource, /System\.Management\.Automation\.PSCredential/);
assert.match(windowsSource, /Invoke-AgentWebRequest/);
assert.match(windowsSource, /Get-DirectAgentRegion/);
assert.match(windowsSource, /agent_region/);
assert.match(windowsSource, /Get-PhysicalDefaultIPv4Route/);
assert.match(windowsSource, /New-NetRoute/);
assert.match(windowsSource, /http:\/\/1\.1\.1\.1\/cdn-cgi\/trace/);

console.log('agent network validation, quoting, and script checks passed');
