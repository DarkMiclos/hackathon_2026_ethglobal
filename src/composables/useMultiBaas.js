import { ref } from 'vue'

const MULTIBAAS_URL_RAW = (import.meta.env.VITE_MULTIBAAS_URL || '').replace(/\/+$/, '')
const API_KEY = import.meta.env.VITE_MULTIBAAS_API_KEY || ''
// In dev, proxy through Vite to avoid CORS. In production, call MultiBaas directly.
const MULTIBAAS_URL = import.meta.env.DEV ? '/multibaas-api' : MULTIBAAS_URL_RAW

const isLive = ref(false)
const loading = ref(false)
const error = ref(null)

export function useMultiBaas() {
  async function fetchSwaps() {
    if (!MULTIBAAS_URL || !API_KEY) {
      console.warn('MultiBaas not configured — using dummy data. Set VITE_MULTIBAAS_URL and VITE_MULTIBAAS_API_KEY in .env')
      isLive.value = false
      return getDummySwaps()
    }

    loading.value = true
    error.value = null

    try {
      const res = await fetch(
        `${MULTIBAAS_URL}/api/v0/queries/swap_events/results?offset=0&limit=50`,
        { headers: { 'Authorization': `Bearer ${API_KEY}` } },
      )

      if (!res.ok) {
        throw new Error(`MultiBaas ${res.status}: ${await res.text()}`)
      }

      const data = await res.json()
      const rows = data.result?.rows || []
      const parsed = rows.map(parseRow)

      isLive.value = true
      return parsed
    } catch (err) {
      console.error('MultiBaas fetch failed, using dummy data:', err)
      error.value = err.message
      isLive.value = false
      return getDummySwaps()
    } finally {
      loading.value = false
    }
  }

  return { fetchSwaps, isLive, loading, error }
}

function parseRow(row) {
  const triggeredAt = row.triggered_at || ''

  return {
    sender: row.sender || '',
    recipient: row.recipient || '',
    amount0: Number(row.amount0) || 0,
    amount1: Number(row.amount1) || 0,
    sqrtPriceX96: row.sqrtPriceX96 || row.sqrt_price_x96 || '0',
    liquidity: row.liquidity || '0',
    tick: Number(row.tick) || 0,
    blockNumber: Number(row.block_number) || 0,
    txHash: row.tx_hash || '',
    contractAddress: (row.contract_address || '').toLowerCase(),
    timestamp: triggeredAt
      ? Math.floor(new Date(triggeredAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
  }
}

function getDummySwaps() {
  const addrs = [
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
    '0x1234567890abcdef1234567890abcdef12345678',
    '0xfedcba9876543210fedcba9876543210fedcba98',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ]

  const now = Math.floor(Date.now() / 1000)

  return Array.from({ length: 25 }, (_, i) => ({
    sender: addrs[i % addrs.length],
    recipient: addrs[(i + 2) % addrs.length],
    amount0: (Math.random() - 0.5) * 10,
    amount1: (Math.random() - 0.5) * 30000,
    sqrtPriceX96: '1461446703485210103287273052203988822378723970341',
    liquidity: '1000000000000000000',
    tick: -200000 + Math.floor(Math.random() * 400000),
    blockNumber: 6000000 + i,
    txHash: `0x${i.toString(16).padStart(64, '0')}`,
    contractAddress: '0x0000000000000000000000000000000000000000',
    timestamp: now - i * 15,
  }))
}
