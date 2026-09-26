<template>
  <div class="relative">
    <input
      v-model="query"
      @keydown.enter="handleSearch"
      type="text"
      placeholder="Search ENS name or address..."
      class="bg-surface-800 border border-surface-600 rounded-lg px-4 py-2 text-sm w-72
             focus:outline-none focus:border-accent-blue placeholder-gray-500"
    />
    <span
      v-if="isLoading"
      class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs"
    >
      resolving…
    </span>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useEns } from '@/composables/useEns'

const query = ref('')
const isLoading = ref(false)
const { resolveName } = useEns()

async function handleSearch() {
  if (!query.value.trim()) return
  isLoading.value = true
  try {
    const result = await resolveName(query.value.trim())
    // TODO: emit result to dashboard or update global state
    console.log('ENS resolved:', result)
  } catch (err) {
    console.error('ENS resolution failed:', err)
  } finally {
    isLoading.value = false
  }
}
</script>
