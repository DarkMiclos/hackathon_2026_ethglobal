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

      <!-- Main wallet -->
      <div class="space-y-1">
        <label class="text-xs text-gray-500">Main Wallet</label>
        <div class="flex items-center gap-1">
          <code class="text-xs text-gray-300 bg-surface-900 px-2 py-1 rounded flex-1 truncate">{{ wallets[0]?.address || 'no VITE_TEST_PRIVATE_KEY' }}</code>
          <button class="text-xs text-blue-400 hover:text-blue-300 shrink-0" @click="copyAddress(0)">Copy</button>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-gray-500">Balance</span>
          <span class="text-gray-300">{{ wallets[0]?.balance || '...' }} ETH</span>
        </div>
      </div>

      <!-- Sub-wallets toggle -->
      <div v-if="wallets.length > 1" class="space-y-1">
        <button class="text-xs text-gray-500 hover:text-gray-300" @click="showSubWallets = !showSubWallets">
          {{ showSubWallets ? '▾' : '▸' }} {{ wallets.length - 1 }} sub-wallets
        </button>
        <div v-if="showSubWallets" class="space-y-1 pl-2 border-l border-surface-700">
          <div v-for="(w, i) in wallets.slice(1)" :key="w.address" class="flex items-center gap-1">
            <code class="text-[10px] text-gray-400 bg-surface-900 px-1.5 py-0.5 rounded truncate flex-1">{{ w.address }}</code>
            <span class="text-[10px] text-gray-500 shrink-0">{{ w.balance || '...' }} Ξ</span>
          </div>
        </div>
      </div>

      <div v-if="!hasFunds" class="text-xs text-yellow-400 bg-yellow-400/10 rounded p-2">
        Fund the main wallet with ~0.3 Sepolia ETH from a
        <a
          href="https://www.alchemy.com/faucets/ethereum-sepolia"
          target="_blank"
          class="underline hover:text-yellow-300"
        >faucet</a>, then click Refresh.
      </div>

      <div class="flex gap-2">
        <button
          class="flex-1 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-gray-300 rounded-lg transition-colors"
          :disabled="status === 'running'"
          @click="refreshBalance"
        >
          Refresh
        </button>
        <button
          v-if="!setupDone"
          class="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors"
          :class="hasFunds && status !== 'running'
            ? 'bg-purple-600 hover:bg-purple-500 text-white'
            : 'bg-surface-700 text-gray-500 cursor-not-allowed'"
          :disabled="!hasFunds || status === 'running'"
          @click="setupWallets"
        >
          {{ status === 'running' ? 'Setting up...' : 'Setup Wallets' }}
        </button>
        <button
          v-else
          class="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors"
          :class="status !== 'running'
            ? 'bg-green-600 hover:bg-green-500 text-white'
            : 'bg-surface-700 text-gray-500 cursor-not-allowed'"
          :disabled="status === 'running'"
          @click="onExecute"
        >
          {{ status === 'running' ? `Swapping ${swapsDone}/${swapsTotal}...` : `Execute ${swapsTotal} Swaps` }}
        </button>
      </div>

      <div v-if="logs.length" class="max-h-32 overflow-y-auto space-y-0.5">
        <div
          v-for="(entry, i) in logs"
          :key="i"
          class="text-[10px] font-mono"
          :class="entry.msg.startsWith('Error') ? 'text-red-400' : 'text-gray-500'"
        >{{ entry.msg }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useSimulateSwaps } from '@/composables/useSimulateSwaps'

const emit = defineEmits(['executed'])

const {
  wallets,
  hasFunds,
  status,
  logs,
  swapsDone,
  swapsTotal,
  setupDone,
  initWallet,
  refreshBalance,
  setupWallets,
  executeSwaps,
} = useSimulateSwaps()

const open = ref(false)
const showSubWallets = ref(false)

function openPanel() {
  initWallet()
  refreshBalance()
  open.value = true
}

async function onExecute() {
  await executeSwaps()
  emit('executed')
}

function copyAddress(index) {
  const addr = wallets.value[index]?.address
  if (addr) navigator.clipboard?.writeText(addr)
}
</script>
