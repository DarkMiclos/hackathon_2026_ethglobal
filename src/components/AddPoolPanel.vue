<template>
  <div class="bg-surface-800 rounded-xl p-4">
    <button
      v-if="!open"
      class="w-full py-2 px-4 bg-surface-700 hover:bg-surface-600 text-gray-200 text-sm font-medium rounded-lg transition-colors"
      @click="open = true"
    >
      Add pool via ENS
    </button>

    <div v-else class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-gray-300">Add pool · {{ NAMEFLOW_NAMESPACE }}</h3>
        <button class="text-gray-500 hover:text-gray-300 text-xs" @click="open = false">Close</button>
      </div>

      <!-- Wallet / permission -->
      <div class="rounded-lg bg-surface-900 px-2 py-2 text-xs space-y-1">
        <div v-if="!account" class="flex items-center justify-between gap-2">
          <span class="text-gray-500">{{ hasWallet ? 'Connect the namespace owner wallet' : 'No browser wallet detected' }}</span>
          <button
            class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            :disabled="!hasWallet || busy"
            @click="connect"
          >{{ status === 'connecting' ? 'Connecting…' : 'Connect' }}</button>
        </div>
        <template v-else>
          <div class="flex items-center justify-between gap-2">
            <code class="text-gray-300 truncate">{{ account }}</code>
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
              :class="isOwner ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-red/15 text-accent-red'"
            >{{ isOwner ? 'OWNER' : 'NO ACCESS' }}</span>
          </div>
          <p class="text-[10px] text-gray-500">
            ENSv2 access control: only the owner of {{ NAMEFLOW_NAMESPACE }} can register subnames and edit its records.
            <span v-if="ownerAddress && !isOwner">Owner is {{ truncateAddr(ownerAddress) }}.</span>
          </p>
        </template>
      </div>

      <!-- Pool address -->
      <div class="space-y-1">
        <label class="text-[10px] text-gray-500 uppercase tracking-wide">Uniswap V3 pool address</label>
        <div class="flex gap-1">
          <input
            v-model.trim="poolAddress"
            type="text"
            placeholder="0x…"
            spellcheck="false"
            class="flex-1 min-w-0 bg-surface-900 border border-surface-600 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent-blue"
          />
          <button
            class="px-2 py-1 text-xs rounded bg-surface-700 hover:bg-surface-600 text-gray-200 disabled:opacity-50 shrink-0"
            :disabled="busy || !poolAddress"
            @click="onInspect"
          >{{ status === 'inspecting' ? '…' : 'Inspect' }}</button>
        </div>
      </div>

      <!-- Draft -->
      <div v-if="draft" class="rounded-lg bg-surface-900 px-2 py-2 text-xs space-y-2">
        <div class="grid grid-cols-2 gap-x-2 gap-y-1">
          <label class="text-[10px] text-gray-500 uppercase tracking-wide col-span-2">Subname</label>
          <input v-model.trim="draft.label" class="col-span-2 bg-surface-800 border border-surface-600 rounded px-2 py-1 font-mono focus:outline-none focus:border-accent-blue" @input="syncName" />
          <span class="col-span-2 text-[10px] text-gray-500">{{ draft.label }}.{{ NAMEFLOW_NAMESPACE }} → {{ truncateAddr(draft.address) }}</span>

          <label class="text-[10px] text-gray-500 uppercase tracking-wide">Display name</label>
          <label class="text-[10px] text-gray-500 uppercase tracking-wide">Colour</label>
          <input v-model.trim="draft.name" class="bg-surface-800 border border-surface-600 rounded px-2 py-1 focus:outline-none focus:border-accent-blue" />
          <div class="flex items-center gap-1">
            <input v-model="draft.color" type="color" class="w-7 h-7 bg-transparent border-0 p-0 cursor-pointer" />
            <code class="text-gray-400">{{ draft.color }}</code>
          </div>
        </div>
        <div class="text-[10px] text-gray-400">
          {{ draft.token0.symbol }} / {{ draft.token1.symbol }} · {{ draft.fee / 10000 }}% fee · priced as {{ draft.quote.symbol }} per {{ draft.base.symbol }}
          <button class="text-accent-blue hover:underline ml-1" @click="flipQuote">flip</button>
        </div>
        <button
          class="w-full py-1.5 text-xs font-medium rounded-lg transition-colors"
          :class="canPublish ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-surface-700 text-gray-500 cursor-not-allowed'"
          :disabled="!canPublish"
          @click="onPublish"
        >
          {{ status === 'publishing' ? 'Publishing… confirm in wallet' : 'Register subname & publish records' }}
        </button>
      </div>

      <div v-if="logs.length" class="max-h-28 overflow-y-auto space-y-0.5 trade-tape">
        <div
          v-for="(entry, i) in logs"
          :key="i"
          class="text-[10px] font-mono"
          :class="entry.level === 'error' ? 'text-red-400' : 'text-gray-500'"
        >{{ entry.msg }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useEnsAdmin } from '@/composables/useEnsAdmin'
import { NAMEFLOW_NAMESPACE } from '@/config/ens'
import { truncateAddr } from '@/config/pools'

const props = defineProps({
  pools: { type: Array, default: () => [] },
})
const emit = defineEmits(['added'])

const {
  hasWallet, account, isOwner, ownerAddress, status, busy, logs, draft,
  connect, inspectPool, publishPool,
} = useEnsAdmin()

const open = ref(false)
const poolAddress = ref('')

const canPublish = computed(() =>
  isOwner.value && !busy.value && draft.value && /^[a-z0-9-]{1,40}$/.test(draft.value.label) && draft.value.name.length > 0,
)

async function onInspect() {
  await inspectPool(poolAddress.value, props.pools)
}

function syncName() {
  if (draft.value) draft.value.label = draft.value.label.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

function flipQuote() {
  const d = draft.value
  if (!d) return
  ;[d.base, d.quote] = [d.quote, d.base]
  d.name = `${d.base.symbol} / ${d.quote.symbol}`
  d.label = `${d.base.symbol}-${d.quote.symbol}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
  d.alias = `${d.label.replace(/-/g, '')}pool1`
}

async function onPublish() {
  const name = await publishPool(draft.value)
  if (name) {
    emit('added', name)
    poolAddress.value = ''
  }
}
</script>
