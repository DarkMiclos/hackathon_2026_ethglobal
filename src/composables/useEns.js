import { createPublicClient, getAddress, isAddress, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'
import { normalize } from 'viem/ens'
import { reactive } from 'vue'
import { NAMEFLOW_NAMESPACE, DIRECTORY_KEY, POOL_METADATA_KEY, LOOKUP_KEY } from '@/config/ens'
import { sepoliaTransport, clientBatch } from '@/config/rpc'

// Fallback across several RPCs and multicall batching: a directory load or a trader lookup
// costs a couple of HTTP requests instead of dozens, which keeps public RPCs from returning 429.
const client = createPublicClient({ chain: sepolia, ...clientBatch, transport: sepoliaTransport() })
const cache = new Map()
const pending = new Map()
export const identityNames = reactive({})
const poolAbi = parseAbi(['function token0() view returns(address)', 'function token1() view returns(address)', 'function fee() view returns(uint24)'])

function cached(key, read) {
  const entry = cache.get(key)
  if (entry?.expires > Date.now()) return Promise.resolve(entry.value)
  if (pending.has(key)) return pending.get(key)
  const task = read().then(value => {
    cache.set(key, { value, expires: Date.now() + (value ? 300000 : 60000) })
    return value
  }).finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}

function scopedName(value) {
  if (typeof value !== 'string') throw Error('Invalid ENS name in directory')
  const name = normalize(value)
  if (!name.endsWith(`.${NAMEFLOW_NAMESPACE}`)) throw Error('Directory name is outside the NameFlow namespace')
  return name
}

async function readSequentially(entries, read) {
  const results = []
  for (const entry of entries) results.push(await read(entry))
  return results
}

export function useEns() {
  const resolveName = name => cached(`addr:${normalize(name)}`, () => client.getEnsAddress({ name: normalize(name) }))
  const getTextRecord = (name, key) => cached(`text:${normalize(name)}:${key}`, () => client.getEnsText({ name: normalize(name), key }))
  async function getAvatar(name) {
    try { return await cached(`avatar:${normalize(name)}`, () => client.getEnsAvatar({ name: normalize(name) })) }
    catch { return null }
  }
  async function resolveAddress(address) {
    if (!isAddress(address)) return null
    const target = getAddress(address)
    return cached(`name:${target.toLowerCase()}`, async () => {
      try {
        const candidate = await getTextRecord(`${target.slice(2).toLowerCase()}.lookup.${NAMEFLOW_NAMESPACE}`, LOOKUP_KEY)
        if (candidate) {
          const name = scopedName(candidate)
          if ((await resolveName(name))?.toLowerCase() === target.toLowerCase()) {
            identityNames[target.toLowerCase()] = name
            return name
          }
        }
      } catch { /* Fall back to a standard primary name. */ }
      try {
        const name = await client.getEnsName({ address: target })
        if (name && (await resolveName(name))?.toLowerCase() === target.toLowerCase()) {
          identityNames[target.toLowerCase()] = name
          return name
        }
      } catch { /* Preserve address labels during RPC failures. */ }
      return null
    })
  }

  async function loadDirectory() {
    const raw = await getTextRecord(NAMEFLOW_NAMESPACE, DIRECTORY_KEY)
    if (!raw) throw Error(`Missing ${DIRECTORY_KEY} text record on ${NAMEFLOW_NAMESPACE}`)
    const directory = JSON.parse(raw)
    if (directory.version !== 1 || directory.chainId !== sepolia.id || !Array.isArray(directory.pools) || !Array.isArray(directory.wallets)) throw Error('Unsupported ENS directory')
    if (directory.pools.length > 30 || directory.wallets.length > 100) throw Error('ENS directory is too large')
    const names = [...directory.pools, ...directory.wallets].map(scopedName)
    if (new Set(names).size !== names.length) throw Error('Duplicate ENS names in directory')
    const pools = await readSequentially(directory.pools, async entry => {
      const ensName = scopedName(entry)
      const [resolved, rawMetadata, avatar] = await Promise.all([resolveName(ensName), getTextRecord(ensName, POOL_METADATA_KEY), getAvatar(ensName)])
      if (!resolved || !rawMetadata) throw Error(`Missing pool records: ${ensName}`)
      const metadata = JSON.parse(rawMetadata)
      function token(value) {
        if (!value || !isAddress(value.address) || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 36 || !/^[A-Za-z0-9-]{1,16}$/.test(value.symbol)) throw Error(`Invalid token metadata: ${ensName}`)
        if (!/^#[0-9a-f]{6}$/i.test(value.color)) throw Error(`Invalid token color: ${ensName}`)
        return { ...value, address: value.address.toLowerCase() }
      }
      const token0 = token(metadata.token0), token1 = token(metadata.token1)
      if (!metadata.base || !metadata.quote || !Number.isInteger(metadata.fee) || !/^#[0-9a-f]{6}$/i.test(metadata.color) || typeof metadata.name !== 'string' || !/^[A-Za-z0-9 /._-]{1,80}$/.test(metadata.name) || !/^[a-z0-9_-]+$/i.test(metadata.alias) || !/^[a-z0-9_-]+$/i.test(metadata.label)) throw Error(`Invalid pool metadata: ${ensName}`)
      const base = [token0, token1].find(t => t.address === metadata.base.address?.toLowerCase())
      const quote = [token0, token1].find(t => t.address === metadata.quote.address?.toLowerCase())
      if (!base || !quote || base === quote) throw Error(`Invalid pair metadata: ${ensName}`)
      const [actual0, actual1, fee] = await Promise.all(['token0', 'token1', 'fee'].map(functionName => client.readContract({ address: resolved, abi: poolAbi, functionName })))
      if (actual0.toLowerCase() !== token0.address || actual1.toLowerCase() !== token1.address || fee !== metadata.fee) throw Error(`Pool contract does not match ENS metadata: ${ensName}`)
      const pool = { ...metadata, ensName, address: resolved.toLowerCase(), token0, token1, base, quote, avatar }
      identityNames[pool.address] = ensName
      return pool
    })
    const wallets = await readSequentially(directory.wallets, async entry => {
      const ensName = scopedName(entry), address = await resolveName(ensName)
      if (!address) throw Error(`Missing wallet address: ${ensName}`)
      identityNames[address.toLowerCase()] = ensName
      return { ensName, address }
    })
    if (new Set(pools.map(p => p.address)).size !== pools.length) throw Error('Duplicate pool addresses in ENS directory')
    return { pools, wallets }
  }

  return { resolveName, resolveAddress, getAvatar, getTextRecord, loadDirectory }
}
