<template>
  <main class="p-4 grid grid-cols-12 gap-4 h-[calc(100vh-57px)] min-h-0">

    <!-- Left column: pools, stats, pool detail, simulate -->
    <aside class="col-span-3 flex flex-col gap-4 min-h-0 overflow-y-auto trade-tape pr-1">
      <PoolSelector
        :pools="pools"
        :active-pool="activePool"
        :counts="poolCounts"
        @select="selectPool"
      />
      <PoolDetail
        v-if="activePool?.address"
        :pool="activePool"
        :state="poolStates[activePool.address]"
        :aggregate="aggregates[activePool.address]"
        :swaps="filteredSwaps"
        :highlighted-trader="highlightedTrader"
        @select-trader="toggleTrader"
      />
      <StatsCard :stats="stats" :swaps="filteredSwaps" />
      <SimulatePanel @executed="onSwapsExecuted" />
    </aside>

    <!-- Center: visualizations -->
    <section class="col-span-6 flex flex-col gap-4 min-h-0 overflow-hidden">
      <div class="bg-surface-800 rounded-xl p-4 flex-1 min-h-0 flex flex-col">
        <div class="flex items-center justify-between mb-2 shrink-0">
          <div class="flex items-center gap-1 bg-surface-900 rounded-lg p-0.5">
            <button
              v-for="v in VIEWS"
              :key="v.id"
              class="px-3 py-1 text-xs rounded-md transition-colors"
              :class="view === v.id ? 'bg-surface-700 text-white' : 'text-gray-500 hover:text-gray-300'"
              @click="view = v.id"
            >{{ v.label }}</button>
          </div>
          <div class="flex items-center gap-3 text-[10px] text-gray-500">
            <span v-if="activePool?.address" class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" :style="{ background: activePool.color }" />
              {{ activePool.name }}
              <button class="text-accent-blue hover:underline ml-1" @click="selectPool(ALL_POOLS)">show all</button>
            </span>
            <span v-if="highlightedTrader" class="flex items-center gap-1 font-mono">
              {{ truncateAddr(highlightedTrader) }}
              <button class="text-accent-blue hover:underline ml-1 font-sans" @click="highlightedTrader = ''">clear</button>
            </span>
          </div>
        </div>
        <div class="flex-1 min-h-0 relative">
          <ForceGraph
            v-show="view === 'network'"
            :swaps="filteredSwaps"
            :pools="POOLS"
            :active-pool="activePool"
            :highlighted-trader="highlightedTrader"
            :new-swap-ids="newSwapIds"
            class="absolute inset-0"
            @select-pool="selectPool"
            @select-trader="toggleTrader"
          />
          <FlowSankey
            v-if="view === 'flow'"
            :swaps="filteredSwaps"
            :highlighted-trader="highlightedTrader"
            class="absolute inset-0"
            @select-pool="selectPool"
            @select-trader="toggleTrader"
          />
          <SwapTimeline
            v-if="view === 'timeline'"
            :swaps="filteredSwaps"
            :pools="POOLS"
            :highlighted-trader="highlightedTrader"
            :new-swap-ids="newSwapIds"
            class="absolute inset-0"
            @select-pool="selectPool"
            @select-trader="toggleTrader"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 h-52 shrink-0">
        <div class="bg-surface-800 rounded-xl p-3 flex flex-col min-h-0">
          <h2 class="text-xs font-medium text-gray-400 mb-1 shrink-0">
            {{ activePool?.address ? `${activePool.name} · ${activePool.quote.symbol} per ${activePool.base.symbol}` : 'Prices' }}
          </h2>
          <PriceChart :swaps="allSwaps" :active-pool="activePool" :pool-states="poolStates" class="flex-1 min-h-0" />
        </div>
        <div class="bg-surface-800 rounded-xl p-3 flex flex-col min-h-0">
          <h2 class="text-xs font-medium text-gray-400 mb-1 shrink-0">
            Volume per pool <span class="text-gray-600">· USDC-valued · click to focus</span>
          </h2>
          <VolumeChart :swaps="allSwaps" :pools="POOLS" :active-pool="activePool" class="flex-1 min-h-0" @select-pool="selectPool" />
        </div>
      </div>
    </section>

    <!-- Right column: live trade tape -->
    <aside class="col-span-3 flex flex-col min-h-0">
      <div class="bg-surface-800 rounded-xl p-4 flex-1 overflow-hidden flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-2 shrink-0">
          <h2 class="text-sm font-medium text-gray-400">Live Swaps</h2>
          <span class="text-[10px] text-gray-500">{{ filteredSwaps.length }} shown</span>
        </div>
        <TradeTape
          :swaps="filteredSwaps"
          :new-swap-ids="newSwapIds"
          :highlighted-trader="highlightedTrader"
          class="flex-1 overflow-y-auto trade-tape"
          @select-trader="toggleTrader"
        />
      </div>
    </aside>

  </main>
</template>

<script setup>
import { ref, shallowRef, computed } from 'vue'
import { useMultiBaas } from '@/composables/useMultiBaas'
import { usePoller } from '@/composables/usePoller'
import { POOLS, ALL_POOLS, enrichSwap, swapValueUsdc, decodePrice, truncateAddr } from '@/config/pools'
import PoolSelector from '@/components/PoolSelector.vue'
import StatsCard from '@/components/StatsCard.vue'
import PoolDetail from '@/components/PoolDetail.vue'
import SimulatePanel from '@/components/SimulatePanel.vue'
import ForceGraph from '@/components/ForceGraph.vue'
import FlowSankey from '@/components/FlowSankey.vue'
import SwapTimeline from '@/components/SwapTimeline.vue'
import PriceChart from '@/components/PriceChart.vue'
import VolumeChart from '@/components/VolumeChart.vue'
import TradeTape from '@/components/TradeTape.vue'

const VIEWS = [
  { id: 'network', label: 'Network' },
  { id: 'flow', label: 'Flow' },
  { id: 'timeline', label: 'Timeline' },
]

const {
  configured, swaps: rawSwaps, totalSwaps,
  syncSwaps, fetchPoolAggregates, fetchPoolState, fetchChainStatus,
} = useMultiBaas()

const poolStates = ref({})     // address -> slot0/liquidity/indexing state
const aggregates = ref({})     // address -> MultiBaas aggregated row
// Pool metadata stays non-reactive so identity comparisons against enriched swaps keep working.
const pools = [ALL_POOLS, ...POOLS]
const activePool = shallowRef(ALL_POOLS)
const highlightedTrader = ref('')
const view = ref('network')
const newSwapIds = ref([])

// Latest ETH price in USDC: slot0 of the WETH/USDC pool, else the last indexed swap there.
const ethUsdc = computed(() => {
  const pool = POOLS[0]
  const live = decodePrice(poolStates.value[pool.address]?.sqrtPriceX96, pool)
  if (live) return live
  const last = [...rawSwaps.value].reverse().find((s) => s.contractAddress === pool.address)
  return last ? decodePrice(last.sqrtPriceX96, pool) || 0 : 0
})

const allSwaps = computed(() =>
  rawSwaps.value
    .map(enrichSwap)
    .filter((s) => s.pool)
    .map((s) => ({ ...s, valueUsdc: swapValueUsdc(s, ethUsdc.value) })),
)

const filteredSwaps = computed(() => {
  if (!activePool.value?.address) return allSwaps.value
  return allSwaps.value.filter((s) => s.pool.address === activePool.value.address)
})

const poolCounts = computed(() => {
  const counts = { '': allSwaps.value.length }
  for (const s of allSwaps.value) counts[s.pool.address] = (counts[s.pool.address] || 0) + 1
  return counts
})

const stats = computed(() => {
  const rows = filteredSwaps.value
  return {
    swapCount: rows.length,
    totalSwaps: activePool.value?.address ? 0 : totalSwaps.value,
    volumeUsdc: rows.reduce((sum, s) => sum + (s.valueUsdc || 0), 0),
    traders: new Set(rows.map((s) => s.trader)).size,
    buys: rows.filter((s) => s.side === 'buy').length,
    sells: rows.filter((s) => s.side === 'sell').length,
    lastSwapAt: rows.length ? Math.max(...rows.map((s) => s.timestamp)) : 0,
    scopeLabel: activePool.value?.address ? activePool.value.name : 'all pools',
  }
})

function selectPool(pool) {
  activePool.value = pool?.address === activePool.value?.address ? ALL_POOLS : (pool || ALL_POOLS)
}

function toggleTrader(addr) {
  highlightedTrader.value = addr && addr !== highlightedTrader.value ? addr : ''
}

// ---- polling -------------------------------------------------------------
//
// Request budget: an idle poll costs exactly one MultiBaas request (the row count).
// Rows, pool state (slot0 / liquidity / indexer status) and aggregates are only fetched
// when that count moves, and pool state only for the pools that actually received swaps.
// The chain head in the header is refreshed on its own slow timer. Polling pauses while
// the tab is hidden and backs off on errors (see usePoller).

const SWAP_POLL_MS = 10000
const CHAIN_POLL_MS = 60000
let clearNewTimer = null

async function pollSwaps() {
  const { added, changed, initial } = await syncSwaps()
  if (!changed) return

  if (initial) {
    await refreshDerived(POOLS)
    return
  }

  newSwapIds.value = added.map((s) => s.id)
  clearTimeout(clearNewTimer)
  clearNewTimer = setTimeout(() => { newSwapIds.value = [] }, 4000)

  // Only the pools that changed need fresh slot0 / liquidity / aggregates.
  const touched = new Set(added.map((s) => s.contractAddress))
  await refreshDerived(POOLS.filter((p) => touched.has(p.address)))
}

/** Aggregates (one request) + per-pool state (three requests per pool) for the given pools. */
async function refreshDerived(pools) {
  if (!pools.length) return
  const [aggs, ...states] = await Promise.all([
    fetchPoolAggregates(),
    ...pools.map((p) => fetchPoolState(p)),
  ])
  if (aggs) aggregates.value = aggs
  const next = { ...poolStates.value }
  pools.forEach((p, i) => { if (states[i]) next[p.address] = states[i] })
  poolStates.value = next
}

const swapPoller = usePoller(pollSwaps, { interval: SWAP_POLL_MS })
usePoller(fetchChainStatus, { interval: CHAIN_POLL_MS, enabled: configured })

/** After the simulator broadcasts swaps, probe faster for a while so they animate in as MultiBaas indexes them. */
function onSwapsExecuted() {
  swapPoller.burst(4000, 90000)
}
</script>
