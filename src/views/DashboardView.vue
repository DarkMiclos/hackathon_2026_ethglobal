<template>
  <main class="p-4 grid grid-cols-12 gap-4 h-[calc(100vh-57px)] min-h-0">

    <!-- Left column: pools, pool detail, wallets, stats, simulate, add pool -->
    <aside v-show="!expanded" class="col-span-3 flex flex-col gap-4 min-h-0 overflow-y-auto trade-tape pr-1">
      <p v-if="ensLoading" class="text-xs text-gray-400 px-1">Loading watchlist from {{ NAMEFLOW_NAMESPACE }}…</p>
      <p v-else-if="ensError" class="text-[10px] text-accent-amber bg-accent-amber/10 rounded px-2 py-1" role="alert">
        ENS directory unavailable, showing the built-in pool list. {{ ensError }}
      </p>
      <PoolSelector
        :pools="pools"
        :active-pool="activePool"
        :counts="poolCounts"
        addable
        @select="selectPool"
        @add="addPoolOpen = true"
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
      <div v-if="wallets.length" class="bg-surface-800 rounded-xl p-4">
        <h2 class="text-sm font-medium text-gray-400 mb-2">Named wallets</h2>
        <div class="space-y-1">
          <button
            v-for="wallet in wallets"
            :key="wallet.ensName"
            class="w-full flex items-center gap-2 text-xs py-1 px-1 -mx-1 rounded hover:bg-surface-700 text-left"
            :class="highlightedTrader === wallet.address.toLowerCase() ? 'text-accent-blue' : 'text-gray-300'"
            @click="toggleTrader(wallet.address.toLowerCase())"
          >
            <img :src="walletAvatar(wallet.address)" alt="" class="w-6 h-6 rounded-full shrink-0" />
            <span class="truncate">{{ wallet.ensName }}</span>
            <a
              :href="`https://sepolia.etherscan.io/address/${wallet.address}`"
              target="_blank"
              rel="noopener"
              class="ml-auto text-[10px] text-gray-500 hover:text-accent-blue shrink-0"
              @click.stop
            >↗</a>
          </button>
        </div>
      </div>
      <StatsCard :stats="stats" :swaps="filteredSwaps" />
      <SimulatePanel @executed="onSwapsExecuted" />
    </aside>

    <AddPoolModal :open="addPoolOpen" :pools="POOLS" @close="addPoolOpen = false" @added="reloadDirectory({ force: true })" />

    <!-- Center: visualizations -->
    <section class="flex flex-col gap-4 min-h-0 overflow-hidden" :class="expanded ? 'col-span-12' : 'col-span-6'">
      <div class="bg-surface-800 rounded-xl p-4 flex-1 min-h-0 flex flex-col">
        <div class="flex items-center justify-between gap-2 mb-2 shrink-0 flex-wrap">
          <div class="flex items-center gap-2">
            <button
              class="w-6 h-6 rounded-md bg-surface-900 text-gray-500 hover:text-gray-200 text-xs"
              :title="expanded ? 'Exit full view (f)' : 'Expand the visualization to full view (f)'"
              @click="toggleExpanded"
            >{{ expanded ? '⤡' : '⤢' }}</button>
            <div class="flex items-center gap-1 bg-surface-900 rounded-lg p-0.5">
              <button
                v-for="v in VIEWS"
                :key="v.id"
                class="px-3 py-1 text-xs rounded-md transition-colors"
                :class="view === v.id ? 'bg-surface-700 text-white' : 'text-gray-500 hover:text-gray-300'"
                @click="view = v.id"
              >{{ v.label }}</button>
            </div>
            <div class="flex items-center gap-0.5 bg-surface-900 rounded-lg p-0.5" :class="replay.active ? 'opacity-40 pointer-events-none' : ''" title="Time window">
              <button
                v-for="w in WINDOWS"
                :key="w.id"
                class="px-2 py-1 text-[10px] rounded-md transition-colors"
                :class="timeWindow === w.id ? 'bg-surface-700 text-white' : 'text-gray-500 hover:text-gray-300'"
                @click="setWindow(w.id)"
              >{{ w.label }}</button>
            </div>
          </div>
          <div class="flex items-center gap-3 text-[10px] text-gray-500">
            <span v-if="replay.active" class="text-accent-amber">replay {{ replay.cursor }}/{{ replaySource.length }}</span>
            <span v-if="activePool?.address" class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full" :style="{ background: activePool.color }" />
              {{ activePool.name }}
              <button class="text-accent-blue hover:underline ml-1" @click="selectPool(ALL_POOLS)">show all</button>
            </span>
            <span v-if="highlightedTrader" class="flex items-center gap-1 font-mono">
              {{ identityNames[highlightedTrader] || truncateAddr(highlightedTrader) }}
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

      <div v-show="!expanded" class="grid grid-cols-2 gap-4 h-52 shrink-0">
        <div class="bg-surface-800 rounded-xl p-3 flex flex-col min-h-0">
          <h2 class="text-xs font-medium text-gray-400 mb-1 shrink-0">
            {{ activePool?.address ? `${activePool.name} · ${activePool.quote.symbol} per ${activePool.base.symbol}` : 'Prices' }}
          </h2>
          <PriceChart :swaps="visibleSwaps" :active-pool="activePool" :pool-states="poolStates" class="flex-1 min-h-0" />
        </div>
        <div class="bg-surface-800 rounded-xl p-3 flex flex-col min-h-0">
          <h2 class="text-xs font-medium text-gray-400 mb-1 shrink-0">
            Volume per pool <span class="text-gray-600">· USDC-valued · click to focus</span>
          </h2>
          <VolumeChart :swaps="visibleSwaps" :pools="POOLS" :active-pool="activePool" class="flex-1 min-h-0" @select-pool="selectPool" />
        </div>
      </div>
    </section>

    <!-- Right column: live trade tape with replay controls -->
    <aside v-show="!expanded" class="col-span-3 flex flex-col min-h-0">
      <div class="bg-surface-800 rounded-xl p-4 flex-1 overflow-hidden flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-2 shrink-0">
          <h2 class="text-sm font-medium text-gray-400">
            {{ replay.active ? 'Replay' : 'Live Swaps' }}
          </h2>
          <div class="flex items-center gap-2 text-[10px] text-gray-500">
            <span>{{ filteredSwaps.length }} shown<template v-if="!replay.active && timeWindow !== 'all'"> · last {{ timeWindow }}</template></span>
            <button
              v-if="!replay.active"
              class="px-2 py-0.5 rounded bg-surface-700 hover:bg-surface-600 text-gray-200 disabled:opacity-40"
              :disabled="allSwaps.length < 2"
              title="Replay the indexed history through every view"
              @click="startReplay"
            >▶ Replay</button>
            <button
              v-else
              class="px-2 py-0.5 rounded bg-surface-700 hover:bg-surface-600 text-gray-200"
              @click="stopReplay"
            >✕ Live</button>
          </div>
        </div>

        <div v-if="replay.active" class="mb-2 shrink-0 rounded-lg bg-surface-900 px-2 py-2 space-y-1.5">
          <div class="flex items-center gap-1.5">
            <button class="w-7 h-6 rounded bg-surface-700 hover:bg-surface-600 text-gray-100 text-xs" @click="replay.playing ? pauseReplay() : resumeReplay()">
              {{ replay.playing ? '❚❚' : '▶' }}
            </button>
            <button class="w-7 h-6 rounded bg-surface-700 hover:bg-surface-600 text-gray-100 text-xs" title="Restart" @click="scrubReplay(0); resumeReplay()">⟲</button>
            <div class="flex items-center gap-0.5 ml-1">
              <button
                v-for="s in [1, 2, 4, 8]"
                :key="s"
                class="px-1.5 py-0.5 rounded text-[10px]"
                :class="replay.speed === s ? 'bg-surface-700 text-white' : 'text-gray-500 hover:text-gray-300'"
                @click="replay.speed = s"
              >{{ s }}×</button>
            </div>
            <span class="ml-auto text-[10px] font-mono text-gray-400">{{ replayClock }}</span>
          </div>
          <input
            type="range"
            min="0"
            :max="replaySource.length"
            :value="replay.cursor"
            class="w-full h-1 accent-blue-500 cursor-pointer"
            @input="scrubReplay(Number($event.target.value))"
          />
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
import { ref, shallowRef, computed, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useMultiBaas } from '@/composables/useMultiBaas'
import { usePoller } from '@/composables/usePoller'
import { useEns, identityNames } from '@/composables/useEns'
import { NAMEFLOW_NAMESPACE } from '@/config/ens'
import { walletAvatar } from '@/utils/walletAvatar'
import { POOLS, setPools, FALLBACK_POOLS, ALL_POOLS, enrichSwap, swapValueUsdc, decodePrice, truncateAddr } from '@/config/pools'
import PoolSelector from '@/components/PoolSelector.vue'
import StatsCard from '@/components/StatsCard.vue'
import PoolDetail from '@/components/PoolDetail.vue'
import SimulatePanel from '@/components/SimulatePanel.vue'
import AddPoolModal from '@/components/AddPoolModal.vue'
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
const WINDOWS = [
  { id: '15m', label: '15m', ms: 15 * 60_000 },
  { id: '1h', label: '1h', ms: 60 * 60_000 },
  { id: '24h', label: '24h', ms: 24 * 60 * 60_000 },
  { id: 'all', label: 'all', ms: 0 },
]

const {
  configured, swaps: rawSwaps, totalSwaps,
  syncSwaps, fetchPoolAggregates, fetchPoolState, fetchChainStatus,
} = useMultiBaas()
const { loadDirectory, resolveAddress } = useEns()

const poolStates = ref({})     // address -> slot0/liquidity/indexing state
const aggregates = ref({})     // address -> MultiBaas aggregated row
const pools = computed(() => [ALL_POOLS, ...POOLS])
const wallets = ref([])
const ensLoading = ref(true)
const ensError = ref('')
const activePool = shallowRef(ALL_POOLS)
const highlightedTrader = ref('')
// Shareable links: ?view=network|flow|timeline&expanded=1&window=15m|1h|24h|all&pool=<address|label>
const urlParams = new URLSearchParams(window.location.search)
const view = ref(['network', 'flow', 'timeline'].includes(urlParams.get('view')) ? urlParams.get('view') : 'network')
const newSwapIds = ref([])
const addPoolOpen = ref(false)

// ---- UI preferences (per browser) --------------------------------------------------------

const expanded = ref(urlParams.get('expanded') === '1') // full-view presentation mode, not persisted
const timeWindow = ref(['15m', '1h', '24h', 'all'].includes(urlParams.get('window')) ? urlParams.get('window') : (readPref('nameflow.timeWindow') || 'all'))
function readPref(key) { try { return localStorage.getItem(key) } catch { return null } }
function writePref(key, value) { try { localStorage.setItem(key, value) } catch { /* ignore */ } }
function toggleExpanded() { expanded.value = !expanded.value }
function setWindow(id) { timeWindow.value = id; writePref('nameflow.timeWindow', id) }
function onKey(e) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (document.querySelector('[role=dialog]')) return // a modal owns the keyboard
  if (e.key === 'f' || e.key === '[') toggleExpanded()
  else if (e.key === '1') view.value = 'network'
  else if (e.key === '2') view.value = 'flow'
  else if (e.key === '3') view.value = 'timeline'
  else if (e.key === 'Escape') {
    if (expanded.value) { expanded.value = false; return }
    highlightedTrader.value = ''
    if (activePool.value.address) activePool.value = ALL_POOLS
  }
}

// ---- derived swap data --------------------------------------------------------------------

// Latest ETH price in USDC: slot0 of the WETH/USDC pool, else the last indexed swap there.
const ethUsdc = computed(() => {
  const pool = POOLS.find((p) => p.base.symbol === 'WETH' && p.quote.symbol === 'USDC')
  if (!pool) return 0
  const live = decodePrice(poolStates.value[pool.address]?.sqrtPriceX96, pool)
  if (live) return live
  const last = [...rawSwaps.value].reverse().find((s) => s.contractAddress === pool.address)
  return last ? decodePrice(last.sqrtPriceX96, pool) || 0 : 0
})

const allSwaps = computed(() =>
  rawSwaps.value
    .map(enrichSwap)
    .filter((s) => s.pool)
    .map((s) => ({ ...s, traderName: identityNames[s.trader], valueUsdc: swapValueUsdc(s, ethUsdc.value) })),
)

// "now" for the time window, ticking slowly so the filter does not recompute every render
const nowSec = ref(Math.floor(Date.now() / 1000))
let nowTimer = null

// Replay: a frozen snapshot of history revealed one swap at a time.
const replay = reactive({ active: false, playing: false, cursor: 0, speed: 1 })
const replaySource = shallowRef([])
let replayTimer = null

const visibleSwaps = computed(() => {
  if (replay.active) return replaySource.value.slice(0, replay.cursor)
  const win = WINDOWS.find((w) => w.id === timeWindow.value)
  if (!win || !win.ms) return allSwaps.value
  const cutoff = nowSec.value - win.ms / 1000
  return allSwaps.value.filter((s) => s.timestamp >= cutoff)
})

const filteredSwaps = computed(() => {
  if (!activePool.value?.address) return visibleSwaps.value
  return visibleSwaps.value.filter((s) => s.pool.address === activePool.value.address)
})

const poolCounts = computed(() => {
  const counts = { '': visibleSwaps.value.length }
  for (const s of visibleSwaps.value) counts[s.pool.address] = (counts[s.pool.address] || 0) + 1
  return counts
})

const stats = computed(() => {
  const rows = filteredSwaps.value
  return {
    swapCount: rows.length,
    totalSwaps: activePool.value?.address || replay.active || timeWindow.value !== 'all' ? 0 : totalSwaps.value,
    volumeUsdc: rows.reduce((sum, s) => sum + (s.valueUsdc || 0), 0),
    traders: new Set(rows.map((s) => s.trader)).size,
    buys: rows.filter((s) => s.side === 'buy').length,
    sells: rows.filter((s) => s.side === 'sell').length,
    lastSwapAt: rows.length ? Math.max(...rows.map((s) => s.timestamp)) : 0,
    scopeLabel: [
      activePool.value?.address ? activePool.value.name : 'all pools',
      replay.active ? 'replay' : timeWindow.value !== 'all' ? `last ${timeWindow.value}` : null,
    ].filter(Boolean).join(' · '),
  }
})

const replayClock = computed(() => {
  const s = replaySource.value[replay.cursor - 1]
  if (!s) return 'start'
  return new Date(s.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})

function selectPool(pool) {
  activePool.value = pool?.address === activePool.value?.address ? ALL_POOLS : (pool || ALL_POOLS)
}

function toggleTrader(addr) {
  highlightedTrader.value = addr && addr !== highlightedTrader.value ? addr : ''
}

// ---- replay -------------------------------------------------------------------------------

function startReplay() {
  replaySource.value = [...allSwaps.value]
  replay.cursor = 0
  replay.active = true
  newSwapIds.value = []
  resumeReplay()
}

function resumeReplay() {
  if (replay.cursor >= replaySource.value.length) replay.cursor = 0
  replay.playing = true
  tickReplay()
}

function pauseReplay() {
  replay.playing = false
  clearTimeout(replayTimer)
}

function stopReplay() {
  pauseReplay()
  replay.active = false
  replay.cursor = 0
  newSwapIds.value = []
}

function scrubReplay(n) {
  replay.cursor = Math.max(0, Math.min(replaySource.value.length, n))
  newSwapIds.value = []
}

function tickReplay() {
  clearTimeout(replayTimer)
  if (!replay.playing) return
  if (replay.cursor >= replaySource.value.length) { replay.playing = false; return }
  const next = replaySource.value[replay.cursor]
  replay.cursor++
  newSwapIds.value = [next.id]
  replayTimer = setTimeout(tickReplay, 1000 / replay.speed)
}

// ---- ENS directory -------------------------------------------------------------------------

// The parsed directory is cached per browser for ten minutes: the dashboard paints from the
// cache instantly and revalidates against ENS in the background, so a reload costs no RPC
// calls up front and a throttled RPC never blanks the watchlist.
const DIR_CACHE_KEY = 'nameflow.ens.directory'
const DIR_CACHE_TTL = 10 * 60 * 1000

function readDirectoryCache() {
  try {
    const raw = localStorage.getItem(DIR_CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached?.at || Date.now() - cached.at > DIR_CACHE_TTL || !Array.isArray(cached.pools)) return null
    // JSON lost object identity: base/quote must be the same objects as token0/token1.
    const pools = cached.pools.map((p) => ({
      ...p,
      base: p.base.address === p.token0.address ? p.token0 : p.token1,
      quote: p.quote.address === p.token0.address ? p.token0 : p.token1,
    }))
    for (const p of pools) identityNames[p.address] = p.ensName
    for (const w of cached.wallets || []) identityNames[w.address.toLowerCase()] = w.ensName
    return { pools, wallets: cached.wallets || [] }
  } catch {
    return null
  }
}

function writeDirectoryCache(directory) {
  try {
    localStorage.setItem(DIR_CACHE_KEY, JSON.stringify({ at: Date.now(), pools: directory.pools, wallets: directory.wallets }))
  } catch { /* storage unavailable */ }
}

async function reloadDirectory({ force = false } = {}) {
  const cached = force ? null : readDirectoryCache()
  if (cached && !POOLS.length) {
    setPools(cached.pools)
    wallets.value = cached.wallets
    ensLoading.value = false
    refreshDerived(POOLS)
  }
  ensLoading.value = POOLS.length === 0
  ensError.value = ''
  try {
    const directory = await withTimeout(loadDirectory(), 25000, 'ENS read timed out')
    writeDirectoryCache(directory)
    const changed = JSON.stringify(directory.pools.map((p) => p.address)) !== JSON.stringify([...POOLS].map((p) => p.address))
    setPools(directory.pools)
    wallets.value = directory.wallets
    if (changed || !cached) await refreshDerived(POOLS)
  } catch (err) {
    if (!POOLS.length) {
      ensError.value = err.message
      setPools(FALLBACK_POOLS)
      await refreshDerived(POOLS)
    } else {
      console.warn('ENS directory revalidation failed, keeping the current watchlist:', err.message)
    }
  } finally {
    ensLoading.value = false
  }
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

const traderLookups = new Set()
function resolveTraders(swaps) {
  for (const s of swaps) {
    const address = s.recipient || s.txFrom
    if (!address || traderLookups.has(address) || identityNames[address]) continue
    traderLookups.add(address)
    resolveAddress(address).catch(() => {}).finally(() => traderLookups.delete(address))
  }
}

// ---- polling -------------------------------------------------------------------------------
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
    resolveTraders(rawSwaps.value)
    await refreshDerived(POOLS)
    return
  }

  resolveTraders(added)
  if (!replay.active) {
    newSwapIds.value = added.map((s) => s.id)
    clearTimeout(clearNewTimer)
    clearNewTimer = setTimeout(() => { newSwapIds.value = [] }, 4000)
  }

  // Only the pools that changed need fresh slot0 / liquidity / aggregates.
  const touched = new Set(added.map((s) => s.contractAddress))
  await refreshDerived(POOLS.filter((p) => touched.has(p.address)))
}

/** Aggregates (one request) + per-pool state (three requests per pool) for the given pools. */
async function refreshDerived(poolList) {
  const list = [...poolList]
  if (!list.length) return
  const [aggs, ...states] = await Promise.all([
    fetchPoolAggregates(),
    ...list.map((p) => fetchPoolState(p)),
  ])
  if (aggs) aggregates.value = aggs
  const next = { ...poolStates.value }
  list.forEach((p, i) => { if (states[i]) next[p.address] = states[i] })
  poolStates.value = next
}

const swapPoller = usePoller(pollSwaps, { interval: SWAP_POLL_MS })
usePoller(fetchChainStatus, { interval: CHAIN_POLL_MS, enabled: configured })

/** After the simulator broadcasts swaps, probe faster for a while so they animate in as MultiBaas indexes them. */
function onSwapsExecuted() {
  swapPoller.burst(4000, 90000)
}

onMounted(() => {
  reloadDirectory()
  nowTimer = setInterval(() => { nowSec.value = Math.floor(Date.now() / 1000) }, 30000)
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  clearInterval(nowTimer)
  clearTimeout(replayTimer)
  clearTimeout(clearNewTimer)
  window.removeEventListener('keydown', onKey)
})

// ?pool=<address or subname label> selects a pool once the watchlist is loaded.
const wantedPool = (urlParams.get('pool') || '').toLowerCase()
watch(() => POOLS.length, () => {
  if (!wantedPool || activePool.value.address) return
  const match = POOLS.find((p) => p.address === wantedPool || (p.ensName || '').split('.')[0] === wantedPool || (p.alias || '') === wantedPool)
  if (match) activePool.value = match
}, { immediate: true })

// A pool filter that no longer exists (directory reloaded) falls back to the combined view.
watch(() => POOLS.length, () => {
  if (activePool.value.address && !POOLS.some((p) => p.address === activePool.value.address)) activePool.value = ALL_POOLS
})
</script>
