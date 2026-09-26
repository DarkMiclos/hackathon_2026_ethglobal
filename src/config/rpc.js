import { http, fallback } from 'viem'

/**
 * Shared Sepolia transport for every viem client in the app.
 *
 * - `VITE_SEPOLIA_RPC_URL` (if set) is tried first, then public endpoints in order. viem's
 *   fallback transport moves to the next URL on errors such as HTTP 429 rate limits.
 * - JSON-RPC requests issued in the same tick are batched into one HTTP request, and
 *   clients created with `clientBatch` additionally fold `eth_call`s into a single
 *   multicall3 call. ENS resolution and wallet inspection go from dozens of requests to a
 *   handful, which is what keeps the public RPCs from throttling the demo.
 */

const PUBLIC_RPCS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
  'https://rpc.sepolia.org',
]

export const RPC_URLS = [import.meta.env.VITE_SEPOLIA_RPC_URL, ...PUBLIC_RPCS].filter(Boolean)

export function sepoliaTransport(overrides = {}) {
  return fallback(
    RPC_URLS.map((url) => http(url, {
      batch: { batchSize: 20, wait: 16 },
      timeout: 15000,
      retryCount: 1,
      retryDelay: 1200,
      ...overrides,
    })),
    { rank: false },
  )
}

/** `createPublicClient({ ...clientBatch })` folds concurrent eth_calls into one multicall3 request. */
export const clientBatch = { batch: { multicall: { wait: 16 } } }
