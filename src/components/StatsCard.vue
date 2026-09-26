<template>
  <div class="bg-surface-800 rounded-xl p-4 space-y-3">
    <h2 class="text-sm font-medium text-gray-400">Overview</h2>
    <div class="grid grid-cols-1 gap-3">
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide">Swaps</p>
        <p class="text-2xl font-bold font-mono">{{ stats.swapCount }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide">Volume</p>
        <p class="text-2xl font-bold font-mono">{{ formattedVolume }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide">Traders</p>
        <p class="text-2xl font-bold font-mono">{{ stats.traders }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  stats: {
    type: Object,
    default: () => ({ swapCount: 0, volume: 0, traders: 0 }),
  },
})

const formattedVolume = computed(() => {
  const v = props.stats.volume
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`
  return v.toFixed(4)
})
</script>
