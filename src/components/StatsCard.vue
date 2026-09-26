<template>
  <div class="bg-surface-800 rounded-xl p-4 space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-gray-400">Overview</h2>
      <span class="text-[10px] text-gray-500">{{ stats.scopeLabel }}</span>
    </div>
    <div class="grid grid-cols-3 gap-3">
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Swaps</p>
        <p class="text-xl font-bold font-mono leading-tight">{{ stats.swapCount }}</p>
        <p v-if="stats.totalSwaps && stats.totalSwaps > stats.swapCount" class="text-[10px] text-gray-500">of {{ stats.totalSwaps }} indexed</p>
      </div>
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Volume</p>
        <p class="text-xl font-bold font-mono leading-tight">{{ formatAmount(stats.volumeUsdc, 0) }}</p>
        <p class="text-[10px] text-gray-500">USDC</p>
      </div>
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Traders</p>
        <p class="text-xl font-bold font-mono leading-tight">{{ stats.traders }}</p>
        <p class="text-[10px] text-gray-500">{{ lastSwapLabel }}</p>
      </div>
    </div>

    <!-- Swaps-per-window sparkline -->
    <div ref="spark" class="h-10 w-full" />
    <div class="flex justify-between text-[10px] text-gray-500 -mt-1">
      <span>activity, last {{ windowLabel }}</span>
      <span class="flex gap-2">
        <span class="text-accent-green">{{ stats.buys }} buys</span>
        <span class="text-accent-amber">{{ stats.sells }} sells</span>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import { formatAmount } from '@/config/pools'

const props = defineProps({
  stats: {
    type: Object,
    default: () => ({ swapCount: 0, volumeUsdc: 0, traders: 0, buys: 0, sells: 0, lastSwapAt: 0, totalSwaps: 0, scopeLabel: '' }),
  },
  swaps: { type: Array, default: () => [] },
})

const spark = ref(null)
const now = ref(Date.now())
let timer = null
let ro = null

onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 5000)
  ro = new ResizeObserver(() => draw())
  ro.observe(spark.value)
  draw()
})
onUnmounted(() => { clearInterval(timer); ro?.disconnect() })

watch(() => props.swaps, draw, { deep: false })

const lastSwapLabel = computed(() => {
  if (!props.stats.lastSwapAt) return 'no swaps yet'
  const diff = Math.max(0, Math.floor(now.value / 1000 - props.stats.lastSwapAt))
  if (diff < 60) return `last ${diff}s ago`
  if (diff < 3600) return `last ${Math.floor(diff / 60)}m ago`
  return `last ${Math.floor(diff / 3600)}h ago`
})

const WINDOW_MS = 60 * 60 * 1000
const BUCKET_MS = 2 * 60 * 1000
const windowLabel = '60 min'

function draw() {
  const el = spark.value
  if (!el) return
  el.innerHTML = ''
  const { width, height } = el.getBoundingClientRect()
  if (width <= 0 || height <= 0) return

  const end = Date.now()
  const start = end - WINDOW_MS
  const buckets = d3.range(start, end, BUCKET_MS).map((t) => ({ t, buy: 0, sell: 0 }))
  for (const s of props.swaps) {
    const ms = s.timestamp * 1000
    if (ms < start || ms > end) continue
    const idx = Math.min(buckets.length - 1, Math.floor((ms - start) / BUCKET_MS))
    if (s.side === 'buy') buckets[idx].buy++
    else buckets[idx].sell++
  }

  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height)
  const x = d3.scaleBand().domain(buckets.map((b) => b.t)).range([0, width]).paddingInner(0.25)
  const maxY = d3.max(buckets, (b) => b.buy + b.sell) || 1
  const y = d3.scaleLinear().domain([0, maxY]).range([height, 0])

  svg.append('line')
    .attr('x1', 0).attr('x2', width).attr('y1', height - 0.5).attr('y2', height - 0.5)
    .attr('stroke', '#1e293b')

  const g = svg.selectAll('g').data(buckets).enter().append('g')
    .attr('transform', (d) => `translate(${x(d.t)},0)`)

  g.append('rect')
    .attr('x', 0).attr('width', x.bandwidth())
    .attr('y', (d) => y(d.buy)).attr('height', (d) => height - y(d.buy))
    .attr('fill', '#22c55e').attr('rx', 1)
  g.append('rect')
    .attr('x', 0).attr('width', x.bandwidth())
    .attr('y', (d) => y(d.buy + d.sell)).attr('height', (d) => height - y(d.sell))
    .attr('fill', '#f59e0b').attr('rx', 1)
}
</script>
