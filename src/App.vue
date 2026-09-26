<template>
  <div class="min-h-screen bg-surface-900">
    <!-- Top Nav -->
    <header class="border-b border-surface-700 px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold tracking-tight">
          <span class="text-accent-blue">Name</span><span class="text-white">Flow</span>
        </h1>
        <span class="text-xs text-surface-600 font-mono mt-1">SEPOLIA</span>
      </div>

      <div class="flex items-center gap-4">
        <!-- Live indicator -->
        <div class="flex items-center gap-2 text-sm text-gray-400">
          <span class="live-dot w-2 h-2 rounded-full bg-accent-green inline-block"></span>
          Live
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
</script>
