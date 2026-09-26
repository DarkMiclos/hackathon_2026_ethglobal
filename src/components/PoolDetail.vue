<template>
  <div class="bg-surface-800 rounded-xl p-4 space-y-3 border-l-2" :style="{ borderColor: pool.color }">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold text-gray-200">{{ pool.name }}</h2>
        <p class="text-[10px] text-gray-500 font-mono">{{ pool.fee / 10000 }}% fee · {{ truncateAddr(pool.address) }}</p>
      </div>
      <a
        :href="`https://sepolia.etherscan.io/address/${pool.address}`"
        target="_blank"
        rel="noopener"
        class="text-[10px] text-accent-blue hover:underline"
      >etherscan ↗</a>
    </div>

    <!-- Live price from slot0 -->
    <div>
      <p class="text-[10px] text-gray-500 uppercase tracking-wide">Live price · slot0()</p>
      <p class="text-2xl font-bold font-mono leading-tight">
        {{ livePrice != null ? formatAmount(livePrice) : '—' }}
        <span class="text-xs text-gray-500 font-normal">{{ pool.quote.symbol }} / {{ pool.base.symbol }}</span>
      </p>
      <p class="text-[10px] text-gray-500">
        <span v-if="priceChange != null" :class="priceChange >= 0 ? 'text-accent-green' : 'text-accent-red'">
          {{ priceChange >= 0 ? '▲' : '▼' }} {{ Math.abs(priceChange).toFixed(3) }}%
        </span>
        <span v-if="priceChange != null"> since first indexed swap</span>
        <span v-else>waiting for swaps</span>
      </p>
    </div>

    <!-- Buy/sell pressure -->
    <div>
      <div class="flex justify-between text-[10px] text-gray-500 mb-1">
        <span class="text-accent-green">{{ buys }} buys · {{ formatAmount(buyVol, 0) }} USDC</span>
        <span class="text-accent-amber">{{ sells }} sells · {{ formatAmount(sellVol, 0) }} USDC</span>
      </div>
      <div class="h-2 w-full rounded-full overflow-hidden bg-surface-700 flex">
        <div class="h-full bg-accent-green transition-all duration-500" :style="{ width: `${buyPct}%` }" />
        <div class="h-full bg-accent-amber transition-all duration-500" :style="{ width: `${100 - buyPct}%` }" />
      </div>
    </div>

    <!-- Tick strip -->
    <div>
      <div class="flex justify-between text-[10px] text-gray-500 mb-1">
        <span>tick range (indexed swaps)</span>
        <span class="font-mono">now {{ state?.tick ?? '—' }}</span>
      </div>
      <div class="relative h-5">
        <div class="absolute inset-x-0 top-2 h-1 rounded bg-surface-700" />
        <div
          v-if="tickRange"
          class="absolute top-2 h-1 rounded opacity-60"
          :style="{ left: `${tickRange.lo}%`, width: `${tickRange.hi - tickRange.lo}%`, background: pool.color }"
        />
        <div
          v-if="tickRange"
          class="absolute top-0.5 w-1 h-4 rounded-sm bg-white shadow"
          :style="{ left: `calc(${tickRange.now}% - 2px)` }"
        />
      </div>
      <div class="flex justify-between text-[10px] text-gray-600 font-mono">
        <span>{{ aggregate?.minTick ?? '' }}</span>
        <span>{{ aggregate?.maxTick ?? '' }}</span>
      </div>
    </div>

    <!-- Numbers -->
    <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Liquidity</p>
        <p class="font-mono text-gray-200">{{ liquidityLabel }}</p>
      </div>
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Swaps</p>
        <p class="font-mono text-gray-200">{{ swaps.length }}</p>
      </div>
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Net {{ pool.token0.symbol }} flow</p>
        <p class="font-mono" :class="flowClass(netToken0)">{{ signed(netToken0) }}</p>
      </div>
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Net {{ pool.token1.symbol }} flow</p>
        <p class="font-mono" :class="flowClass(netToken1)">{{ signed(netToken1) }}</p>
      </div>
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Indexed to</p>
        <p class="font-mono text-gray-200">
          <span v-if="state?.indexedToBlock">#{{ state.indexedToBlock.toLocaleString() }}</span>
          <span v-else>—</span>
          <span v-if="state?.isProcessingPastLogs" class="text-accent-amber"> syncing</span>
        </p>
      </div>
      <div>
        <p class="text-[10px] text-gray-500 uppercase tracking-wide">Last swap block</p>
        <p class="font-mono text-gray-200">{{ aggregate?.lastBlock ? `#${aggregate.lastBlock.toLocaleString()}` : '—' }}</p>
      </div>
    </div>

    <!-- Top traders -->
    <div v-if="topTraders.length">
      <p class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Top traders</p>
      <div class="space-y-1">
        <div
          v-for="t in topTraders"
          :key="t.address"
          class="flex items-center justify-between text-xs cursor-pointer rounded px-1 -mx-1 hover:bg-surface-700"
          :class="highlightedTrader === t.address ? 'text-accent-blue' : 'text-gray-300'"
          @click="$emit('select-trader', t.address)"
        >
          <span class="font-mono">{{ truncateAddr(t.address) }}</span>
          <span class="text-gray-500">{{ t.count }} swaps · {{ formatAmount(t.volume, 0) }} USDC</span>
        </div>
      </div>
    </div>

    <p class="text-[10px] text-gray-600">
      slot0, liquidity, indexing status: MultiBaas contract calls · net flow &amp; tick range: MultiBaas aggregated event query
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { decodePrice, formatAmount, truncateAddr } from '@/config/pools'

const props = defineProps({
  pool: { type: Object, required: true },
  state: { type: Object, default: null },       // from fetchPoolState
  aggregate: { type: Object, default: null },   // from fetchPoolAggregates
  swaps: { type: Array, default: () => [] },    // enriched swaps for this pool
  highlightedTrader: { type: String, default: '' },
})

defineEmits(['select-trader'])

const livePrice = computed(() => {
  const sqrt = props.state?.sqrtPriceX96 || props.aggregate?.lastSqrtPrice
  return decodePrice(sqrt, props.pool)
})

const priceChange = computed(() => {
  const first = props.swaps.find((s) => s.price)
  if (!first || livePrice.value == null) return null
  return ((livePrice.value - first.price) / first.price) * 100
})

const buys = computed(() => props.swaps.filter((s) => s.side === 'buy').length)
const sells = computed(() => props.swaps.length - buys.value)
const buyVol = computed(() => props.swaps.filter((s) => s.side === 'buy').reduce((a, s) => a + (s.valueUsdc || 0), 0))
const sellVol = computed(() => props.swaps.filter((s) => s.side === 'sell').reduce((a, s) => a + (s.valueUsdc || 0), 0))
const buyPct = computed(() => {
  const total = buyVol.value + sellVol.value
  return total > 0 ? Math.round((buyVol.value / total) * 100) : 50
})

const tickRange = computed(() => {
  const a = props.aggregate
  if (!a || !Number.isFinite(a.minTick) || !Number.isFinite(a.maxTick)) return null
  const nowTick = props.state?.tick ?? a.maxTick
  const lo = Math.min(a.minTick, nowTick)
  const hi = Math.max(a.maxTick, nowTick)
  const span = Math.max(hi - lo, 1)
  const pad = span * 0.15
  const domainLo = lo - pad
  const domain = span + pad * 2
  const pct = (t) => ((t - domainLo) / domain) * 100
  return { lo: pct(a.minTick), hi: pct(a.maxTick), now: pct(nowTick) }
})

const liquidityLabel = computed(() => {
  const l = props.state?.liquidity
  if (!l) return '—'
  try {
    return formatAmount(Number(BigInt(l)) / 1e18, 4) + ' L'
  } catch {
    return '—'
  }
})

const netToken0 = computed(() => netFlow(props.aggregate?.netAmount0, props.pool.token0.decimals))
const netToken1 = computed(() => netFlow(props.aggregate?.netAmount1, props.pool.token1.decimals))

function netFlow(raw, decimals) {
  if (raw == null) return null
  try {
    return Number(BigInt(raw)) / 10 ** decimals
  } catch {
    return null
  }
}

function signed(v) {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${formatAmount(v)}`
}

function flowClass(v) {
  if (v == null || v === 0) return 'text-gray-200'
  return v > 0 ? 'text-accent-green' : 'text-accent-red'
}

const topTraders = computed(() => {
  const m = new Map()
  for (const s of props.swaps) {
    if (!s.trader) continue
    const t = m.get(s.trader) || { address: s.trader, count: 0, volume: 0 }
    t.count++
    t.volume += s.valueUsdc || 0
    m.set(s.trader, t)
  }
  return [...m.values()].sort((a, b) => b.volume - a.volume).slice(0, 4)
})
</script>
