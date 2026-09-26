<template>
  <main class="p-6 grid grid-cols-12 gap-4 h-[calc(100vh-57px)]">

    <!-- Left column: Pool selector + Stats + Simulate -->
    <aside class="col-span-3 flex flex-col gap-4">
      <PoolSelector
        :pools="pools"
        :active-pool="activePool"
        @select="activePool = $event"
      />
      <StatsCard :stats="stats" />
      <div v-if="isLive" class="flex items-center gap-2 text-xs text-green-400 px-3">
        <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        Live — MultiBaas
      </div>
      <div v-else class="flex items-center gap-2 text-xs text-yellow-400 px-3">
        <span class="w-2 h-2 rounded-full bg-yellow-400" />
        Demo data
      </div>

      <!-- Simulate Swaps Panel -->
      <div class="bg-surface-800 rounded-xl p-4">
        <button
          v-if="!simPanelOpen"
          class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          @click="openSimPanel"
        >
          Simulate Swaps
        </button>

        <div v-else class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium text-gray-300">Simulate Swaps</h3>
            <button class="text-gray-500 hover:text-gray-300 text-xs" @click="simPanelOpen = false">Close</button>
          </div>

          <div class="space-y-1">
            <label class="text-xs text-gray-500">Test Wallet</label>
            <div class="flex items-center gap-1">
              <code class="text-xs text-gray-300 bg-surface-900 px-2 py-1 rounded flex-1 truncate">{{ simWalletAddress }}</code>
              <button
                class="text-xs text-blue-400 hover:text-blue-300 shrink-0"
                @click="copyAddress"
              >Copy</button>
            </div>
          </div>

          <div class="flex items-center justify-between text-xs">
            <span class="text-gray-500">Balance</span>
            <span class="text-gray-300">{{ simBalance || '...' }} ETH</span>
          </div>

          <div v-if="!simHasFunds" class="text-xs text-yellow-400 bg-yellow-400/10 rounded p-2">
            Fund this address with ~0.01 Sepolia ETH from a
            <a
              href="https://www.alchemy.com/faucets/ethereum-sepolia"
              target="_blank"
              class="underline hover:text-yellow-300"
            >faucet</a>, then click Refresh.
          </div>

          <div class="flex gap-2">
            <button
              class="flex-1 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-gray-300 rounded-lg transition-colors"
              :disabled="simStatus === 'running'"
              @click="onRefreshBalance"
            >
              Refresh
            </button>
            <button
              class="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors"
              :class="simHasFunds && simStatus !== 'running'
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-surface-700 text-gray-500 cursor-not-allowed'"
              :disabled="!simHasFunds || simStatus === 'running'"
              @click="onExecuteSwaps"
            >
              {{ simStatus === 'running' ? `Swapping ${simSwapsDone}/${simSwapsTotal}...` : 'Execute 5 Swaps' }}
            </button>
          </div>

          <div v-if="simLogs.length" class="max-h-32 overflow-y-auto space-y-0.5">
            <div
              v-for="(entry, i) in simLogs"
              :key="i"
              class="text-[10px] font-mono"
              :class="entry.msg.startsWith('Error') ? 'text-red-400' : 'text-gray-500'"
            >{{ entry.msg }}</div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Center: D3 visualizations -->
    <section class="col-span-6 flex flex-col gap-4">
      <div class="bg-surface-800 rounded-xl p-4 flex-1 viz-container">
        <h2 class="text-sm font-medium text-gray-400 mb-2">Trader Network</h2>
        <ForceGraph :swaps="filteredSwaps" />
      </div>
      <div class="bg-surface-800 rounded-xl p-4 h-48 viz-container">
        <h2 class="text-sm font-medium text-gray-400 mb-2">Price</h2>
        <PriceChart :swaps="filteredSwaps" />
      </div>
    </section>

    <!-- Right column: Live trade tape -->
    <aside class="col-span-3 flex flex-col">
      <div class="bg-surface-800 rounded-xl p-4 flex-1 overflow-hidden flex flex-col">
        <h2 class="text-sm font-medium text-gray-400 mb-2">Live Swaps</h2>
        <TradeTape :swaps="filteredSwaps" class="flex-1 overflow-y-auto trade-tape" />
      </div>
    </aside>

  </main>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, toRef } from 'vue'
import { useMultiBaas } from '@/composables/useMultiBaas'
import { useSimulateSwaps } from '@/composables/useSimulateSwaps'
import PoolSelector from '@/components/PoolSelector.vue'
import StatsCard from '@/components/StatsCard.vue'
import ForceGraph from '@/components/ForceGraph.vue'
import PriceChart from '@/components/PriceChart.vue'
import TradeTape from '@/components/TradeTape.vue'

const { fetchSwaps, isLive, loading, error } = useMultiBaas()

const {
  walletAddress: simWalletAddress,
  balance: simBalance,
  hasFunds: simHasFunds,
  status: simStatus,
  logs: simLogs,
  swapsDone: simSwapsDone,
  swapsTotal: simSwapsTotal,
  initWallet,
  refreshBalance,
  executeSwaps,
} = useSimulateSwaps()

const KNOWN_POOLS = [
  { name: 'WETH / USDC', address: '0x6ce0896eae6d4bd668fde41bb784548fb8f59b50', fee: 3000 },
  { name: 'WETH / UNI',  address: '0x287b0e934ed0439e2a7b1d5f0fc25ea2c24b64f7', fee: 3000 },
  { name: 'USDC / UNI',  address: '0x349492f65c8b27efef83456189b85d0fa32afccd', fee: 3000 },
]

const ALL_POOLS = { name: 'All Pools', address: '', fee: 0 }

const allSwaps = ref([])
const pools = ref([ALL_POOLS, ...KNOWN_POOLS])
const activePool = ref(ALL_POOLS)
const simPanelOpen = ref(false)

const filteredSwaps = computed(() => {
  if (!activePool.value?.address) return allSwaps.value
  const target = activePool.value.address.toLowerCase()
  return allSwaps.value.filter((s) => s.contractAddress === target)
})

const stats = computed(() => ({
  swapCount: filteredSwaps.value.length,
  volume: filteredSwaps.value.reduce((sum, s) => sum + Math.abs(s.amount0), 0),
  traders: new Set(filteredSwaps.value.map((s) => s.sender)).size,
}))

let pollInterval = null

onMounted(() => {
  loadSwaps()
  pollInterval = setInterval(loadSwaps, 5000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})

async function loadSwaps() {
  const data = await fetchSwaps()
  allSwaps.value = data
}

function openSimPanel() {
  initWallet()
  refreshBalance()
  simPanelOpen.value = true
}

async function onRefreshBalance() {
  await refreshBalance()
}

async function onExecuteSwaps() {
  await executeSwaps(5)
}

function copyAddress() {
  navigator.clipboard?.writeText(simWalletAddress.value)
}
</script>
