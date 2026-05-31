export function formatBytes(bytes) {
  const b = parseInt(bytes);
  if (isNaN(b) || b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getPingColor(ping) {
  const p = parseInt(ping);
  if (p === 0 || isNaN(p)) return '#9ca3af';
  if (p < 100) return '#10b981';
  if (p < 200) return '#f59e0b';
  return '#ef4444';
}