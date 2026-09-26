import { ref, computed } from 'vue'
import {
  createPublicClient, createWalletClient, custom, http, parseAbi, toHex, keccak256,
  zeroAddress, encodeFunctionData, getAddress, isAddress,
} from 'viem'
import { packetToBytes, normalize } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { AddressesApi, ContractsApi, Configuration } from '@curvegrid/multibaas-sdk'
import { NAMEFLOW_NAMESPACE, DIRECTORY_KEY, POOL_METADATA_KEY } from '@/config/ens'

/**
 * ENSv2 write path for the pool watchlist, driven by the user's browser wallet.
 *
 * Mirrors scripts/register-ens-wallets.mjs and scripts/publish-ens-directory.mjs, but for a
 * single pool subname directly under nameflow.eth:
 *   1. register <label>.nameflow.eth in the namespace's ENSv2 registry (if missing)
 *   2. resolver multicall: address record, nameflow:pool metadata, updated nameflow:directory
 *   3. best-effort: link the pool address in MultiBaas so slot0/liquidity reads work
 *
 * Only an account that owns nameflow.eth can do this; that check is the visible piece of
 * ENSv2 access control. Every write is simulated first, so a wallet never signs a reverting tx.
 */

const RPC = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const HELPER = '0x33f571aa8a160a21b877cf6e0fb8806692b97df5'
const UNIVERSAL_RESOLVER = sepolia.contracts.ensUniversalResolver.address

const navAbi = parseAbi([
  'function findParentRegistry(bytes name) view returns(address)',
  'function findExactOwner(bytes name) view returns(address)',
  'function findResolver(bytes name) view returns(address,bytes32,uint256)',
])
const registryAbi = parseAbi([
  'function getSubregistry(string label) view returns(address)',
  'function getResolver(string label) view returns(address)',
  'function getExpiry(uint256 anyId) view returns(uint64)',
  'function findOwner(string label) view returns(address)',
  'function getStatus(uint256 anyId) view returns(uint8)',
  'function register(string label,address owner,address registry,address resolver,uint256 roleBitmap,uint64 expiry) returns(uint256)',
])
const resolverAbi = parseAbi([
  'function setAddress(bytes name,uint256 coinType,bytes addressBytes)',
  'function setText(bytes name,string key,string value)',
  'function multicall(bytes[] calls) returns(bytes[])',
])
const poolAbi = parseAbi([
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function fee() view returns(uint24)',
])
const erc20Abi = parseAbi([
  'function symbol() view returns(string)',
  'function decimals() view returns(uint8)',
])

// Same role bitmap the registration script grants: regular roles + admin mirror + a flag bit.
const REGULAR = 1n | (1n << 8n) | (1n << 16n) | (1n << 20n) | (1n << 24n)
const ROLES = REGULAR | (REGULAR << 128n) | (1n << 156n)

const dns = (name) => toHex(packetToBytes(normalize(name)))
const labelId = (label) => BigInt(keccak256(toHex(label)))

const TOKEN_COLORS = { WETH: '#3b82f6', USDC: '#10b981', UNI: '#ec4899', DAI: '#f59e0b', WBTC: '#f97316', LINK: '#2563eb' }
const POOL_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#eab308', '#14b8a6', '#a855f7']

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 15000, retryCount: 2 }) })

const account = ref('')
const isOwner = ref(false)
const ownerAddress = ref('')
const status = ref('idle') // idle | connecting | inspecting | publishing | error | done
const logs = ref([])
const draft = ref(null)

export function useEnsAdmin() {
  const hasWallet = typeof window !== 'undefined' && Boolean(window.ethereum)
  const busy = computed(() => ['connecting', 'inspecting', 'publishing'].includes(status.value))

  function log(msg, level = 'info') {
    logs.value = [...logs.value.slice(-60), { time: Date.now(), msg, level }]
  }

  function walletClient() {
    return createWalletClient({ account: getAddress(account.value), chain: sepolia, transport: custom(window.ethereum) })
  }

  /** Connect the injected wallet, switch it to Sepolia, and check who owns the namespace. */
  async function connect() {
    if (!hasWallet) { log('No browser wallet found. Install MetaMask or a compatible wallet.', 'error'); return }
    status.value = 'connecting'
    try {
      const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const chainId = await window.ethereum.request({ method: 'eth_chainId' })
      if (Number(chainId) !== sepolia.id) {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${sepolia.id.toString(16)}` }] })
      }
      account.value = getAddress(addr)
      const owner = await publicClient.readContract({ address: HELPER, abi: navAbi, functionName: 'findExactOwner', args: [dns(NAMEFLOW_NAMESPACE)] })
      ownerAddress.value = owner
      isOwner.value = owner.toLowerCase() === account.value.toLowerCase()
      log(isOwner.value
        ? `${account.value.slice(0, 8)}… owns ${NAMEFLOW_NAMESPACE}: pool registration allowed`
        : `${account.value.slice(0, 8)}… does not own ${NAMEFLOW_NAMESPACE} (owner ${owner.slice(0, 8)}…): read-only`, isOwner.value ? 'info' : 'error')
      status.value = 'idle'
    } catch (err) {
      log(`Wallet: ${err.shortMessage || err.message}`, 'error')
      status.value = 'error'
    }
  }

  /** Read the pool contract and its tokens, and propose ENS metadata for it. */
  async function inspectPool(poolAddress, existingPools = []) {
    if (!isAddress(poolAddress)) { log('Enter a valid pool address', 'error'); return null }
    status.value = 'inspecting'
    draft.value = null
    try {
      const address = getAddress(poolAddress)
      if (existingPools.some((p) => p.address === address.toLowerCase())) throw new Error('This pool is already in the watchlist')
      const [t0, t1, fee] = await Promise.all(['token0', 'token1', 'fee'].map((fn) => publicClient.readContract({ address, abi: poolAbi, functionName: fn })))
      const [s0, d0, s1, d1] = await Promise.all([
        publicClient.readContract({ address: t0, abi: erc20Abi, functionName: 'symbol' }),
        publicClient.readContract({ address: t0, abi: erc20Abi, functionName: 'decimals' }),
        publicClient.readContract({ address: t1, abi: erc20Abi, functionName: 'symbol' }),
        publicClient.readContract({ address: t1, abi: erc20Abi, functionName: 'decimals' }),
      ])
      const token0 = { address: t0.toLowerCase(), symbol: s0, decimals: Number(d0), color: TOKEN_COLORS[s0] || hashColor(t0) }
      const token1 = { address: t1.toLowerCase(), symbol: s1, decimals: Number(d1), color: TOKEN_COLORS[s1] || hashColor(t1) }
      // Price the non-stable token in the stable one when possible; otherwise WETH is the quote.
      const stable = [token0, token1].find((t) => /USD|DAI/i.test(t.symbol))
      const quote = stable || [token0, token1].find((t) => t.symbol === 'WETH') || token1
      const base = quote === token0 ? token1 : token0
      const label = `${base.symbol}-${quote.symbol}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
      const alias = `${label.replace(/-/g, '')}pool1`
      draft.value = {
        address: address.toLowerCase(),
        ensName: `${label}.${NAMEFLOW_NAMESPACE}`,
        label,
        name: `${base.symbol} / ${quote.symbol}`,
        fee: Number(fee),
        color: POOL_COLORS[existingPools.length % POOL_COLORS.length],
        alias,
        mbLabel: 'uniswapv3pool',
        avatar: '',
        token0, token1, base, quote,
      }
      log(`Pool ${address.slice(0, 8)}… is ${draft.value.name} (${Number(fee) / 10000}% fee)`)
      status.value = 'idle'
      return draft.value
    } catch (err) {
      log(`Inspect: ${err.shortMessage || err.message}`, 'error')
      status.value = 'error'
      return null
    }
  }

  /** Register the subname (if missing) and publish its records. Returns the ENS name on success. */
  async function publishPool(d) {
    if (!isOwner.value) { log('Connect the namespace owner wallet first', 'error'); return null }
    status.value = 'publishing'
    const wc = walletClient()
    try {
      const ns = NAMEFLOW_NAMESPACE
      const ensName = normalize(`${d.label}.${ns}`)
      const [parentRegistry, [resolver]] = await Promise.all([
        publicClient.readContract({ address: HELPER, abi: navAbi, functionName: 'findParentRegistry', args: [dns(ns)] }),
        publicClient.readContract({ address: UNIVERSAL_RESOLVER, abi: navAbi, functionName: 'findResolver', args: [dns(ns)] }),
      ])
      const nsLabel = ns.split('.')[0]
      const root = await publicClient.readContract({ address: parentRegistry, abi: registryAbi, functionName: 'getSubregistry', args: [nsLabel] })
      if (root === zeroAddress) throw new Error(`${ns} has no ENSv2 registry yet; run scripts/register-ens-wallets.mjs once`)
      const expiry = await publicClient.readContract({ address: parentRegistry, abi: registryAbi, functionName: 'getExpiry', args: [labelId(nsLabel)] })

      // 1. subname registration in the namespace registry
      const existingOwner = await publicClient.readContract({ address: root, abi: registryAbi, functionName: 'findOwner', args: [d.label] })
      if (existingOwner === zeroAddress) {
        const st = await publicClient.readContract({ address: root, abi: registryAbi, functionName: 'getStatus', args: [labelId(d.label)] })
        if (st !== 0) throw new Error(`Label "${d.label}" is reserved in the registry`)
        log(`Registering ${ensName}…`)
        await write(wc, { address: root, abi: registryAbi, functionName: 'register', args: [d.label, account.value, zeroAddress, resolver, ROLES, expiry] })
      } else if (existingOwner.toLowerCase() !== account.value.toLowerCase()) {
        throw new Error(`${ensName} is owned by ${existingOwner.slice(0, 8)}…`)
      } else {
        log(`${ensName} already registered, updating records`)
      }

      // 2. resolver records + directory entry in one multicall
      const metadata = {
        name: d.name, alias: d.alias, label: d.mbLabel, fee: d.fee, color: d.color,
        token0: d.token0, token1: d.token1,
        base: { address: d.base.address }, quote: { address: d.quote.address },
      }
      const rawDir = await publicClient.getEnsText({ name: ns, key: DIRECTORY_KEY })
      const directory = rawDir ? JSON.parse(rawDir) : { version: 1, chainId: sepolia.id, pools: [], wallets: [] }
      if (!directory.pools.includes(ensName)) directory.pools = [...directory.pools, ensName]

      const calls = []
      const forward = await publicClient.getEnsAddress({ name: ensName }).catch(() => null)
      if (forward?.toLowerCase() !== d.address) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: 'setAddress', args: [dns(ensName), 60n, getAddress(d.address)] }))
      const existingMeta = await publicClient.getEnsText({ name: ensName, key: POOL_METADATA_KEY }).catch(() => null)
      if (existingMeta !== JSON.stringify(metadata)) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dns(ensName), POOL_METADATA_KEY, JSON.stringify(metadata)] }))
      if (rawDir !== JSON.stringify(directory)) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dns(ns), DIRECTORY_KEY, JSON.stringify(directory)] }))
      const avatar = (d.avatar || '').trim()
      if (avatar) {
        const u = new URL(avatar)
        if (u.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error('Avatar must be a public https:// URL')
        const existingAvatar = await publicClient.getEnsText({ name: ensName, key: 'avatar' }).catch(() => null)
        if (existingAvatar !== avatar) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dns(ensName), 'avatar', avatar] }))
      }
      if (calls.length) {
        log(`Publishing ${calls.length} resolver record(s)…`)
        await write(wc, { address: resolver, abi: resolverAbi, functionName: 'multicall', args: [calls] })
      } else {
        log('Resolver records already up to date')
      }

      // 3. best effort: make MultiBaas aware of the pool so contract calls work
      await linkInMultiBaas(d)

      log(`${ensName} published. Reloading the watchlist…`)
      status.value = 'done'
      return ensName
    } catch (err) {
      log(`Publish: ${err.shortMessage || err.message}`, 'error')
      status.value = 'error'
      return null
    }
  }

  async function write(wc, request) {
    const req = { ...request, account: getAddress(account.value) }
    await publicClient.simulateContract(req)
    const hash = await wc.writeContract(req)
    log(`${request.functionName} sent: ${hash.slice(0, 12)}…`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${request.functionName} reverted`)
    return receipt
  }

  /** Needs a MultiBaas key with write rights; with a read-only key this logs what to do in the console instead. */
  async function linkInMultiBaas(d) {
    const url = (import.meta.env.VITE_MULTIBAAS_URL || '').replace(/\/+$/, '')
    const key = import.meta.env.VITE_MULTIBAAS_API_KEY || ''
    if (!import.meta.env.DEV || !url || !key) {
      log(`MultiBaas: link ${d.address.slice(0, 8)}… as alias "${d.alias}" to contract "${d.mbLabel}" in the console`)
      return
    }
    try {
      const cfg = new Configuration({ basePath: `${window.location.origin}/multibaas-api/api/v0`, accessToken: key })
      await new AddressesApi(cfg).setAddress({ alias: d.alias, address: getAddress(d.address) })
      await new ContractsApi(cfg).linkAddressContract(d.alias, { label: d.mbLabel })
      log(`MultiBaas: linked ${d.alias} → ${d.mbLabel}; Swap events will index from here on`)
    } catch (err) {
      log(`MultiBaas link needs an admin key (${err?.response?.status || err.message}); add alias "${d.alias}" in the console`, 'error')
    }
  }

  function reset() {
    draft.value = null
    logs.value = []
    if (status.value !== 'publishing') status.value = 'idle'
  }

  return { hasWallet, account, isOwner, ownerAddress, status, busy, logs, draft, connect, inspectPool, publishPool, reset }
}

function hashColor(addr) {
  let h = 0
  for (const c of addr.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) | 0
  return `#${((Math.abs(h) % 0xffffff) | 0x404040).toString(16).padStart(6, '0')}`
}
