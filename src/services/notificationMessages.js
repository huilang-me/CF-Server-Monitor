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
    metrics: { netIn: '下行网速', netOut: '上行网速', netTotal: '总网速' },
    invalidTime: '无效时间',
    noReport: '无上报记录',
    lastReport: time => `最后上报: ${time}`,
    renewedUntil: date => `新到期 ${date}`,
    daysLeft: days => `剩余${days}天`,
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `本月已用 ${usedGb} GB / 限额 ${limitGb} GB（${percent}% ≥ ${threshold}%）`,
    testMessage: '这是一条来自 CF Server Monitor 的测试消息。'
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
    metrics: { netIn: 'Download Speed', netOut: 'Upload Speed', netTotal: 'Total Speed' },
    invalidTime: 'Invalid time',
    noReport: 'No reports',
    lastReport: time => `Last report: ${time}`,
    renewedUntil: date => `New expiration ${date}`,
    daysLeft: days => `${days} ${days === 1 ? 'day' : 'days'} left`,
    trafficUsed: ({ usedGb, limitGb, percent, threshold }) =>
      `Used ${usedGb} GB of ${limitGb} GB this month (${percent}% ≥ ${threshold}%)`,
    testMessage: 'This is a test message from CF Server Monitor.'
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
    metrics: { netIn: 'Velocidad de descarga', netOut: 'Velocidad de subida', netTotal: 'Velocidad total' },
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
