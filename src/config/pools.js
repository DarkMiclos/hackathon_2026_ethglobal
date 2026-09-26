import { shallowReactive } from 'vue'

// Pool definitions are loaded from ENS at startup; objects retain token identity.
export const POOLS = shallowReactive([])
export function setPools(pools) { POOLS.splice(0, POOLS.length, ...pools) }

export const ALL_POOLS = { name: 'All Pools', address: '', fee: 0, color: '#94a3b8' }

export function getPool(address) {
  return POOLS.find(p => p.address === (address || '').toLowerCase()) || null
}

/**
 * Decode Uniswap V3 sqrtPriceX96 into "quote per base" for a pool.
 * raw = (sqrtP / 2^96)^2 = token1 raw units per token0 raw unit.
 */
export function decodePrice(sqrtPriceX96, pool) {
  if (!pool || !sqrtPriceX96) return null
  let sqrt
  try {
    sqrt = Number(BigInt(sqrtPriceX96)) / 2 ** 96
  } catch {
    return null
  }
  if (!Number.isFinite(sqrt) || sqrt <= 0) return null
  const raw = sqrt * sqrt
  const token1PerToken0 = raw * 10 ** (pool.token0.decimals - pool.token1.decimals)
  return pool.base === pool.token0 ? token1PerToken0 : 1 / token1PerToken0
}

/**
 * Normalize a raw MultiBaas swap row into human units.
 * Amounts follow Uniswap sign convention: positive = token sent INTO the pool by the trader.
 */
export function enrichSwap(swap) {
  const pool = getPool(swap.contractAddress)
  if (!pool) return { ...swap, pool: null }

  const amount0 = Number(swap.amount0) / 10 ** pool.token0.decimals
  const amount1 = Number(swap.amount1) / 10 ** pool.token1.decimals
  const baseAmount = pool.base === pool.token0 ? amount0 : amount1
  const quoteAmount = pool.base === pool.token0 ? amount1 : amount0
  const side = baseAmount > 0 ? 'sell' : 'buy' // trader sold base if base went into the pool

  const tokenIn = amount0 > 0 ? pool.token0 : pool.token1
  const tokenOut = amount0 > 0 ? pool.token1 : pool.token0
  const amountIn = Math.abs(amount0 > 0 ? amount0 : amount1)
  const amountOut = Math.abs(amount0 > 0 ? amount1 : amount0)

  return {
    ...swap,
    pool,
    trader: (swap.recipient || swap.txFrom || '').toLowerCase(),
    price: decodePrice(swap.sqrtPriceX96, pool),
    baseAmount: Math.abs(baseAmount),
    quoteAmount: Math.abs(quoteAmount),
    side,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
  }
}

/**
 * Value a swap in USDC so volume can be compared across pools.
 * ethUsdc is the latest WETH/USDC price (from slot0 or the last swap).
 */
export function swapValueUsdc(swap, ethUsdc) {
  if (!swap.pool) return 0
  const { pool } = swap
  if (pool.quote.symbol === 'USDC') return swap.quoteAmount
  if (pool.token0.symbol === 'USDC' || pool.token1.symbol === 'USDC') {
    return Math.abs(pool.token0.symbol === 'USDC' ? swap.amount0 / 1e6 : swap.amount1 / 1e6)
  }
  // WETH / UNI: value the WETH leg
  const wethAmount = pool.token1.symbol === 'WETH'
    ? Math.abs(Number(swap.amount1) / 1e18)
    : Math.abs(Number(swap.amount0) / 1e18)
  return wethAmount * (ethUsdc || 0)
}

export function formatAmount(n, digits) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits ?? 1)}K`
  if (abs >= 1) return n.toFixed(digits ?? 2)
  if (abs >= 0.001) return n.toFixed(digits ?? 4)
  if (abs === 0) return '0'
  return n.toPrecision(3)
}

export function truncateAddr(addr) {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
