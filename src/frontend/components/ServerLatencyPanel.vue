<template>
  <div v-if="showThreeNetDetails && hasThreeNetDetails" :class="['three-net-panel', { 'three-net-panel-ring': variant === 'ring' }]">
    <div class="three-net-columns">
      <div class="three-net-column" aria-label="Ping">
        <div class="three-net-row" v-for="row in threeNetDetails" :key="'ping-' + row.key">
          <div class="three-net-head">
            <span class="three-net-name">{{ row.label }}</span>
            <strong class="three-net-value" :style="{ color: getPingColor(row.latestPing) }">{{ formatPingValue(row.latestPing) }}</strong>
          </div>
          <div class="three-net-buckets">
            <span
              v-for="(point, index) in row.points"
              :key="index"
              class="three-net-bucket"
              :data-tooltip="point.pingTooltip"
            >
              <span class="three-net-bucket-fill" :style="{ height: point.pingHeight + '%', background: point.pingColor, opacity: point.pingOpacity }"></span>
            </span>
          </div>
        </div>
      </div>
      <div class="three-net-column" aria-label="Loss">
        <div class="three-net-row" v-for="row in threeNetDetails" :key="'loss-' + row.key">
          <div class="three-net-head three-net-head-loss">
            <strong class="three-net-value" :style="{ color: getLossColor(row.averageLoss) }">{{ formatLossValue(row.averageLoss) }}</strong>
          </div>
          <div class="three-net-buckets">
            <span
              v-for="(point, index) in row.points"
              :key="index"
              class="three-net-bucket"
              :data-tooltip="point.lossTooltip"
            >
              <span class="three-net-bucket-fill" :style="{ height: point.lossHeight + '%', background: point.lossColor, opacity: point.lossOpacity }"></span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="hasPingData" :class="variant === 'ring' ? 'server-card-ping-row' : 'ping-panel'">
    <template v-if="variant === 'ring'">
      <span class="server-card-ping-chip" v-for="p in pingList.filter(x => x.value !== 0)" :key="p.label">
        <span class="server-card-ping-label">{{ p.label }}</span>
        <span class="server-card-ping-val" :style="{ color: getPingColor(p.value) }">{{ isPingValid(p.value) ? p.value + 'ms' : timeoutText }}</span>
      </span>
    </template>
    <template v-else>
      <div class="ping-item" v-for="p in pingList.filter(x => x.value !== 0)" :key="p.label">
        <span class="ping-label">{{ p.label }}</span>
        <span class="ping-value" :style="{ color: getPingColor(p.value) }">{{ !isPingValid(p.value) ? timeoutText : p.value + 'ms' }}</span>
      </div>
    </template>
  </div>
</template>

<script setup>
defineProps({
  variant: {
    type: String,
    default: 'bar',
    validator: value => ['bar', 'ring'].includes(value)
  },
  showThreeNetDetails: {
    type: Boolean,
    default: false
  },
  hasThreeNetDetails: {
    type: Boolean,
    default: false
  },
  threeNetDetails: {
    type: Array,
    default: () => []
  },
  hasPingData: {
    type: Boolean,
    default: false
  },
  pingList: {
    type: Array,
    default: () => []
  },
  timeoutText: {
    type: String,
    required: true
  },
  getPingColor: {
    type: Function,
    required: true
  },
  getLossColor: {
    type: Function,
    required: true
  },
  formatPingValue: {
    type: Function,
    required: true
  },
  formatLossValue: {
    type: Function,
    required: true
  },
  isPingValid: {
    type: Function,
    required: true
  }
})
</script>
