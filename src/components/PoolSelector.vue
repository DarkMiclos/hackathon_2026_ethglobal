<template>
  <div class="bg-surface-800 rounded-xl p-4">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-medium text-gray-400">Pools</h2>
      <button
        v-if="addable"
        class="text-[11px] px-2 py-0.5 rounded-md bg-surface-700 hover:bg-surface-600 text-gray-200 transition-colors"
        title="Register a new pool subname on ENS"
        @click="$emit('add')"
      >+ Add pool</button>
    </div>
    <ul class="space-y-1.5">
      <li
        v-for="pool in pools"
        :key="pool.address"
        class="cursor-pointer rounded-lg px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 border"
        :class="activePool?.address === pool.address
          ? 'bg-surface-700/70 text-white border-surface-600'
          : 'hover:bg-surface-700/40 text-gray-300 border-transparent'"
        @click="$emit('select', pool)"
      >
        <div class="flex items-center gap-2 min-w-0">
          <img v-if="poolIcon(pool)" :src="poolIcon(pool)" :alt="`${pool.name} icon`" class="w-9 h-9 rounded-full shrink-0" @error="$event.target.hidden = true" />
          <span v-else class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: pool.color }" />
          <div class="min-w-0">
            <div class="font-medium truncate">{{ pool.name }}</div>
            <div v-if="pool.ensName" class="text-[10px] text-gray-400 truncate" :title="pool.ensName">{{ pool.ensName }}</div>
            <div class="text-[10px] text-gray-500 font-mono">
              {{ pool.address ? `${pool.fee / 10000}% fee` : 'combined view' }}
            </div>
          </div>
        </div>
        <span class="text-[10px] font-mono text-gray-500 shrink-0">{{ counts[pool.address] ?? 0 }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { poolIcon } from '@/utils/poolIcon'
defineProps({
  pools: { type: Array, required: true },
  activePool: { type: Object, default: null },
  counts: { type: Object, default: () => ({}) },
  addable: { type: Boolean, default: false },
})

defineEmits(['select', 'add'])
</script>
