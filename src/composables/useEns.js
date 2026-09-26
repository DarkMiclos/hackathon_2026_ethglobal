import { createPublicClient, http } from 'viem'
import { sepolia } from 'viem/chains'
import { normalize } from 'viem/ens'

/**
 * ENSv2 composable
 *
 * Uses viem's built-in ENS methods pointed at Sepolia.
 * ENSv2 contracts are deployed there (Universal Resolver V2).
 *
 * TODO: confirm the Sepolia Universal Resolver address for v2.
 * If needed, pass it as `universalResolverAddress` in the client config.
 */

const client = createPublicClient({
  chain: sepolia,
  transport: http(import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'),
  // If ENSv2 requires a custom resolver address on Sepolia, set it here:
  // universalResolverAddress: '0x...',
})

// Simple in-memory cache to avoid re-resolving during the same session.
// Misses are cached too (for NEGATIVE_TTL_MS) so an address without a name does not cost
// an RPC round-trip on every graph re-render.
const nameCache = new Map()
const addressCache = new Map()
const negativeCache = new Map() // lowercased address -> expiry timestamp
const inFlight = new Map()      // lowercased address -> pending promise
const NEGATIVE_TTL_MS = 10 * 60 * 1000

export function useEns() {
  /**
   * Forward resolve: ENS name → address
   */
  async function resolveName(name) {
    const normalized = normalize(name)
    if (addressCache.has(normalized)) return addressCache.get(normalized)

    const address = await client.getEnsAddress({ name: normalized })
    if (address) addressCache.set(normalized, address)
    return address
  }

  /**
   * Reverse resolve: address → ENS primary name
   */
  async function resolveAddress(address) {
    const lower = address.toLowerCase()
    if (nameCache.has(lower)) return nameCache.get(lower)
    const miss = negativeCache.get(lower)
    if (miss && miss > Date.now()) return null
    if (inFlight.has(lower)) return inFlight.get(lower)

    const p = client.getEnsName({ address })
      .then((name) => {
        if (name) nameCache.set(lower, name)
        else negativeCache.set(lower, Date.now() + NEGATIVE_TTL_MS)
        return name
      })
      .catch(() => {
        negativeCache.set(lower, Date.now() + NEGATIVE_TTL_MS)
        return null
      })
      .finally(() => inFlight.delete(lower))
    inFlight.set(lower, p)
    return p
  }

  /**
   * Get ENS avatar URL for a name
   */
  async function getAvatar(name) {
    try {
      const normalized = normalize(name)
      return await client.getEnsAvatar({ name: normalized })
    } catch {
      return null
    }
  }

  /**
   * Read arbitrary ENS text records (e.g. description, url, com.twitter)
   */
  async function getTextRecord(name, key) {
    try {
      const normalized = normalize(name)
      return await client.getEnsText({ name: normalized, key })
    } catch {
      return null
    }
  }

  return {
    resolveName,
    resolveAddress,
    getAvatar,
    getTextRecord,
  }
}
