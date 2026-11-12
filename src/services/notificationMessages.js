import { normalizeNotificationLanguage } from '../utils/settings.js';

const NOTIFICATION_MESSAGES = {
  zh: {
    events: {
      notification: '通知',
      offline: '节点离线告警',
      recovered: '节点恢复通知',
      resourceAlert: '资源负载告警',
      resourceRecovered: '资源负载恢复',
      trafficAlert: '月流量告警',
      expiring: '服务器到期提醒',
      renewed: '服务器自动续费成功',
      test: '测试通知'
    },
    metrics: { netIn: '下行网速', netOut: '上行网速', netTotal: '总网速', tcpConn: 'TCP 连接数', udpConn: 'UDP 连接数' },
    invalidTime: '无效时间',
    noReport: '无上报记录',
    lastReport: time => `最后上报: ${time}`,
    renewedUntil: date => `新到期 ${date}`,
    daysLeft: days => `剩余${days}天`,
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `本月已用 ${usedGb} GB / 限额 ${limitGb} GB（${percent}% ≥ ${threshold}%）`,
    testMessage: '这是一条来自 CF Server Monitor 的测试消息。'
  },
  'zh-TW': {
    events: {
      notification: '通知',
      offline: '節點離線告警',
      recovered: '節點恢復通知',
      resourceAlert: '資源負載告警',
      resourceRecovered: '資源負載恢復',
      trafficAlert: '月流量告警',
      expiring: '伺服器到期提醒',
      renewed: '伺服器自動續費成功',
      test: '測試通知'
    },
    metrics: { netIn: '下行網速', netOut: '上行網速', netTotal: '總網速', tcpConn: 'TCP 連線數', udpConn: 'UDP 連線數' },
    invalidTime: '無效時間',
    noReport: '無上報記錄',
    lastReport: time => `最後上報: ${time}`,
    renewedUntil: date => `新到期 ${date}`,
    daysLeft: days => `剩餘${days}天`,
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `本月已用 ${usedGb} GB / 限額 ${limitGb} GB（${percent}% ≥ ${threshold}%）`,
    testMessage: '這是一條來自 CF Server Monitor 的測試訊息。'
  },
  en: {
    events: {
      notification: 'Notification',
      offline: 'Node Offline Alert',
      recovered: 'Node Recovered',
      resourceAlert: 'Resource Load Alert',
      resourceRecovered: 'Resource Load Recovered',
      trafficAlert: 'Monthly Traffic Alert',
      expiring: 'Server Expiration Reminder',
      renewed: 'Server Auto-Renewed',
      test: 'Test Notification'
    },
    metrics: { netIn: 'Download Speed', netOut: 'Upload Speed', netTotal: 'Total Speed', tcpConn: 'TCP Connections', udpConn: 'UDP Connections' },
    invalidTime: 'Invalid time',
    noReport: 'No reports',
    lastReport: time => `Last report: ${time}`,
    renewedUntil: date => `New expiration ${date}`,
    daysLeft: days => `${days} ${days === 1 ? 'day' : 'days'} left`,
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `Used ${usedGb} GB of ${limitGb} GB this month (${percent}% ≥ ${threshold}%)`,
    testMessage: 'This is a test message from CF Server Monitor.'
  },
  ja: {
    events: {
      notification: '通知',
      offline: 'ノードオフラインアラート',
      recovered: 'ノード復旧通知',
      resourceAlert: 'リソース負荷アラート',
      resourceRecovered: 'リソース負荷復旧',
      trafficAlert: '月間トラフィックアラート',
      expiring: 'サーバー有効期限リマインダー',
      renewed: 'サーバー自動更新完了',
      test: 'テスト通知'
    },
    metrics: { netIn: '下り速度', netOut: '上り速度', netTotal: '合計速度', tcpConn: 'TCP 接続数', udpConn: 'UDP 接続数' },
    invalidTime: '無効な時刻',
    noReport: '報告なし',
    lastReport: time => `最終報告: ${time}`,
    renewedUntil: date => `新たな有効期限 ${date}`,
    daysLeft: days => `残り${days}日`,
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `今月 ${usedGb} GB / 上限 ${limitGb} GB 使用（${percent}% ≥ ${threshold}%）`,
    testMessage: 'これは CF Server Monitor からのテストメッセージです。'
  },
  id: {
    events: {
      notification: 'Notifikasi',
      offline: 'Peringatan Node Offline',
      recovered: 'Node Pulih',
      resourceAlert: 'Peringatan Beban Sumber Daya',
      resourceRecovered: 'Beban Sumber Daya Pulih',
      trafficAlert: 'Peringatan Trafik Bulanan',
      expiring: 'Pengingat Kedaluwarsa Server',
      renewed: 'Server Diperpanjang Otomatis',
      test: 'Notifikasi Uji'
    },
    metrics: { netIn: 'Kecepatan Unduh', netOut: 'Kecepatan Unggah', netTotal: 'Kecepatan Total', tcpConn: 'Koneksi TCP', udpConn: 'Koneksi UDP' },
    invalidTime: 'Waktu tidak valid',
    noReport: 'Tidak ada laporan',
    lastReport: time => `Laporan terakhir: ${time}`,
    renewedUntil: date => `Kedaluwarsa baru ${date}`,
    daysLeft: days => `Sisa ${days} hari`,
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `Terpakai ${usedGb} GB dari ${limitGb} GB bulan ini (${percent}% ≥ ${threshold}%)`,
    testMessage: 'Ini adalah pesan uji dari CF Server Monitor.'
  },
  fr: {
    events: {
      notification: 'Notification',
      offline: 'Alerte hors ligne',
      recovered: 'Nœud rétabli',
      resourceAlert: 'Alerte de charge',
      resourceRecovered: 'Charge rétablie',
      trafficAlert: 'Alerte de trafic mensuel',
      expiring: 'Rappel d’expiration du serveur',
      renewed: 'Serveur renouvelé automatiquement',
      test: 'Notification de test'
    },
    metrics: { netIn: 'Débit descendant', netOut: 'Débit montant', netTotal: 'Débit total', tcpConn: 'Connexions TCP', udpConn: 'Connexions UDP' },
    invalidTime: 'Heure invalide',
    noReport: 'Aucun rapport',
    lastReport: time => `Dernier rapport : ${time}`,
    renewedUntil: date => `Nouvelle expiration ${date}`,
    daysLeft: days => (days === 1 ? '1 jour restant' : `${days} jours restants`),
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `${usedGb} Go sur ${limitGb} Go utilisés ce mois-ci (${percent}% ≥ ${threshold}%)`,
    testMessage: 'Ceci est un message de test de CF Server Monitor.'
  },
  es: {
    events: {
      notification: 'Notificación',
      offline: 'Alerta de nodo fuera de línea',
      recovered: 'Nodo recuperado',
      resourceAlert: 'Alerta de carga de recursos',
      resourceRecovered: 'Carga de recursos normalizada',
      trafficAlert: 'Alerta de tráfico mensual',
      expiring: 'Recordatorio de vencimiento del servidor',
      renewed: 'Servidor renovado automáticamente',
      test: 'Notificación de prueba'
    },
    metrics: { netIn: 'Velocidad de descarga', netOut: 'Velocidad de subida', netTotal: 'Velocidad total', tcpConn: 'Conexiones TCP', udpConn: 'Conexiones UDP' },
    invalidTime: 'Hora inválida',
    noReport: 'Sin reportes',
    lastReport: time => `Último reporte: ${time}`,
    renewedUntil: date => `Nuevo vencimiento ${date}`,
    daysLeft: days => (days === 1 ? 'Queda 1 día' : `Quedan ${days} días`),
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `Usados ${usedGb} GB de ${limitGb} GB este mes (${percent}% ≥ ${threshold}%)`,
    testMessage: 'Este es un mensaje de prueba de CF Server Monitor.'
  }
};

export function getNotificationMessages(settings) {
  return NOTIFICATION_MESSAGES[normalizeNotificationLanguage(settings?.notification_language)];
}
