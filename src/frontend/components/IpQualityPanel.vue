<template>
  <section class="ip-quality" aria-label="IP 质量">
    <header class="quality-heading">
      <h2>IP 质量</h2>
      <span class="schedule">每日检测</span>
      <button class="refresh" type="button" :disabled="loading" title="刷新检测结果" aria-label="刷新检测结果" @click="load">↻</button>
    </header>
    <p v-if="error" class="quality-error" role="status">结果读取失败，请稍后重试。</p>
    <p v-if="loading && !reports.length" role="status">加载中...</p>
    <details v-for="item in reports" :key="item.server_id" :open="Boolean(serverId)" class="quality-server">
      <summary>
        <span class="quality-name">{{ item.name }}</span>
        <span class="quality-status" :class="statusClass(item)">ChatGPT · {{ statusText(item) }}</span>
        <span class="quality-time">{{ item.last_success ? date(item.last_success) : (item.enabled ? '等待首次检测' : '尚未接入') }}</span>
      </summary>
      <div class="quality-content">
        <p v-if="item.error" class="quality-error">最近检测失败 · {{ date(item.last_attempt) }}<span v-if="item.report">，以下为上次成功结果。</span></p>
        <p v-else-if="item.stale" class="quality-error">检测结果已超过 36 小时未更新。</p>
        <p v-if="!item.report" class="empty-state">{{ item.enabled ? '暂无检测结果' : '该服务器尚未安装每日 IP 检测任务' }}</p>
        <template v-else>
          <dl class="quality-info">
            <div><dt>出口 IPv4</dt><dd>{{ item.report.ip }}</dd></div>
            <div><dt>地区</dt><dd>{{ item.report.info.country || '-' }}</dd></div>
            <div><dt>ASN</dt><dd>{{ item.report.info.asn ? 'AS' + item.report.info.asn : '-' }}</dd></div>
            <div><dt>网络运营商</dt><dd>{{ item.report.info.organization || '-' }}</dd></div>
            <div><dt>ChatGPT 地区</dt><dd>{{ item.report.chatgpt.region || '-' }}</dd></div>
            <div><dt>IP 归属</dt><dd>{{ typeText(item.report.info.type) }}</dd></div>
          </dl>
          <p v-if="item.report.ip_changed" class="quality-error">出口 IP 较上次检测发生变化。</p>
          <p v-if="item.report.partial" class="partial">部分数据源未返回结果</p>
          <h3>风险评分</h3>
          <div class="scores">
            <div v-for="score in item.report.scores" :key="score.source" class="score">
              <span>{{ score.source }}</span>
              <strong>{{ score.value === null ? '无数据' : score.value + score.unit }}</strong>
            </div>
          </div>
          <h3>IP 类型</h3>
          <div class="quality-table-wrap">
            <table>
              <thead><tr><th>数据库</th><th>使用类型</th><th>公司类型</th></tr></thead>
              <tbody><tr v-for="row in item.report.usage" :key="row.source"><th>{{ row.source }}</th><td>{{ typeText(row.usage) }}</td><td>{{ typeText(row.company) }}</td></tr></tbody>
            </table>
          </div>
          <h3>风险标记</h3>
          <div class="quality-table-wrap">
            <table>
              <thead><tr><th>数据库</th><th v-for="factor in factors" :key="factor.key">{{ factor.label }}</th></tr></thead>
              <tbody><tr v-for="row in item.report.factors" :key="row.source"><th>{{ row.source }}</th><td v-for="factor in factors" :key="factor.key" :class="{ flagged: row[factor.key] === true }">{{ row[factor.key] === true ? '是' : row[factor.key] === false ? '否' : '-' }}</td></tr></tbody>
            </table>
          </div>
          <footer class="quality-source">IPQuality {{ item.report.version }} · IPv4 · {{ date(item.last_success) }}</footer>
        </template>
      </div>
    </details>
  </section>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { http } from '../utils/http'
import { getApiBases } from '../utils/config'

const props = defineProps({ serverId: { type: String, default: '' }, apiIndex: { type: Number, default: 0 } })
const reports = ref([])
const loading = ref(false)
const error = ref(false)
let generation = 0
const factors = [
  { key: 'Proxy', label: '代理' }, { key: 'VPN', label: 'VPN' }, { key: 'Tor', label: 'Tor' },
  { key: 'Server', label: '机房' }, { key: 'Abuser', label: '滥用' }, { key: 'Robot', label: '机器人' }
]
const labels = { available: '可达', blocked: '受限', web_only: '仅网页', app_only: '仅 App', unknown: '未知' }
const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false })
const statusText = item => item.error ? '检测失败' : item.stale ? '结果过期' : labels[item.report?.chatgpt.status] || '待检测'
const statusClass = item => !item.error && !item.stale && item.report?.chatgpt.status === 'available' ? 'available' : 'uncertain'
const typeText = value => ({ ISP: '家宽 / ISP', 'Line ISP': '家宽 / ISP', Hosting: '机房', 'Data Center': '机房', Business: '商业', 'Geo-consistent': '原生 IP', Native: '原生', Broadcast: '广播 IP' })[value] || value || '-'
async function load() {
  const current = ++generation
  loading.value = true
  const result = await http.get('/api/ip-quality' + (props.serverId ? '?id=' + encodeURIComponent(props.serverId) : ''), {
    baseUrl: getApiBases()[props.apiIndex], autoRedirect: false
  })
  if (current !== generation) return
  error.value = Boolean(result.error)
  if (!result.error) reports.value = result.data?.reports || []
  loading.value = false
}
watch(() => [props.serverId, props.apiIndex], () => { reports.value = []; load() }, { immediate: true })
const timer = setInterval(load, 300000)
onUnmounted(() => { clearInterval(timer); generation++ })
</script>

<style scoped>
.ip-quality { margin: 24px 0; border-top: 1px solid var(--border-color, #d3d7d4); padding-top: 18px; color: var(--text-primary); letter-spacing: 0; }
.quality-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
h2 { margin: 0; font-size: 18px; }
h3 { margin: 20px 0 10px; font-size: 14px; }
.schedule, .quality-time, dt, .score > span, .quality-source, .partial { color: var(--text-muted, #717871); font-size: 12px; }
.refresh { margin-left: auto; width: 32px; height: 32px; border: 1px solid var(--border-color, #d3d7d4); border-radius: 4px; background: transparent; color: inherit; font-size: 22px; cursor: pointer; }
.refresh:disabled { opacity: .5; cursor: wait; }
.quality-server { border-bottom: 1px solid var(--border-color, #d3d7d4); }
summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 14px 0; list-style: none; }
summary::before { content: '+'; width: 12px; flex-shrink: 0; }
details[open] > summary::before { content: '-'; }
.quality-name { font-weight: 600; overflow-wrap: anywhere; }
.quality-status { font-size: 12px; }
.available { color: var(--accent-color, #287c62); }
.uncertain, .partial { color: #a77527; }
.quality-time { margin-left: auto; }
.quality-content { padding: 0 0 16px; }
.quality-info { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 24px; padding: 12px 0; margin: 0; }
dd { margin: 5px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.scores { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-bottom: 1px solid var(--border-color, #d3d7d4); }
.score { display: flex; flex-direction: column; gap: 8px; padding: 8px 8px 14px 0; min-width: 0; overflow-wrap: anywhere; }
.score strong { font-size: 19px; font-weight: 500; }
.quality-table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--border-color, #d3d7d4); white-space: nowrap; }
th { font-weight: 500; }
.flagged, .quality-error { color: #c04e4e; }
.quality-error, .empty-state { font-size: 13px; }
.quality-source { margin-top: 16px; }
@media (max-width: 640px) {
  .quality-info { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .scores { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .quality-time { width: 100%; margin-left: 28px; }
  .quality-status { margin-left: auto; }
  th, td { padding: 8px; }
}
</style>
