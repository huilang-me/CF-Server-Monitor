<template>
  <div id="tab-servers" class="tab-content" :class="{ active: activeTab === 'servers' }">
    <div class="alert alert-info alert-stack">
      <div class="alert-line">
        <span>{{ trans.installCommand }}</span>
        <HelpTooltip>
          <span>{{ trans.clickToCopy }} <strong>📋</strong> {{ trans.installCommand }}</span>
        </HelpTooltip>
      </div>
    </div>

    <div class="toolbar">
      <input type="text" v-model="newServerName" class="toolbar-input" :placeholder="'> ' + trans.serverName + '...'">
      <div class="toolbar-select-wrapper">
        <select v-model="selectedServerGroup" class="toolbar-select">
          <option v-for="group in serverGroupOptions" :key="group.value" :value="group.value">{{ group.label }}</option>
          <option :value="CUSTOM_SERVER_GROUP_VALUE">{{ trans.custom || 'Custom' }}</option>
        </select>
        <input
          v-if="showCustomServerGroup"
          type="text"
          v-model="newServerGroup"
          class="toolbar-select toolbar-custom-input"
          :placeholder="trans.default || 'Default'"
        >
        <button v-if="newServerGroup" @click="newServerGroup = ''" class="toolbar-select-clear" aria-label="Clear">✕</button>
      </div>
      <button @click="$emit('add-server')" class="btn btn-primary">+ {{ trans.addServer }}</button>
    </div>

    <div class="batch-actions">
      <button @click="$emit('batch-edit')" class="btn btn-blue" :disabled="selectedServers.length === 0">✏️ {{ trans.batchEdit }}</button>
      <button @click="$emit('batch-delete')" class="btn btn-red">🗑 {{ trans.batchDelete }}</button>
      <button @click="$emit('toggle-select-all')" class="btn">☐ {{ trans.toggleAll }}</button>
    </div>

    <div class="table-wrapper">
      <table class="terminal-table">
        <thead>
          <tr>
            <th class="table-center-cell col-width-35">
              <HelpTooltip :text="trans.dragSort" />
            </th>
            <th class="col-width-30"><input type="checkbox" id="select-all" @change="$emit('select-all', $event)" class="checkbox-accent-green"></th>
            <th>{{ trans.hostname.toUpperCase() }}</th>
            <th>IP</th>
            <th>{{ trans.group.toUpperCase() }}</th>
            <th>{{ trans.tags.toUpperCase() }}</th>
            <th>{{ trans.note.toUpperCase() }}</th>
            <th>{{ trans.price.toUpperCase() }}</th>
            <th>{{ trans.expirationDate.toUpperCase() }}</th>
            <th>{{ trans.autoRenewal.toUpperCase() }}</th>
            <th>{{ trans.traffic.toUpperCase() }}</th>
            <th>{{ trans.agentVersion.toUpperCase() }}</th>
            <th>{{ trans.status.toUpperCase() }}</th>
            <th>{{ trans.actions.toUpperCase() }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="servers.length === 0">
            <td colspan="14" class="empty-state"><span class="empty-icon">📦</span> {{ trans.noServers }}</td>
          </tr>
          <tr
            v-for="server in servers"
            :key="server.id"
            class="server-row"
            :data-server-id="server.id"
          >
            <td
              class="drag-handle table-center-cell"
              :aria-label="trans.dragSort"
              draggable="false"
              @pointerdown="handlePointerDown($event, server.id)"
              @pointermove="handlePointerMove"
              @pointerup="handlePointerUp"
              @pointercancel="handlePointerCancel"
            >⋮⋮</td>
            <td class="table-center-cell"><input type="checkbox" class="server-checkbox" :value="server.id" :checked="selectedServers.includes(server.id)" @change="$emit('toggle-server', server.id)"></td>
            <td>
              <div class="server-info">
                <span v-if="server.region && server.region !== 'xx'" class="country-os-icons">
                  <img :src="getPublicAssetUrl('flags/' + getFlagRegionCode(server.region) + '.svg')" :alt="server.region" class="flag-img">
                  <OsIcon :os="server.os" />
                </span>
                <span v-else class="country-os-icons">
                  <span class="flag-fallback">🏳️</span>
                  <OsIcon :os="server.os" />
                </span>
                <a
                  :href="getServerDetailHref(server)"
                  class="server-name-link"
                >{{ server.name }}</a>
              </div>
            </td>
            <td>
              <div
                v-if="getServerIpRows(server).length"
                class="server-ip-list"
              >
                <span
                  v-for="ipItem in getServerIpRows(server)"
                  :key="ipItem.copyField"
                  class="server-ip-line"
                  :class="{ 'spec-copied': isSpecCopied(server, ipItem.copyField) }"
                  @click.stop="emitCopySpec(server, ipItem.copyField, ipItem.address)"
                >
                  <span class="server-ip-value">{{ ipItem.address }}</span>
                </span>
              </div>
              <span v-else>-</span>
            </td>
            <td>{{ server.server_group || trans.default }}</td>
            <td>
              <div v-if="splitTags(server.tags).length" class="tag-list admin-tag-list">
                <span v-for="(tag, index) in splitTags(server.tags)" :key="tag" :class="['badge', 'badge-tag', tagColorClass(index)]">{{ tag }}</span>
              </div>
              <span v-else>-</span>
            </td>
            <td>
              <span
                class="note-text"
                :class="{ 'note-copied': copiedNoteServerId === server.id }"
                @click.stop="$emit('copy-note', server)"
              >{{ server.note || '-' }}</span>
            </td>
            <td>
              <span
                class="spec-text"
                :class="{ 'spec-copied': isSpecCopied(server, 'price') }"
                @click.stop="emitCopySpec(server, 'price', formatServerPrice(server))"
              >{{ formatServerPrice(server) }}</span>
            </td>
            <td><span class="date-text">{{ server.expire_date || '-' }}</span></td>
            <td>
              <span
                class="renewal-text"
              >{{ isServerAutoRenewal(server) ? trans.enabled : trans.disabled }}</span>
            </td>
            <td>
              <span
                class="spec-text"
                :class="{ 'spec-copied': isSpecCopied(server, 'traffic_limit') }"
                @click.stop="emitCopySpec(server, 'traffic_limit', server.traffic_limit ? formatBytes(server.traffic_limit * 1024 * 1024 * 1024) : '')"
              >{{ server.traffic_limit ? formatBytes(server.traffic_limit * 1024 * 1024 * 1024) : '-' }}</span>
            </td>
            <td>
              <span
                class="spec-text"
                :class="[getAgentVersionClass(server.agent_version), { 'spec-copied': isSpecCopied(server, 'agent_version') }]"
                @click.stop="emitCopySpec(server, 'agent_version', server.agent_version)"
              >{{ server.agent_version || '●' }}</span>
            </td>
            <td>
              <span :style="{ color: server.is_online ? 'var(--accent-green)' : 'var(--accent-red)' }" class="font-bold">{{ (server.is_online ? '● ' + trans.online : '● ' + trans.offline).toUpperCase() }}</span>
            </td>
            <td>
              <div class="action-group">
                <div class="action-btns">
                  <button @click="$emit('copy-cmd', server.id)" class="btn btn-icon btn-green" :aria-label="trans.copy">{{ copiedServerId === server.id ? '✅' : '📋' }}</button>
                  <button @click="$emit('edit', server)" class="btn btn-icon btn-blue" :aria-label="trans.edit">✏️</button>
                  <button @click="$emit('delete', server.id)" class="btn btn-icon btn-red" :aria-label="trans.delete">🗑️</button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getFlagRegionCode, formatBytes } from '../../../utils/api'
import { getPublicAssetUrl } from '../../../utils/config'
import { currentLang } from '../../../utils/i18n'
import { detectBillingCycle, detectCurrencySymbol, getBillingCycleOption, getLocalizedOptionField, isEnabledFlag, isFreePrice, normalizeCurrency, normalizePrice } from '../../../utils/server.js'
import OsIcon from '../../../components/OsIcon.vue'
import HelpTooltip from '../../../components/HelpTooltip.vue'

const props = defineProps({
  trans: { type: Object, required: true },
  servers: { type: Array, default: () => [] },
  selectedServers: { type: Array, default: () => [] },
  groups: { type: Array, default: () => ['Default'] },
  activeTab: { type: String, default: 'servers' },
  selectedApiIndex: { type: Number, default: 0 },
  latestAgentVersion: { type: String, default: '' },
  copiedServerId: { type: [String, Number], default: null },
  copiedNoteServerId: { type: [String, Number], default: null },
  copiedSpecKey: { type: String, default: null }
})

const newServerName = defineModel('newServerName', { type: String, default: '' })
const newServerGroup = defineModel('newServerGroup', { type: String, default: '' })

const emit = defineEmits([
  'add-server', 'batch-edit', 'batch-delete', 'toggle-select-all', 'select-all',
  'drag-start', 'drop', 'toggle-server', 'copy-note',
  'copy-spec', 'copy-cmd', 'edit', 'delete'
])

const POINTER_DRAG_THRESHOLD = 6
const CUSTOM_SERVER_GROUP_VALUE = '__custom__'
let pointerDragState = null

const serverGroupOptions = computed(() => {
  const defaultLabel = props.trans.default || 'Default'
  const seen = new Set(['', defaultLabel])
  const options = [{ value: '', label: defaultLabel }]
  for (const group of props.groups) {
    const value = String(group || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    options.push({ value, label: value })
  }
  return options
})

const manualCustomServerGroup = ref(false)
const isKnownServerGroup = (value) => serverGroupOptions.value.some(group => group.value === String(value || '').trim())

const selectedServerGroup = computed({
  get: () => {
    const currentGroup = String(newServerGroup.value || '').trim()
    if (manualCustomServerGroup.value || (!isKnownServerGroup(currentGroup) && currentGroup)) {
      return CUSTOM_SERVER_GROUP_VALUE
    }
    return currentGroup
  },
  set: (value) => {
    if (value === CUSTOM_SERVER_GROUP_VALUE) {
      manualCustomServerGroup.value = true
      if (isKnownServerGroup(newServerGroup.value)) {
        newServerGroup.value = ''
      }
      return
    }
    manualCustomServerGroup.value = false
    newServerGroup.value = value
  }
})

const showCustomServerGroup = computed(() => selectedServerGroup.value === CUSTOM_SERVER_GROUP_VALUE)

watch(
  newServerGroup,
  (value) => {
    if (!String(value || '').trim() || isKnownServerGroup(value)) {
      manualCustomServerGroup.value = false
    }
  }
)

const emitDragStart = (event, serverId) => {
  emit('drag-start', event, serverId)
}

const emitDrop = (event, serverId) => {
  emit('drop', event, serverId)
}

const getServerRow = (target) => target?.closest?.('.server-row') || null
const getServerRowAtPoint = (clientX, clientY) => {
  const element = document.elementFromPoint(clientX, clientY)
  return getServerRow(element)
}

const createDragGhost = () => {
  if (!pointerDragState?.row || pointerDragState.ghost) return
  const row = pointerDragState.row
  const rect = row.getBoundingClientRect()
  const table = row.closest('table')
  const ghost = document.createElement('div')
  ghost.className = 'server-row-drag-ghost'
  ghost.style.width = `${rect.width}px`

  const ghostTable = document.createElement('table')
  ghostTable.className = table?.className || 'terminal-table'
  const ghostBody = document.createElement('tbody')
  const rowClone = row.cloneNode(true)
  rowClone.classList.remove('dragging', 'drag-over')
  rowClone.removeAttribute('data-server-id')
  Array.from(row.children).forEach((cell, index) => {
    const cloneCell = rowClone.children[index]
    if (!cloneCell) return
    const width = cell.getBoundingClientRect().width
    cloneCell.style.width = `${width}px`
    cloneCell.style.minWidth = `${width}px`
  })
  ghostBody.appendChild(rowClone)
  ghostTable.appendChild(ghostBody)
  ghost.appendChild(ghostTable)
  document.body.appendChild(ghost)

  pointerDragState.ghost = ghost
  pointerDragState.ghostOffsetX = pointerDragState.startX - rect.left
  pointerDragState.ghostOffsetY = pointerDragState.startY - rect.top
}

const updateDragGhost = (event) => {
  if (!pointerDragState?.ghost) return
  pointerDragState.ghost.style.left = `${event.clientX - pointerDragState.ghostOffsetX}px`
  pointerDragState.ghost.style.top = `${event.clientY - pointerDragState.ghostOffsetY}px`
}

const clearPointerDragClasses = () => {
  document.querySelectorAll('.server-row.dragging, .server-row.drag-over').forEach(row => {
    row.classList.remove('dragging', 'drag-over')
  })
}

const updatePointerDragTarget = (event) => {
  if (!pointerDragState?.active) return null
  const targetRow = getServerRowAtPoint(event.clientX, event.clientY)
  const targetId = targetRow?.dataset?.serverId || ''

  if (targetId !== pointerDragState.targetId) {
    if (pointerDragState.targetRow) {
      pointerDragState.targetRow.classList.remove('drag-over')
    }
    pointerDragState.targetRow = targetRow
    pointerDragState.targetId = targetId
    if (targetRow && targetId !== pointerDragState.serverId) {
      targetRow.classList.add('drag-over')
    }
  }

  return targetRow
}

const cleanupPointerDrag = () => {
  if (pointerDragState?.handle?.releasePointerCapture && pointerDragState.pointerId !== undefined) {
    try {
      pointerDragState.handle.releasePointerCapture(pointerDragState.pointerId)
    } catch (_) {}
  }
  clearPointerDragClasses()
  pointerDragState?.ghost?.remove()
  document.body.classList.remove('server-row-drag-active')
  pointerDragState = null
}

const startPointerDrag = (event) => {
  if (!pointerDragState || pointerDragState.active) return
  pointerDragState.active = true
  pointerDragState.row?.classList.add('dragging')
  document.body.classList.add('server-row-drag-active')
  createDragGhost()
  updateDragGhost(event)
  emitDragStart(event, pointerDragState.serverId)
}

const handlePointerDown = (event, serverId) => {
  if (event.isPrimary === false) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const row = getServerRow(event.target)
  if (!row) return
  event.preventDefault()

  pointerDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    serverId: String(serverId || ''),
    row,
    handle: event.currentTarget,
    active: false,
    targetId: '',
    targetRow: null,
    ghost: null,
    ghostOffsetX: 0,
    ghostOffsetY: 0
  }

  if (event.currentTarget?.setPointerCapture) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch (_) {}
  }
}

const handlePointerMove = (event) => {
  if (!pointerDragState || event.pointerId !== pointerDragState.pointerId) return

  const dx = Math.abs(event.clientX - pointerDragState.startX)
  const dy = Math.abs(event.clientY - pointerDragState.startY)
  if (!pointerDragState.active && Math.max(dx, dy) >= POINTER_DRAG_THRESHOLD) {
    startPointerDrag(event)
  }
  if (!pointerDragState.active) return

  event.preventDefault()
  updateDragGhost(event)
  updatePointerDragTarget(event)
}

const handlePointerUp = (event) => {
  if (!pointerDragState || event.pointerId !== pointerDragState.pointerId) return

  if (pointerDragState.active) {
    event.preventDefault()
    const targetRow = updatePointerDragTarget(event)
    const targetId = targetRow?.dataset?.serverId || pointerDragState.targetId
    emitDrop(event, targetId || pointerDragState.serverId)
  }

  cleanupPointerDrag()
}

const handlePointerCancel = (event) => {
  if (!pointerDragState || event.pointerId !== pointerDragState.pointerId) return
  if (pointerDragState.active) {
    emitDrop(event, pointerDragState.serverId)
  }
  cleanupPointerDrag()
}

onBeforeUnmount(() => {
  cleanupPointerDrag()
})

const getSpecCopyKey = (server, field) => `${server.id}:${field}`
const isSpecCopied = (server, field) => props.copiedSpecKey === getSpecCopyKey(server, field)
const emitCopySpec = (server, field, value) => {
  const text = String(value || '').trim()
  if (!text || text === '-') return
  emit('copy-spec', {
    key: getSpecCopyKey(server, field),
    text
  })
}

const splitTags = (value) => String(value || '')
  .split(',')
  .map(tag => tag.trim())
  .filter(Boolean)
const tagColorClass = (index) => `tag-color-${index % 6}`
const normalizePublicIpValue = (value) => String(value ?? '').trim()
const isPublicIpAvailable = (value) => {
  const normalized = normalizePublicIpValue(value)
  return normalized !== '' && normalized !== '0' && normalized.toLowerCase() !== 'false'
}
const getPublicIpAddress = (value) => {
  const normalized = normalizePublicIpValue(value)
  if (!isPublicIpAvailable(normalized) || normalized === '1') return ''
  return normalized
}
const getServerIpRows = (server) => [
  { copyField: 'ip_v4', address: getPublicIpAddress(server.ip_v4) },
  { copyField: 'ip_v6', address: getPublicIpAddress(server.ip_v6) }
].filter(item => item.address)
const trimDisplayPrice = (price) => String(price || '').replace(/\.00$/, '')
const formatServerPrice = (server) => {
  const price = normalizePrice(server.price)
  if (!price) return '-'
  if (isFreePrice(price)) return props.trans.free
  const currency = normalizeCurrency(server.currency || detectCurrencySymbol(server.price))
  const option = getBillingCycleOption(detectBillingCycle(server.price) || server.billing_cycle)
  const cycleLabel = getLocalizedOptionField(option, 'shortLabel', currentLang.value)
  return `${currency}${trimDisplayPrice(price)}/${cycleLabel}`
}
const isServerAutoRenewal = (server) => isEnabledFlag(server.auto_renewal)
const normalizeVersion = (version) => String(version || '').trim()
const getAgentVersionClass = (version) => {
  const latest = normalizeVersion(props.latestAgentVersion)
  if (!latest) return ''
  return normalizeVersion(version) === latest ? 'text-green' : 'text-red'
}
const getServerQuery = () => props.selectedApiIndex ? `?apiIndex=${props.selectedApiIndex}` : ''
// 详情页是公开页面，走域名根路径入口 /#/server/:id
const getServerDetailHref = (server) => `/#/server/${encodeURIComponent(server.id)}${getServerQuery()}`
</script>
