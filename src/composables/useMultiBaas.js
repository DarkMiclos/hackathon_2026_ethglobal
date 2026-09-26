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
 *   - EventQueriesApi.executeEventQuery          -> the saved `swap_events` query (trade tape, charts)
 *   - EventQueriesApi.executeArbitraryEventQuery -> server-side aggregates per pool (last price, net flow)
 *   - EventQueriesApi.countEventQueryRecords     -> all-time swap count
 *   - ContractsApi.callContractFunction          -> live slot0() / liquidity() reads on each pool
 *   - ContractsApi.getEventIndexingStatus        -> "indexed to block N" per pool
 *   - ChainsApi.getChainStatus                   -> chain head + base fee
 *
 * In dev, calls go through the Vite proxy (/multibaas-api) to avoid CORS.
 */

const MULTIBAAS_URL_RAW = (import.meta.env.VITE_MULTIBAAS_URL || '').replace(/\/+$/, '')
const API_KEY = import.meta.env.VITE_MULTIBAAS_API_KEY || ''
const BASE_PATH = import.meta.env.DEV
  ? `${window.location.origin}/multibaas-api/api/v0`
  : `${MULTIBAAS_URL_RAW}/api/v0`

const SWAP_SIGNATURE = 'Swap(address,address,int256,int256,uint160,uint128,int24)'
const PAGE_SIZE = 50 // MultiBaas rejects event query pages larger than this
const configured = Boolean(MULTIBAAS_URL_RAW && API_KEY)

const config = new Configuration({ basePath: BASE_PATH, accessToken: API_KEY })
const eventQueries = new EventQueriesApi(config)
const contracts = new ContractsApi(config)
const chains = new ChainsApi(config)

// Shared reactive state (module-level so every consumer sees the same values)
const isLive = ref(false)
const loading = ref(false)
const error = ref(null)
const chainStatus = ref(null)      // { blockNumber, chainID, baseFee }
const totalSwaps = ref(0)          // all-time count from MultiBaas
const lastFetchedAt = ref(null)

export function useMultiBaas() {
  /**
   * Latest swaps from the saved `swap_events` event query, oldest first.
   * MultiBaas caps a single results page at 50 rows, so `limit` is fetched as parallel pages.
   */
  async function fetchSwaps({ limit = 200, offset = 0 } = {}) {
    if (!configured) {
      isLive.value = false
      return getDummySwaps()
    }

    loading.value = true
    error.value = null
    try {
      const pages = Math.max(1, Math.ceil(limit / PAGE_SIZE))
      const [countRes, ...pageRes] = await Promise.all([
        eventQueries.countEventQueryRecords('swap_events').catch(() => null),
        ...Array.from({ length: pages }, (_, i) =>
          eventQueries.executeEventQuery('swap_events', offset + i * PAGE_SIZE, PAGE_SIZE),
        ),
      ])
      const rows = pageRes.flatMap((res) => res.data.result?.rows || [])
      if (countRes) totalSwaps.value = Number(countRes.data.result) || rows.length
      isLive.value = true
      lastFetchedAt.value = Date.now()
      const seen = new Set()
      return rows
        .map(parseRow)
        .filter((s) => (seen.has(s.id) ? false : seen.add(s.id)))
        .sort(byChainOrder)
    } catch (err) {
      console.error('MultiBaas fetch failed, using demo data:', err)
      error.value = err?.response?.data?.message || err.message
      isLive.value = false
      return getDummySwaps()
    } finally {
      loading.value = false
    }
  }

  /**
   * Server-side aggregates per pool computed by MultiBaas (no client-side reduce):
   * last price, block range, net token flows, tick range.
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
      const res = await eventQueries.executeArbitraryEventQuery(query, 0, 50)
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
      return {}
    }
  }

  /** Live pool state via MultiBaas contract calls: slot0() and liquidity(). */
  async function fetchPoolState(pool) {
    if (!configured) return demoPoolState(pool)
    try {
      const [slot0, liq, status] = await Promise.all([
        contracts.callContractFunction(pool.alias, pool.label, 'slot0', { args: [] }),
        contracts.callContractFunction(pool.alias, pool.label, 'liquidity', { args: [] }),
        contracts.getEventIndexingStatus(pool.alias, pool.label).catch(() => null),
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
      const res = await chains.getChainStatus()
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
    lastFetchedAt,
    fetchSwaps,
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
function demoSqrt(pool) {
  const price = pool.quote.symbol === 'USDC' ? (pool.base.symbol === 'WETH' ? 31400 : 553000) : 15.6
  const token1PerToken0 = pool.base === pool.token0 ? price : 1 / price
  return BigInt(Math.round(Math.sqrt(token1PerToken0 / 10 ** (pool.token0.decimals - pool.token1.decimals)) * 2 ** 96))
}
function demoTick(pool) { return Math.round(Math.log((Number(demoSqrt(pool)) / 2 ** 96) ** 2) / Math.log(1.0001)) }

function seeded(i) {
  const x = Math.sin(i * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

function getDummySwaps() {
  const now = Math.floor(Date.now() / 1000)
  const n = 36
  if (!POOLS.length) return []
  const drift = Object.fromEntries(POOLS.map(p => [p.address, 0]))
  const swaps = []
  for (let i = 0; i < n; i++) {
    const pool = POOLS[Math.floor(seeded(i) * POOLS.length)]
    const trader = DEMO_TRADERS[Math.floor(seeded(i + 100) * DEMO_TRADERS.length)]
    const sell = seeded(i + 200) > 0.5
    const size = 0.5 + seeded(i + 300) * 2 // multiplier on a base trade size
    drift[pool.address] += (sell ? 1 : -1) * size * 0.0006
    const sqrt = demoSqrt(pool) * BigInt(Math.round((1 + drift[pool.address]) * 1e6)) / 1000000n

    const price = pool.quote.symbol === 'USDC' ? (pool.base.symbol === 'WETH' ? 31400 : 553000) : 15.6
    const baseAmount = (pool.base.symbol === 'WETH' ? 0.001 : 0.00006) * size
    const quoteAmount = baseAmount * price
    const baseIsToken0 = pool.base === pool.token0
    const amount0 = BigInt(Math.round((baseIsToken0 ? baseAmount : quoteAmount) * 10 ** pool.token0.decimals)) * ((baseIsToken0 === sell) ? 1n : -1n)
    const amount1 = BigInt(Math.round((baseIsToken0 ? quoteAmount : baseAmount) * 10 ** pool.token1.decimals)) * ((baseIsToken0 === sell) ? -1n : 1n)

    const ts = now - (n - i) * 40 - Math.floor(seeded(i + 400) * 20)
    swaps.push({
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
      timestamp: ts,
    })
  }
  return swaps
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
