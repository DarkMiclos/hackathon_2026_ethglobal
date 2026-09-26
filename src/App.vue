<template>
  <div class="min-h-screen bg-surface-900">
    <!-- Top Nav -->
    <header class="border-b border-surface-700 px-6 py-3 flex items-center justify-between h-[57px]">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold tracking-tight">
          <span class="text-accent-blue">Name</span><span class="text-white">Flow</span>
        </h1>
        <span class="text-xs text-surface-600 font-mono mt-1">SEPOLIA</span>
      </div>

      <div class="flex items-center gap-5">
        <!-- Data source status -->
        <div class="flex items-center gap-2 text-xs" :title="error || ''">
          <span
            class="w-2 h-2 rounded-full inline-block"
            :class="isLive ? 'bg-accent-green live-dot' : configured ? 'bg-accent-red' : 'bg-accent-amber'"
          />
          <span :class="isLive ? 'text-gray-300' : 'text-gray-400'">
            {{ isLive ? 'Live · MultiBaas' : configured ? 'MultiBaas unreachable · demo data' : 'Demo data' }}
          </span>
          <span v-if="chainStatus" class="text-gray-500 font-mono whitespace-nowrap hidden md:inline">
            · block #{{ chainStatus.blockNumber.toLocaleString() }}
            <span v-if="chainStatus.baseFee" class="hidden xl:inline"> · {{ (Number(chainStatus.baseFee) / 1e9).toFixed(2) }} gwei</span>
          </span>
          <span v-if="totalSwaps" class="text-gray-500 font-mono whitespace-nowrap hidden lg:inline">· {{ totalSwaps }} swaps indexed</span>
        </div>

        <!-- ENS Search -->
        <EnsSearch />
      </div>
    </header>

    <router-view />
  </div>
</template>

<script setup>
import EnsSearch from './components/EnsSearch.vue'
import { useMultiBaas } from '@/composables/useMultiBaas'

const { isLive, configured, error, chainStatus, totalSwaps } = useMultiBaas()
</script>
