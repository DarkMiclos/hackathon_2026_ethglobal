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
  transport: http(),
  // If ENSv2 requires a custom resolver address on Sepolia, set it here:
  // universalResolverAddress: '0x...',
})

// Simple in-memory cache to avoid re-resolving during the same session
const nameCache = new Map()
const addressCache = new Map()

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

    try {
      const name = await client.getEnsName({ address })
      if (name) nameCache.set(lower, name)
      return name
    } catch {
      return null
    }
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
