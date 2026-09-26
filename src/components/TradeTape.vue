<template>
  <div>
    <div v-if="!rows.length" class="text-center text-gray-500 text-sm py-8">
      Waiting for swaps…
    </div>
    <TransitionGroup name="tape" tag="div" class="space-y-1">
      <div
        v-for="row in rows"
        :key="row.id"
        class="group px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors border border-transparent"
        :class="[
          highlightedTrader && row.trader === highlightedTrader ? 'bg-accent-blue/10 border-accent-blue/30' : 'hover:bg-surface-700',
          highlightedTrader && row.trader !== highlightedTrader ? 'opacity-40' : '',
          row.isNew ? 'tape-flash' : '',
        ]"
        @click="$emit('select-trader', row.trader)"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: row.pool?.color || '#64748b' }" />
            <span class="font-medium text-gray-300 truncate">{{ row.pool?.name || 'Unknown pool' }}</span>
          </div>
          <span
            class="px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide shrink-0"
            :class="row.side === 'buy' ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-amber/15 text-accent-amber'"
          >{{ row.side === 'buy' ? 'BUY' : 'SELL' }} {{ row.pool?.base.symbol }}</span>
        </div>

        <div class="mt-1 font-mono text-gray-200">
          {{ formatAmount(row.amountIn) }} <span class="text-gray-500">{{ row.tokenIn?.symbol }}</span>
          <span class="text-gray-600 mx-1">→</span>
          {{ formatAmount(row.amountOut) }} <span class="text-gray-500">{{ row.tokenOut?.symbol }}</span>
        </div>

        <div class="mt-1 flex items-center justify-between text-[10px] text-gray-500">
          <span class="font-mono">{{ truncateAddr(row.trader) }}</span>
          <span class="flex items-center gap-2">
            <span v-if="row.valueUsdc" class="text-gray-400">≈ {{ formatAmount(row.valueUsdc, 0) }} USDC</span>
            <span>{{ row.timeAgo }}</span>
            <a
              v-if="row.txHash && !row.txHash.startsWith('0xaaaa')"
              :href="`https://sepolia.etherscan.io/tx/${row.txHash}`"
              target="_blank"
              rel="noopener"
              class="text-accent-blue opacity-0 group-hover:opacity-100 transition-opacity"
              @click.stop
            >tx ↗</a>
          </span>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { formatAmount, truncateAddr } from '@/config/pools'

const props = defineProps({
  swaps: { type: Array, default: () => [] },
  newSwapIds: { type: Array, default: () => [] },
  highlightedTrader: { type: String, default: '' },
})

defineEmits(['select-trader'])

// tick every 5s so "x s ago" stays fresh
const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 5000) })
onUnmounted(() => clearInterval(timer))

const rows = computed(() => {
  const fresh = new Set(props.newSwapIds)
  const t = now.value
  return [...props.swaps]
    .sort((a, b) => (b.blockNumber - a.blockNumber) || (b.timestamp - a.timestamp))
    .slice(0, 60)
    .map((s) => ({
      ...s,
      isNew: fresh.has(s.id),
      timeAgo: formatTimeAgo(s.timestamp, t),
    }))
})

function formatTimeAgo(ts, nowMs) {
  if (!ts) return ''
  const diff = Math.max(0, Math.floor(nowMs / 1000 - ts))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
</script>

<style scoped>
.tape-enter-active {
  transition: all 0.5s ease;
}
.tape-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.tape-move {
  transition: transform 0.4s ease;
}
.tape-flash {
  animation: tape-flash 2.4s ease-out;
}
@keyframes tape-flash {
  0% { background-color: rgba(59, 130, 246, 0.35); }
  100% { background-color: transparent; }
}
</style>
