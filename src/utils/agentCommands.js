import {
  buildAgentResourceUrl,
  buildPosixAgentDownloadCommand,
  buildPowerShellAgentDownloadCommand,
  normalizeAgentBaseUrl,
  normalizeAgentProxyUrl,
  quotePosixShell,
  quotePowerShell
} from './agentNetwork.js';

const TARGETS = {
  linux: { script: 'install.sh', shell: 'bash', sudo: '' },
  alpine: { script: 'install-alpine.sh', shell: 'sh', sudo: '' },
  openwrt: { script: 'install-openwrt.sh', shell: 'sh', sudo: '' },
  mac: { script: 'install-mac.sh', shell: 'bash', sudo: 'sudo ' },
  synology: { script: 'install-synology.sh', shell: 'bash', sudo: '' }
};

const hasValue = value => value !== null && value !== undefined && value !== '';

function normalizeNetwork(baseUrl, proxyUrl) {
  const base = normalizeAgentBaseUrl(baseUrl);
  const proxy = normalizeAgentProxyUrl(proxyUrl);
  if (!base.valid || !base.value) throw new Error('Invalid agent BaseURL');
  if (!proxy.valid) throw new Error('Invalid agent proxy URL');
  return { baseUrl: base.value, proxyUrl: proxy.value };
}

export function buildAgentInstallCommand({
  targetOs = 'linux',
  baseUrl,
  proxyUrl = '',
  serverId,
  secret,
  collectInterval = 0,
  reportInterval = 60,
  resetDay = 1,
  autoUpdate = false,
  customCt = '',
  customCu = '',
  customCm = '',
  customBd = '',
  rxCorrection = '',
  txCorrection = ''
}) {
  const network = normalizeNetwork(baseUrl, proxyUrl);
  const autoUpdateFlag = autoUpdate ? 1 : 0;

  if (targetOs === 'windows') {
    const scriptUrl = buildAgentResourceUrl(network.baseUrl, 'cf-server-monitor.ps1');
    const params = [
      'install',
      `-Id ${quotePowerShell(serverId)}`,
      `-Secret ${quotePowerShell(secret)}`,
      `-BaseUrl ${quotePowerShell(network.baseUrl)}`,
      `-ProxyUrl ${quotePowerShell(network.proxyUrl)}`,
      `-CollectInterval ${collectInterval}`,
      `-ReportInterval ${reportInterval}`,
      `-ResetDay ${resetDay ?? 1}`,
      `-AutoUpdate ${autoUpdateFlag}`
    ];
    if (customCt) params.push(`-CtNode ${quotePowerShell(customCt)}`);
    if (customCu) params.push(`-CuNode ${quotePowerShell(customCu)}`);
    if (customCm) params.push(`-CmNode ${quotePowerShell(customCm)}`);
    if (customBd) params.push(`-BdNode ${quotePowerShell(customBd)}`);
    if (hasValue(rxCorrection)) params.push(`-RxCorrection ${rxCorrection}`);
    if (hasValue(txCorrection)) params.push(`-TxCorrection ${txCorrection}`);
    return `${buildPowerShellAgentDownloadCommand(scriptUrl, network.proxyUrl)}; ` +
      `powershell -NoProfile -ExecutionPolicy Bypass -STA -File .\\cf-server-monitor.ps1 ${params.join(' ')}`;
  }

  const target = TARGETS[targetOs] || TARGETS.linux;
  const scriptUrl = buildAgentResourceUrl(network.baseUrl, target.script);
  let command = `${buildPosixAgentDownloadCommand(scriptUrl, network.proxyUrl)} | ` +
    `${target.sudo}${target.shell} -s install ` +
    `-id=${quotePosixShell(serverId)} -secret=${quotePosixShell(secret)} ` +
    `-base_url=${quotePosixShell(network.baseUrl)} -proxy_url=${quotePosixShell(network.proxyUrl)} ` +
    `-collect_interval=${collectInterval} -interval=${reportInterval} ` +
    `-reset_day=${resetDay ?? 1} -auto_update=${autoUpdateFlag}`;
  if (customCt) command += ` -ct=${quotePosixShell(customCt)}`;
  if (customCu) command += ` -cu=${quotePosixShell(customCu)}`;
  if (customCm) command += ` -cm=${quotePosixShell(customCm)}`;
  if (customBd) command += ` -bd=${quotePosixShell(customBd)}`;
  if (hasValue(rxCorrection)) command += ` -rx_correction=${rxCorrection}`;
  if (hasValue(txCorrection)) command += ` -tx_correction=${txCorrection}`;
  return command;
}

export function buildAgentUninstallCommand({ targetOs = 'linux', baseUrl, proxyUrl = '' }) {
  const network = normalizeNetwork(baseUrl, proxyUrl);
  if (targetOs === 'windows') {
    const scriptUrl = buildAgentResourceUrl(network.baseUrl, 'cf-server-monitor.ps1');
    return `${buildPowerShellAgentDownloadCommand(scriptUrl, network.proxyUrl)}; ` +
      'powershell -NoProfile -ExecutionPolicy Bypass -STA -File .\\cf-server-monitor.ps1 uninstall';
  }

  const target = TARGETS[targetOs] || TARGETS.linux;
  const scriptUrl = buildAgentResourceUrl(network.baseUrl, target.script);
  return `${buildPosixAgentDownloadCommand(scriptUrl, network.proxyUrl)} | ` +
    `${target.sudo}${target.shell} -s uninstall`;
}
