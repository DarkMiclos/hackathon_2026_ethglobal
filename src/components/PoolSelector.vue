<template>
  <div class="bg-surface-800 rounded-xl p-4">
    <h2 class="text-sm font-medium text-gray-400 mb-3">Pools</h2>
    <ul class="space-y-2">
      <li
        v-for="pool in pools"
        :key="pool.address"
        @click="$emit('select', pool)"
        class="cursor-pointer rounded-lg px-3 py-2 text-sm transition-colors"
        :class="activePool?.address === pool.address
          ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
          : 'hover:bg-surface-700 text-gray-300'"
      >
        <div class="font-medium">{{ pool.name }}</div>
        <div class="text-xs text-gray-500 font-mono mt-0.5">
          {{ pool.fee / 10000 }}% fee
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
defineProps({
  pools: { type: Array, required: true },
  activePool: { type: Object, default: null },
})

defineEmits(['select'])
</script>
