import { ref } from 'vue'
import {
  Configuration,
  EventQueriesApi,
  ContractsApi,
  ChainsApi,
} from '@curvegrid/multibaas-sdk'
import { POOLS } from '@/config/pools'

/**
 * MultiBaas (Curvegrid) data layer.
 *
 * Everything on-chain the dashboard shows comes through the MultiBaas REST API via the
 * official SDK:
 *   - EventQueriesApi.countEventQueryRecords     -> cheap "anything new?" probe (1 call per poll)
 *   - EventQueriesApi.executeEventQuery          -> the saved `swap_events` query, fetched incrementally
 *   - EventQueriesApi.executeArbitraryEventQuery -> server-side aggregates per pool (last price, net flow)
 *   - ContractsApi.callContractFunction          -> live slot0() / liquidity() reads on a pool
 *   - ContractsApi.getEventIndexingStatus        -> "indexed to block N" per pool
 *   - ChainsApi.getChainStatus                   -> chain head + base fee
 *
 * Request budget rules (see DashboardView for the scheduler):
 *   - A poll is one count request. Rows are only fetched when the count moved, and only the
 *     rows past what we already hold (the saved query returns rows in ascending block order
 *     with stable offsets, verified against the deployment).
 *   - Pool state and aggregates only change when a swap lands, so they are refreshed for the
 *     pools that received new swaps, never on a timer.
 *   - Every request is counted in `apiCalls` so the budget is visible in the UI.
 *
 * In dev, calls go through the Vite proxy (/multibaas-api) to avoid CORS.
 */

const MULTIBAAS_URL_RAW = (import.meta.env.VITE_MULTIBAAS_URL || '').replace(/\/+$/, '')
const API_KEY = import.meta.env.VITE_MULTIBAAS_API_KEY || ''
// Optional: a same-origin proxy that injects the API key server-side (see api/multibaas.js
// for the Vercel version). It avoids CORS and keeps the key out of the bundle. Enabled by default
// in production builds; set VITE_MULTIBAAS_PROXY=false to call the deployment directly instead.
const USE_PROXY = import.meta.env.DEV
  ? false
  : (import.meta.env.VITE_MULTIBAAS_PROXY ?? 'true') !== 'false'
const PROXY_PATH = import.meta.env.DEV
  ? `${window.location.origin}/multibaas-api/api/v0`
  : `${window.location.origin}/api/multibaas/api/v0`
const DIRECT_PATH = `${MULTIBAAS_URL_RAW}/api/v0`

const SWAP_SIGNATURE = 'Swap(address,address,int256,int256,uint160,uint128,int24)'
const PAGE_SIZE = 50   // MultiBaas rejects event query pages larger than this
const MAX_ROWS = 200   // rows kept in memory / drawn
const canDirect = Boolean(MULTIBAAS_URL_RAW && API_KEY)
const configured = USE_PROXY || canDirect

// The SDK clients are rebuilt if the proxy turns out to be missing (a 404 from the platform
// rather than from MultiBaas) and the bundle also carries direct credentials.
// In dev the Vite proxy is always used (it forwards the key the client sends).
let mode = USE_PROXY || import.meta.env.DEV ? 'proxy' : 'direct'
let apis = makeApis(mode)
function makeApis(m) {
  const cfg = new Configuration({
    basePath: m === 'proxy' ? PROXY_PATH : DIRECT_PATH,
    accessToken: m === 'proxy' && !import.meta.env.DEV ? undefined : API_KEY,
  })
  return { eventQueries: new EventQueriesApi(cfg), contracts: new ContractsApi(cfg), chains: new ChainsApi(cfg) }
}
async function call(fn) {
  try {
    return await fn(apis)
  } catch (err) {
    const status = err?.response?.status
    const platform404 = status === 404 && typeof err?.response?.data === 'string'
    if (mode === 'proxy' && platform404 && canDirect) {
      console.warn('MultiBaas proxy is not deployed; calling the deployment directly (add the site origin under MultiBaas Admin > CORS).')
      mode = 'direct'
      apis = makeApis('direct')
      return fn(apis)
    }
    throw err
  }
}
const wrap = (api, methods) => Object.fromEntries(methods.map((m) => [m, (...args) => call((a) => a[api][m](...args))]))
const eventQueries = wrap('eventQueries', ['executeEventQuery', 'countEventQueryRecords', 'executeArbitraryEventQuery'])
const contracts = wrap('contracts', ['callContractFunction', 'getEventIndexingStatus'])
const chains = wrap('chains', ['getChainStatus'])

// Shared reactive state (module-level so every consumer sees the same values)
const isLive = ref(false)
const loading = ref(false)
const error = ref(null)
const chainStatus = ref(null)      // { blockNumber, chainID, baseFee }
const totalSwaps = ref(0)          // all-time count from MultiBaas
const swaps = ref([])              // parsed rows, oldest first, at most MAX_ROWS
const lastFetchedAt = ref(null)
const apiCalls = ref(0)            // MultiBaas requests made this session
let indexedCount = -1              // how many rows of the saved query we have accounted for
let demoLoaded = false

function tracked(promise) {
  apiCalls.value++
  return promise
}

export function useMultiBaas() {
  /**
   * Bring `swaps` up to date with the saved `swap_events` query using the fewest requests:
   * one count call, then only the rows we have not seen. Returns the newly added rows.
   */
  async function syncSwaps() {
    if (!configured) {
      isLive.value = false
      if (!demoLoaded) { swaps.value = getDummySwaps(); demoLoaded = true }
      return { added: [], changed: !swaps.value.length }
    }

    loading.value = true
    error.value = null
    try {
      const countRes = await tracked(eventQueries.countEventQueryRecords('swap_events'))
      const count = Number(countRes.data.result) || 0
      isLive.value = true
      lastFetchedAt.value = Date.now()
      totalSwaps.value = count

      if (count === indexedCount) return { added: [], changed: false }

      if (indexedCount < 0 || count < indexedCount) {
        // First load, or the index shrank (reorg / re-sync): take the newest MAX_ROWS.
        const start = Math.max(0, count - MAX_ROWS)
        const rows = await fetchRange(start, count - start)
        swaps.value = rows
        indexedCount = start + rows.length
        return { added: [], changed: true, initial: true }
      }

      const rows = await fetchRange(indexedCount, count - indexedCount)
      const known = new Set(swaps.value.map((s) => s.id))
      const added = rows.filter((r) => !known.has(r.id))
      swaps.value = [...swaps.value, ...added].slice(-MAX_ROWS)
      // If the results lagged the count, only advance by what actually arrived so the rest is
      // picked up on the next poll instead of being skipped.
      indexedCount += rows.length
      return { added, changed: added.length > 0 }
    } catch (err) {
      console.error('MultiBaas sync failed:', err)
      error.value = err?.response?.data?.message || err.message
      isLive.value = false
      if (!swaps.value.length && !demoLoaded) { swaps.value = getDummySwaps(); demoLoaded = true }
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Fetch `n` rows from `offset` as parallel 50-row pages, parsed and in chain order. */
  async function fetchRange(offset, n) {
    if (n <= 0) return []
    const pages = Math.ceil(n / PAGE_SIZE)
    const res = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        tracked(eventQueries.executeEventQuery('swap_events', offset + i * PAGE_SIZE, Math.min(PAGE_SIZE, n - i * PAGE_SIZE))),
      ),
    )
    return res.flatMap((r) => r.data.result?.rows || []).map(parseRow).sort(byChainOrder)
  }

  /**
   * Server-side aggregates per pool computed by MultiBaas (no client-side reduce):
   * last price, block range, net token flows, tick range. One request for all pools.
   */
  async function fetchPoolAggregates() {
    if (!configured) return demoAggregates()
    try {
      const query = {
        events: [{
          eventName: SWAP_SIGNATURE,
          select: [
            { type: 'contract_address', name: 'contract_address' },
            { type: 'input', inputIndex: 2, name: 'amount0', alias: 'net_amount0', aggregator: 'add' },
            { type: 'input', inputIndex: 3, name: 'amount1', alias: 'net_amount1', aggregator: 'add' },
            { type: 'input', inputIndex: 4, name: 'sqrtPriceX96', alias: 'last_sqrt_price', aggregator: 'last' },
            { type: 'input', inputIndex: 6, name: 'tick', alias: 'min_tick', aggregator: 'min' },
            { type: 'input', inputIndex: 6, name: 'tick', alias: 'max_tick', aggregator: 'max' },
            { type: 'block_number', name: 'block_number', alias: 'first_block', aggregator: 'min' },
            { type: 'block_number', name: 'block_number', alias: 'last_block', aggregator: 'max' },
          ],
        }],
        groupBy: 'contract_address',
      }
      const res = await tracked(eventQueries.executeArbitraryEventQuery(query, 0, 50))
      const out = {}
      for (const row of res.data.result?.rows || []) {
        out[(row.contract_address || '').toLowerCase()] = {
          netAmount0: row.net_amount0,
          netAmount1: row.net_amount1,
          lastSqrtPrice: row.last_sqrt_price,
          minTick: Number(row.min_tick),
          maxTick: Number(row.max_tick),
          firstBlock: Number(row.first_block),
          lastBlock: Number(row.last_block),
        }
      }
      return out
    } catch (err) {
      console.warn('MultiBaas aggregate query failed:', err?.message)
      return null
    }
  }

  /**
   * Live pool state via MultiBaas contract calls: slot0() and liquidity(), plus the indexer
   * status when `withStatus` is set. Three requests per pool, so callers pass only the pools
   * that actually changed.
   */
  async function fetchPoolState(pool, { withStatus = true } = {}) {
    if (!configured) return demoPoolState(pool)
    try {
      const [slot0, liq, status] = await Promise.all([
        tracked(contracts.callContractFunction(pool.address, pool.label, 'slot0', { args: [] })),
        tracked(contracts.callContractFunction(pool.address, pool.label, 'liquidity', { args: [] })),
        withStatus ? tracked(contracts.getEventIndexingStatus(pool.address, pool.label)).catch(() => null) : null,
      ])
      const s = slot0.data.result?.output || []
      return {
        sqrtPriceX96: String(s[0] ?? '0'),
        tick: Number(s[1] ?? 0),
        unlocked: Boolean(s[6]),
        liquidity: String(liq.data.result?.output ?? '0'),
        indexedToBlock: status?.data.result?.latestBlockNumber ?? null,
        startBlock: status?.data.result?.startBlockNumber ?? null,
        isProcessingPastLogs: status?.data.result?.isProcessingPastLogs ?? false,
        fetchedAt: Date.now(),
      }
    } catch (err) {
      console.warn(`MultiBaas contract call failed for ${pool.alias}:`, err?.message)
      return null
    }
  }

  async function fetchChainStatus() {
    if (!configured) {
      chainStatus.value = { blockNumber: 11784934, chainID: 11155111, baseFee: '943385830', demo: true }
      return chainStatus.value
    }
    try {
      const res = await tracked(chains.getChainStatus())
      chainStatus.value = res.data.result
      return chainStatus.value
    } catch (err) {
      console.warn('MultiBaas chain status failed:', err?.message)
      return null
    }
  }

  return {
    configured,
    isLive,
    loading,
    error,
    chainStatus,
    totalSwaps,
    swaps,
    lastFetchedAt,
    apiCalls,
    syncSwaps,
    fetchPoolAggregates,
    fetchPoolState,
    fetchChainStatus,
  }
}

function byChainOrder(a, b) {
  return a.blockNumber - b.blockNumber || a.timestamp - b.timestamp
}

function parseRow(row) {
  const triggeredAt = row.triggered_at || ''
  return {
    id: row.tx_hash
      ? `${row.tx_hash}-${row.contract_address}-${row.amount0}`
      : `${row.block_number}-${Math.random()}`,
    sender: (row.sender || '').toLowerCase(),
    recipient: (row.recipient || '').toLowerCase(),
    txFrom: (row.tx_from || '').toLowerCase(),
    amount0: row.amount0 ?? '0',
    amount1: row.amount1 ?? '0',
    sqrtPriceX96: row.sqrtPriceX96 || row.sqrt_price_x96 || '0',
    liquidity: row.liquidity || '0',
    tick: Number(row.tick) || 0,
    blockNumber: Number(row.block_number) || 0,
    txHash: row.tx_hash || '',
    contractAddress: (row.contract_address || '').toLowerCase(),
    timestamp: triggeredAt
      ? Math.floor(new Date(triggeredAt.replace(' ', 'T').replace(/\+00$/, 'Z')).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
  }
}

// ---------------------------------------------------------------------------
// Demo data: used only when MultiBaas is not configured or unreachable.
// Prices come from real Sepolia slot0 reads so charts look plausible.
// ---------------------------------------------------------------------------

const DEMO_TRADERS = [
  '0x76ef10b9a1edb5703fbf6eb340787661cae8feb9',
  '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  '0xab5801a7d398351b8be11c439e05c5b3259aec9b',
  '0x1234567890abcdef1234567890abcdef12345678',
  '0xfedcba9876543210fedcba9876543210fedcba98',
]
const ROUTER = '0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e'

// Demo prices derived from pool metadata so any pool loaded from ENS gets a plausible series.
function demoPrice(pool) {
  return pool.quote.symbol === 'USDC' ? (pool.base.symbol === 'WETH' ? 31400 : 553000) : 15.6
}
function demoSqrt(pool) {
  const token1PerToken0 = pool.base === pool.token0 ? demoPrice(pool) : 1 / demoPrice(pool)
  return BigInt(Math.round(Math.sqrt(token1PerToken0 / 10 ** (pool.token0.decimals - pool.token1.decimals)) * 2 ** 96))
}
function demoTick(pool) {
  return Math.round(Math.log((Number(demoSqrt(pool)) / 2 ** 96) ** 2) / Math.log(1.0001))
}

function seeded(i) {
  const x = Math.sin(i * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

function getDummySwaps() {
  const now = Math.floor(Date.now() / 1000)
  const n = 36
  if (!POOLS.length) return []
  const drift = Object.fromEntries(POOLS.map((p) => [p.address, 0]))
  const out = []
  for (let i = 0; i < n; i++) {
    const pool = POOLS[Math.floor(seeded(i) * POOLS.length)]
    const trader = DEMO_TRADERS[Math.floor(seeded(i + 100) * DEMO_TRADERS.length)]
    const sell = seeded(i + 200) > 0.5
    const size = 0.5 + seeded(i + 300) * 2
    drift[pool.address] += (sell ? 1 : -1) * size * 0.0006
    const sqrt = demoSqrt(pool) * BigInt(Math.round((1 + drift[pool.address]) * 1e6)) / 1000000n

    const baseAmount = (pool.base.symbol === 'WETH' ? 0.001 : 0.00006) * size
    const quoteAmount = baseAmount * demoPrice(pool)
    const baseIsToken0 = pool.base === pool.token0
    const amount0 = BigInt(Math.round((baseIsToken0 ? baseAmount : quoteAmount) * 10 ** pool.token0.decimals)) * ((baseIsToken0 === sell) ? 1n : -1n)
    const amount1 = BigInt(Math.round((baseIsToken0 ? quoteAmount : baseAmount) * 10 ** pool.token1.decimals)) * ((baseIsToken0 === sell) ? -1n : 1n)

    out.push({
      id: `demo-${i}`,
      sender: ROUTER,
      recipient: trader,
      txFrom: trader,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      sqrtPriceX96: sqrt.toString(),
      liquidity: '12261438416671504',
      tick: demoTick(pool) + Math.round(drift[pool.address] * 20000),
      blockNumber: 11784500 + i * 3,
      txHash: `0x${(i + 1).toString(16).padStart(64, 'a')}`,
      contractAddress: pool.address,
      timestamp: now - (n - i) * 40 - Math.floor(seeded(i + 400) * 20),
    })
  }
  return out
}

function demoAggregates() {
  const out = {}
  for (const p of POOLS) {
    out[p.address] = {
      netAmount0: '0',
      netAmount1: '0',
      lastSqrtPrice: demoSqrt(p).toString(),
      minTick: demoTick(p) - 40,
      maxTick: demoTick(p) + 40,
      firstBlock: 11784500,
      lastBlock: 11784608,
    }
  }
  return out
}

function demoPoolState(pool) {
  return {
    sqrtPriceX96: demoSqrt(pool).toString(),
    tick: demoTick(pool),
    unlocked: true,
    liquidity: '12261438416671504',
    indexedToBlock: 11784934,
    startBlock: 11784145,
    isProcessingPastLogs: false,
    fetchedAt: Date.now(),
    demo: true,
  }
}
