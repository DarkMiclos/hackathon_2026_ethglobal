<template>
  <div class="space-y-1">
    <div v-if="!swaps.length" class="text-center text-gray-500 text-sm py-8">
      Waiting for swaps…
    </div>
    <div
      v-for="(swap, i) in sortedSwaps"
      :key="i"
      class="flex items-center justify-between px-3 py-2 rounded-lg text-xs
             hover:bg-surface-700 transition-colors"
    >
      <div class="flex flex-col gap-0.5">
        <span class="font-mono text-gray-300">{{ swap.senderLabel }}</span>
        <span class="text-gray-600">→ {{ swap.recipientLabel }}</span>
      </div>
      <div class="text-right">
        <span
          class="font-mono font-medium"
          :class="swap.amount0 > 0 ? 'text-accent-green' : 'text-accent-red'"
        >
          {{ formatAmount(swap.amount0) }}
        </span>
        <p class="text-gray-600 mt-0.5">{{ swap.timeAgo }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  swaps: { type: Array, default: () => [] },
})

const sortedSwaps = computed(() =>
  [...props.swaps]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 50)
    .map((s) => ({
      ...s,
      senderLabel: s.senderName || truncate(s.sender),
      recipientLabel: s.recipientName || truncate(s.recipient),
      timeAgo: formatTimeAgo(s.timestamp),
    }))
)

function truncate(addr) {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function formatAmount(val) {
  if (val == null) return '—'
  const n = Number(val)
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(4)
}

function formatTimeAgo(ts) {
  if (!ts) return ''
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}
</script>
