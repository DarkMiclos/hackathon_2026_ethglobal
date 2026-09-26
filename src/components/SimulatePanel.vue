<template>
  <div class="bg-surface-800 rounded-xl p-4">
    <button
      v-if="!open"
      class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
      @click="openPanel"
    >
      Simulate Swaps
    </button>

    <div v-else class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-gray-300">Simulate Swaps</h3>
        <button class="text-gray-500 hover:text-gray-300 text-xs" @click="open = false">Close</button>
      </div>

      <div v-if="!keyConfigured" class="text-xs text-yellow-400 bg-yellow-400/10 rounded p-2">
        Set <code>VITE_TEST_PRIVATE_KEY</code> in <code>.env</code> to a throwaway Sepolia key to enable the simulator.
      </div>

      <template v-else>
        <!-- Readiness summary -->
        <div class="flex items-center justify-between text-xs">
          <span class="text-gray-500">
            {{ readyWallets.length }}/{{ wallets.length }} wallets ready
            <span v-if="inspectedAt" class="text-gray-600">· checked {{ checkedAgo }}</span>
          </span>
          <span
            class="px-1.5 py-0.5 rounded text-[10px] font-semibold"
            :class="allReady ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-amber/15 text-accent-amber'"
          >{{ allReady ? 'READY' : 'NEEDS SETUP' }}</span>
        </div>

        <!-- Wallet list -->
        <div class="space-y-1">
          <div
            v-for="w in wallets"
            :key="w.address"
            class="rounded-lg bg-surface-900 px-2 py-1.5"
          >
            <div class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="w.ready ? 'bg-accent-green' : w.inspected ? 'bg-accent-amber' : 'bg-surface-600'" />
              <span class="text-[10px] text-gray-500 shrink-0">{{ w.index === 0 ? 'main' : `#${w.index + 1}` }}</span>
              <code class="text-[10px] text-gray-300 truncate flex-1">{{ w.address }}</code>
              <button class="text-[10px] text-accent-blue hover:text-blue-300 shrink-0" @click="copy(w.address)">copy</button>
            </div>
            <div class="mt-0.5 flex items-center justify-between text-[10px] font-mono text-gray-400">
              <span>{{ fmtEth(w.eth) }} ETH · {{ fmtEth(w.weth) }} WETH · {{ fmtUsdc(w.usdc, 1) }} USDC</span>
              <span v-if="w.inspected && !w.ready" class="text-accent-amber font-sans">{{ needsLabel(w.needs) }}</span>
            </div>
          </div>
        </div>

        <!-- Funding hint -->
        <div v-if="mainShortfallEth > 0n" class="text-xs text-yellow-400 bg-yellow-400/10 rounded p-2">
          Send at least <b>{{ fmtEth(mainShortfallEth) }} ETH</b> more to the main wallet from a
          <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener" class="underline hover:text-yellow-300">faucet</a>,
          then click Refresh.
        </div>

        <!-- Actions -->
        <div class="flex gap-2">
          <button
            class="flex-1 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
            :disabled="busy"
            @click="inspectWallets"
          >
            {{ status === 'inspecting' ? 'Checking…' : 'Refresh' }}
          </button>
          <button
            v-if="!allReady"
            class="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors"
            :class="canPrepare ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-surface-700 text-gray-500 cursor-not-allowed'"
            :disabled="!canPrepare"
            @click="prepareWallets"
          >
            {{ status === 'preparing' ? 'Preparing…' : 'Prepare wallets' }}
          </button>
          <button
            class="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors"
            :class="canExecute ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-surface-700 text-gray-500 cursor-not-allowed'"
            :disabled="!canExecute"
            @click="onExecute"
          >
            <template v-if="status === 'swapping'">Swapping {{ swapsDone + swapsFailed }}/{{ swapsTotal }}…</template>
            <template v-else>Execute {{ plannedSwaps }} swaps</template>
          </button>
        </div>

        <div v-if="logs.length" class="max-h-32 overflow-y-auto space-y-0.5 trade-tape">
          <div
            v-for="(entry, i) in logs"
            :key="i"
            class="text-[10px] font-mono"
            :class="entry.level === 'error' ? 'text-red-400' : 'text-gray-500'"
          >{{ entry.msg }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSimulateSwaps } from '@/composables/useSimulateSwaps'

const emit = defineEmits(['executed'])

const {
  keyConfigured,
  wallets, status, busy, logs,
  swapsDone, swapsFailed, swapsTotal, plannedSwaps,
  readyWallets, allReady, mainShortfallEth, inspectedAt,
  initWallet, inspectWallets, prepareWallets, executeSwaps,
  fmtEth, fmtUsdc,
} = useSimulateSwaps()

const open = ref(false)
const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 5000) })
onUnmounted(() => clearInterval(timer))

const checkedAgo = computed(() => {
  const s = Math.max(0, Math.floor((now.value - inspectedAt.value) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`
})

const canPrepare = computed(() => !busy.value && wallets.value.some((w) => w.inspected) && mainShortfallEth.value === 0n)
const canExecute = computed(() => !busy.value && readyWallets.value.length > 0)

const NEED_LABELS = { eth: 'gas', weth: 'wrap', 'approve-weth': 'approve WETH', 'approve-usdc': 'approve USDC', usdc: 'seed USDC' }
function needsLabel(needs) {
  return 'needs ' + needs.map((n) => NEED_LABELS[n] || n).join(', ')
}

function openPanel() {
  initWallet()
  inspectWallets()
  open.value = true
}

async function onExecute() {
  await executeSwaps()
  if (swapsDone.value > 0) emit('executed')
}

function copy(addr) {
  navigator.clipboard?.writeText(addr)
}
</script>
