<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        @mousedown.self="close"
      >
        <div
          class="w-full max-w-lg bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-pool-title"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-surface-700">
            <div>
              <h2 id="add-pool-title" class="text-base font-semibold text-gray-100">Add a pool to the watchlist</h2>
              <p class="text-[11px] text-gray-500">Registers a subname under {{ NAMEFLOW_NAMESPACE }} and publishes its records on ENSv2</p>
            </div>
            <button class="text-gray-500 hover:text-gray-200 text-lg leading-none px-1" aria-label="Close" @click="close">×</button>
          </div>

          <div class="px-5 py-4 space-y-4 overflow-y-auto trade-tape">
            <!-- Step 1: wallet / permission -->
            <section class="space-y-2">
              <h3 class="text-[10px] uppercase tracking-wide text-gray-500">1 · Owner wallet</h3>
              <div class="rounded-lg bg-surface-900 px-3 py-2 text-xs">
                <div v-if="!account" class="flex items-center justify-between gap-2">
                  <span class="text-gray-400">{{ hasWallet ? 'Connect the wallet that owns the namespace' : 'No browser wallet detected (install MetaMask)' }}</span>
                  <button
                    class="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 shrink-0"
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
                    >{{ isOwner ? 'NAMESPACE OWNER' : 'NO ACCESS' }}</span>
                  </div>
                  <p class="text-[10px] text-gray-500 mt-1">
                    ENSv2 access control: only the owner of {{ NAMEFLOW_NAMESPACE }} can register subnames and edit its records.
                    <span v-if="ownerAddress && !isOwner">The owner is {{ truncateAddr(ownerAddress) }}.</span>
                  </p>
                </template>
              </div>
            </section>

            <!-- Step 2: pool -->
            <section class="space-y-2">
              <h3 class="text-[10px] uppercase tracking-wide text-gray-500">2 · Uniswap V3 pool</h3>
              <div class="flex gap-2">
                <input
                  v-model.trim="poolAddress"
                  type="text"
                  placeholder="Pool contract address 0x…"
                  spellcheck="false"
                  class="flex-1 min-w-0 bg-surface-900 border border-surface-600 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-accent-blue"
                  @keydown.enter="onInspect"
                />
                <button
                  class="px-3 py-1.5 text-xs rounded-md bg-surface-700 hover:bg-surface-600 text-gray-200 disabled:opacity-50 shrink-0"
                  :disabled="busy || !poolAddress"
                  @click="onInspect"
                >{{ status === 'inspecting' ? 'Reading…' : 'Inspect' }}</button>
              </div>
            </section>

            <!-- Step 3: identity -->
            <section v-if="draft" class="space-y-3">
              <h3 class="text-[10px] uppercase tracking-wide text-gray-500">3 · ENS identity</h3>
              <div class="rounded-lg bg-surface-900 px-3 py-3 space-y-3 text-xs">
                <div class="flex items-center gap-3">
                  <img
                    v-if="avatarPreview"
                    :src="avatarPreview"
                    alt=""
                    class="w-12 h-12 rounded-full object-cover bg-surface-700 shrink-0"
                    @error="avatarBroken = true"
                    @load="avatarBroken = false"
                  />
                  <div v-else class="w-12 h-12 rounded-full shrink-0" :style="{ background: draft.color }" />
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-gray-100 truncate">{{ draft.name || '—' }}</div>
                    <div class="text-[11px] text-gray-400 truncate">{{ draft.label || '…' }}.{{ NAMEFLOW_NAMESPACE }}</div>
                    <div class="text-[10px] text-gray-500">
                      {{ draft.token0.symbol }} / {{ draft.token1.symbol }} · {{ draft.fee / 10000 }}% fee · priced as {{ draft.quote.symbol }} per {{ draft.base.symbol }}
                      <button class="text-accent-blue hover:underline ml-1" @click="flipQuote">flip</button>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
                  <label class="text-[10px] uppercase tracking-wide text-gray-500">Subname</label>
                  <div class="flex items-center gap-1 min-w-0">
                    <input
                      v-model.trim="draft.label"
                      class="flex-1 min-w-0 bg-surface-800 border border-surface-600 rounded-md px-2 py-1 font-mono focus:outline-none focus:border-accent-blue"
                      spellcheck="false"
                      @input="syncLabel"
                    />
                    <span class="text-gray-500 shrink-0">.{{ NAMEFLOW_NAMESPACE }}</span>
                  </div>

                  <label class="text-[10px] uppercase tracking-wide text-gray-500">Display name</label>
                  <input v-model.trim="draft.name" class="bg-surface-800 border border-surface-600 rounded-md px-2 py-1 focus:outline-none focus:border-accent-blue" />

                  <label class="text-[10px] uppercase tracking-wide text-gray-500">Avatar URL</label>
                  <div class="min-w-0">
                    <input
                      v-model.trim="draft.avatar"
                      type="url"
                      placeholder="https://… (optional, stored in the ENS avatar record)"
                      spellcheck="false"
                      class="w-full bg-surface-800 border rounded-md px-2 py-1 focus:outline-none focus:border-accent-blue"
                      :class="avatarError ? 'border-accent-red/60' : 'border-surface-600'"
                    />
                    <p v-if="avatarError" class="text-[10px] text-accent-red mt-0.5">{{ avatarError }}</p>
                    <p v-else class="text-[10px] text-gray-600 mt-0.5">Public HTTPS image link. Leave empty to use the generated pair icon.</p>
                  </div>

                  <label class="text-[10px] uppercase tracking-wide text-gray-500">Colour</label>
                  <div class="flex items-center gap-2">
                    <input v-model="draft.color" type="color" class="w-8 h-7 bg-transparent border-0 p-0 cursor-pointer" />
                    <code class="text-gray-400">{{ draft.color }}</code>
                  </div>
                </div>
              </div>
            </section>

            <div v-if="logs.length" class="max-h-32 overflow-y-auto space-y-0.5 trade-tape rounded-lg bg-surface-900 px-3 py-2">
              <div
                v-for="(entry, i) in logs"
                :key="i"
                class="text-[10px] font-mono"
                :class="entry.level === 'error' ? 'text-red-400' : 'text-gray-500'"
              >{{ entry.msg }}</div>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between gap-2 px-5 py-3 border-t border-surface-700">
            <span class="text-[10px] text-gray-500">
              {{ status === 'done' ? 'Published. The watchlist reloads from ENS.' : 'Two transactions at most: register, then a resolver multicall.' }}
            </span>
            <div class="flex gap-2">
              <button class="px-3 py-1.5 text-xs rounded-md text-gray-400 hover:text-gray-200" @click="close">Cancel</button>
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                :class="canPublish ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-surface-700 text-gray-500 cursor-not-allowed'"
                :disabled="!canPublish"
                @click="onPublish"
              >{{ status === 'publishing' ? 'Publishing… confirm in wallet' : 'Register & publish' }}</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useEnsAdmin } from '@/composables/useEnsAdmin'
import { NAMEFLOW_NAMESPACE } from '@/config/ens'
import { truncateAddr } from '@/config/pools'

const props = defineProps({
  open: { type: Boolean, default: false },
  pools: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'added'])

const {
  hasWallet, account, isOwner, ownerAddress, status, busy, logs, draft,
  connect, inspectPool, publishPool, reset,
} = useEnsAdmin()

const poolAddress = ref('')
const avatarBroken = ref(false)

const avatarError = computed(() => {
  const url = draft.value?.avatar
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return 'Avatar must be an https:// URL'
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return 'Avatar must be publicly reachable, not localhost'
    return avatarBroken.value ? 'Image could not be loaded from that URL' : ''
  } catch {
    return 'Not a valid URL'
  }
})
const avatarPreview = computed(() => (draft.value?.avatar && !avatarError.value.startsWith('Not') && !avatarError.value.startsWith('Avatar') ? draft.value.avatar : ''))

const canPublish = computed(() =>
  isOwner.value && !busy.value && draft.value && /^[a-z0-9-]{1,40}$/.test(draft.value.label) && draft.value.name.length > 0 && !avatarError.value,
)

watch(() => draft.value?.avatar, () => { avatarBroken.value = false })

function close() {
  if (status.value === 'publishing') return
  emit('close')
}

async function onInspect() {
  await inspectPool(poolAddress.value, props.pools)
}

function syncLabel() {
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
    reset()
    emit('close')
  }
}

function onKey(e) {
  if (e.key === 'Escape' && props.open) close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.15s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
