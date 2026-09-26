import { ref, computed } from 'vue'
import {
  createWalletClient, createPublicClient, http,
  parseEther, formatEther, formatUnits, keccak256, encodePacked,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

/**
 * Sepolia swap simulator.
 *
 * Derives WALLET_COUNT wallets from one throwaway private key and drives real Uniswap V3
 * swaps through the router so MultiBaas has live events to index during a demo.
 *
 * Readiness is read from chain (ETH, WETH, USDC balances and router allowances), never from
 * a local flag, so a page reload or a second session sees the wallets as already prepared.
 * `prepareWallets()` is idempotent: it only performs the steps a wallet is still missing.
 */

const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
const SWAP_ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E'
const MAX_UINT256 = 2n ** 256n - 1n

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
]

const ROUTER_ABI = [
  {
    name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
]

// One round = three swaps per wallet, one per pool. Direction alternates by wallet AND by
// round so the same wallet trades the other way next time. Across five wallets a round is
// close to net-neutral for every pool, which keeps the tiny testnet pools from drifting.
const WETH_SWAP = parseEther('0.001')
const USDC_SWAP = 30_000_000n     // 30 USDC, roughly the USDC value of 0.001 WETH on Sepolia
const UNI_SWAP = parseEther('0.00006') // roughly the UNI received for 0.001 WETH
const USDC_UNI_SWAP = 500_000n    // 0.5 USDC: the USDC/UNI pool is tiny, keep this leg small
const UNI_USDC_SWAP = parseEther('0.0000002')
const ROUND_KEY = 'nameflow.sim.round'

function currentRound() {
  try { return Number(localStorage.getItem(ROUND_KEY)) || 0 } catch { return 0 }
}
function bumpRound() {
  try { localStorage.setItem(ROUND_KEY, String(currentRound() + 1)) } catch { /* ignore */ }
}

/** Build a wallet's legs for this round, falling back to the WETH/USDC side when it lacks the other token. */
function swapPlan(wallet, round) {
  const forward = (wallet.index + round) % 2 === 0
  const legs = []
  // WETH / USDC
  legs.push(!forward && wallet.usdc >= USDC_SWAP
    ? { tokenIn: USDC, tokenOut: WETH, fee: 3000, amountIn: USDC_SWAP, label: 'USDC→WETH' }
    : { tokenIn: WETH, tokenOut: USDC, fee: 3000, amountIn: WETH_SWAP, label: 'WETH→USDC' })
  // WETH / UNI
  legs.push(!forward && wallet.uni >= UNI_SWAP && wallet.allowUni >= MIN_ALLOWANCE
    ? { tokenIn: UNI, tokenOut: WETH, fee: 3000, amountIn: UNI_SWAP, label: 'UNI→WETH' }
    : { tokenIn: WETH, tokenOut: UNI, fee: 3000, amountIn: WETH_SWAP, label: 'WETH→UNI' })
  // USDC / UNI
  legs.push(!forward && wallet.uni >= UNI_USDC_SWAP && wallet.allowUni >= MIN_ALLOWANCE
    ? { tokenIn: UNI, tokenOut: USDC, fee: 3000, amountIn: UNI_USDC_SWAP, label: 'UNI→USDC' }
    : { tokenIn: USDC, tokenOut: UNI, fee: 3000, amountIn: USDC_UNI_SWAP, label: 'USDC→UNI' })
  return legs
}
const SWAPS_PER_WALLET = 3

// Readiness thresholds (per wallet) and preparation targets.
const GAS_RESERVE_ETH = parseEther('0.003')   // enough for a round of swaps on Sepolia
const SUB_WALLET_TARGET_ETH = parseEther('0.02')
const WETH_NEEDED = WETH_SWAP * 2n            // two WETH legs per round
const WETH_WRAP_TARGET = parseEther('0.012')  // covers USDC preload + several rounds
const USDC_NEEDED = USDC_SWAP + USDC_UNI_SWAP
const USDC_PRELOAD_WETH = parseEther('0.005') // swapped once to seed USDC
const MIN_ALLOWANCE = parseEther('1')         // treat anything below as "not approved"

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const TEST_PK = normalizeKey(import.meta.env.VITE_TEST_PRIVATE_KEY || '')
const WALLET_COUNT = 5

const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })

function normalizeKey(pk) {
  const trimmed = pk.trim()
  if (!trimmed) return ''
  const hex = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? hex : ''
}

function derivePrivateKey(masterPk, index) {
  if (index === 0) return masterPk
  return keccak256(encodePacked(['bytes32', 'uint256'], [masterPk, BigInt(index)]))
}

function walletClientFor(account) {
  return createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
}

// Module-level so the panel and the dashboard share one simulator state.
const wallets = ref([])          // [{ index, address, eth, weth, usdc, allowWeth, allowUsdc, needs: [], ready }]
const status = ref('idle')       // idle | inspecting | preparing | swapping | error
const logs = ref([])
const swapsDone = ref(0)
const swapsFailed = ref(0)
const swapsTotal = ref(0)
const inspectedAt = ref(0)
let accounts = []

export function useSimulateSwaps() {
  const keyConfigured = Boolean(TEST_PK)
  const busy = computed(() => ['inspecting', 'preparing', 'swapping'].includes(status.value))
  const readyWallets = computed(() => wallets.value.filter((w) => w.ready))
  const allReady = computed(() => wallets.value.length > 0 && readyWallets.value.length === wallets.value.length)
  const plannedSwaps = computed(() => readyWallets.value.length * SWAPS_PER_WALLET)

  /** ETH the main wallet must hold to prepare every wallet that is not ready yet. */
  const requiredMainEth = computed(() => {
    if (!wallets.value.length) return 0n
    let total = 0n
    for (const w of wallets.value) {
      if (w.index !== 0 && w.needs.includes('eth')) total += SUB_WALLET_TARGET_ETH - w.eth
      if (w.index === 0 && w.needs.includes('weth')) total += WETH_WRAP_TARGET - w.weth
    }
    return total + GAS_RESERVE_ETH * 2n
  })
  const mainShortfallEth = computed(() => {
    const main = wallets.value[0]
    if (!main) return 0n
    const short = requiredMainEth.value - main.eth
    return short > 0n ? short : 0n
  })

  function initWallet() {
    if (!TEST_PK || accounts.length) return
    accounts = Array.from({ length: WALLET_COUNT }, (_, i) => privateKeyToAccount(derivePrivateKey(TEST_PK, i)))
    wallets.value = accounts.map((a, i) => emptyWallet(i, a.address))
  }

  function addLog(msg, level = 'info') {
    logs.value = [...logs.value.slice(-80), { time: Date.now(), msg, level }]
  }

  /** Read balances + allowances for every wallet in one multicall and derive what each still needs. */
  async function inspectWallets() {
    if (!accounts.length) initWallet()
    if (!accounts.length) return
    const prev = status.value
    if (prev === 'idle' || prev === 'error') status.value = 'inspecting'
    try {
      const addrs = accounts.map((a) => a.address)
      const [eths, tokenReads] = await Promise.all([
        Promise.all(addrs.map((a) => publicClient.getBalance({ address: a }))),
        publicClient.multicall({
          allowFailure: true,
          contracts: addrs.flatMap((a) => [
            { address: WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [a] },
            { address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [a] },
            { address: WETH, abi: ERC20_ABI, functionName: 'allowance', args: [a, SWAP_ROUTER] },
            { address: USDC, abi: ERC20_ABI, functionName: 'allowance', args: [a, SWAP_ROUTER] },
            { address: UNI, abi: ERC20_ABI, functionName: 'balanceOf', args: [a] },
            { address: UNI, abi: ERC20_ABI, functionName: 'allowance', args: [a, SWAP_ROUTER] },
          ]),
        }),
      ])
      wallets.value = addrs.map((address, i) => {
        const r = (k) => tokenReads[i * 6 + k]?.result ?? 0n
        return describeWallet(i, address, eths[i], r(0), r(1), r(2), r(3), r(4), r(5))
      })
      inspectedAt.value = Date.now()
    } catch (err) {
      addLog(`Error reading wallet state: ${err.shortMessage || err.message}`, 'error')
    } finally {
      if (status.value === 'inspecting') status.value = prev === 'error' ? 'idle' : prev
    }
  }

  /** Idempotent: fund, wrap, approve, and seed USDC only where a wallet is short. */
  async function prepareWallets() {
    if (!accounts.length) initWallet()
    if (!accounts.length) return
    status.value = 'preparing'
    logs.value = []
    try {
      await inspectWallets()
      if (mainShortfallEth.value > 0n) {
        addLog(`Main wallet needs ${fmtEth(mainShortfallEth.value)} more ETH before preparing`, 'error')
        status.value = 'error'
        return
      }

      // 1. Top up sub-wallets that are short on gas (sequential: one nonce stream from the main wallet)
      const mainWC = walletClientFor(accounts[0])
      for (const w of wallets.value) {
        if (w.index === 0 || !w.needs.includes('eth')) continue
        const value = SUB_WALLET_TARGET_ETH - w.eth
        addLog(`Funding wallet ${w.index + 1} with ${fmtEth(value)} ETH…`)
        const hash = await mainWC.sendTransaction({ to: w.address, value, gas: 21000n })
        await publicClient.waitForTransactionReceipt({ hash })
      }

      // 2. Per wallet, in parallel across wallets, sequential within a wallet: wrap → approve → seed USDC
      await inspectWallets()
      const results = await Promise.allSettled(wallets.value.map((w) => prepareOne(w)))
      results.forEach((r, i) => {
        if (r.status === 'rejected') addLog(`Wallet ${i + 1}: ${r.reason?.shortMessage || r.reason?.message || r.reason}`, 'error')
      })

      await inspectWallets()
      const notReady = wallets.value.filter((w) => !w.ready)
      if (notReady.length) {
        addLog(`${notReady.length} wallet(s) still not ready: ${notReady.map((w) => `#${w.index + 1} needs ${w.needs.join('/')}`).join(', ')}`, 'error')
        status.value = 'error'
      } else {
        addLog('All wallets ready')
        status.value = 'idle'
      }
    } catch (err) {
      addLog(`Error: ${err.shortMessage || err.message}`, 'error')
      status.value = 'error'
    }
  }

  async function prepareOne(w) {
    const acc = accounts[w.index]
    const wc = walletClientFor(acc)
    const needs = new Set(w.needs)
    const tag = `Wallet ${w.index + 1}`

    if (needs.has('weth')) {
      const value = WETH_WRAP_TARGET - w.weth
      addLog(`${tag}: wrapping ${fmtEth(value)} ETH → WETH`)
      const hash = await wc.writeContract({ address: WETH, abi: ERC20_ABI, functionName: 'deposit', value })
      await publicClient.waitForTransactionReceipt({ hash })
    }
    if (needs.has('approve-weth')) {
      addLog(`${tag}: approving WETH for the router`)
      const hash = await wc.writeContract({ address: WETH, abi: ERC20_ABI, functionName: 'approve', args: [SWAP_ROUTER, MAX_UINT256] })
      await publicClient.waitForTransactionReceipt({ hash })
    }
    if (needs.has('approve-usdc')) {
      addLog(`${tag}: approving USDC for the router`)
      const hash = await wc.writeContract({ address: USDC, abi: ERC20_ABI, functionName: 'approve', args: [SWAP_ROUTER, MAX_UINT256] })
      await publicClient.waitForTransactionReceipt({ hash })
    }
    if (needs.has('approve-uni')) {
      addLog(`${tag}: approving UNI for the router`)
      const hash = await wc.writeContract({ address: UNI, abi: ERC20_ABI, functionName: 'approve', args: [SWAP_ROUTER, MAX_UINT256] })
      await publicClient.waitForTransactionReceipt({ hash })
    }
    if (needs.has('usdc')) {
      addLog(`${tag}: seeding USDC (swap ${fmtEth(USDC_PRELOAD_WETH)} WETH → USDC)`)
      const hash = await wc.writeContract({
        address: SWAP_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
        args: [{ tokenIn: WETH, tokenOut: USDC, fee: 3000, recipient: acc.address, amountIn: USDC_PRELOAD_WETH, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }
    addLog(`${tag}: ready`)
  }

  /** Broadcast one round of swaps from every ready wallet. Failures are counted, not fatal. */
  async function executeSwaps() {
    if (!accounts.length) initWallet()
    if (!accounts.length) return
    status.value = 'swapping'
    logs.value = []
    swapsDone.value = 0
    swapsFailed.value = 0
    try {
      await inspectWallets()
      const ready = wallets.value.filter((w) => w.ready)
      if (!ready.length) {
        addLog('No wallet is ready. Run "Prepare wallets" first.', 'error')
        status.value = 'error'
        return
      }
      swapsTotal.value = ready.length * SWAPS_PER_WALLET
      const round = currentRound()
      addLog(`Round ${round + 1}: broadcasting ${swapsTotal.value} swaps from ${ready.length} wallet(s)…`)

      const nonces = await Promise.all(ready.map((w) => publicClient.getTransactionCount({ address: w.address })))
      const jobs = []
      ready.forEach((w, i) => {
        const acc = accounts[w.index]
        const wc = walletClientFor(acc)
        let nonce = nonces[i]
        for (const cfg of swapPlan(w, round)) {
          const thisNonce = nonce++
          jobs.push(
            wc.writeContract({
              address: SWAP_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
              args: [{ tokenIn: cfg.tokenIn, tokenOut: cfg.tokenOut, fee: cfg.fee, recipient: acc.address, amountIn: cfg.amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
              nonce: thisNonce,
            })
              .then((hash) => {
                addLog(`${cfg.label} from wallet ${w.index + 1} sent`)
                return publicClient.waitForTransactionReceipt({ hash })
              })
              .then((receipt) => {
                if (receipt.status === 'success') swapsDone.value++
                else { swapsFailed.value++; addLog(`${cfg.label} from wallet ${w.index + 1} reverted`, 'error') }
              })
              .catch((err) => {
                swapsFailed.value++
                addLog(`${cfg.label} from wallet ${w.index + 1}: ${err.shortMessage || err.message}`, 'error')
              }),
          )
        }
      })
      await Promise.all(jobs)
      bumpRound()
      addLog(swapsFailed.value ? `${swapsDone.value} confirmed, ${swapsFailed.value} failed` : `All ${swapsDone.value} swaps confirmed`)
      status.value = swapsFailed.value ? 'error' : 'idle'
      await inspectWallets()
    } catch (err) {
      addLog(`Error: ${err.shortMessage || err.message}`, 'error')
      status.value = 'error'
    }
  }

  return {
    keyConfigured,
    wallets, status, busy, logs,
    swapsDone, swapsFailed, swapsTotal, plannedSwaps,
    readyWallets, allReady, requiredMainEth, mainShortfallEth, inspectedAt,
    initWallet, inspectWallets, prepareWallets, executeSwaps,
    fmtEth, fmtUsdc,
  }
}

function emptyWallet(index, address) {
  return { index, address, eth: 0n, weth: 0n, usdc: 0n, uni: 0n, allowWeth: 0n, allowUsdc: 0n, allowUni: 0n, needs: [], ready: false, inspected: false }
}

function describeWallet(index, address, eth, weth, usdc, allowWeth, allowUsdc, uni, allowUni) {
  const needs = []
  if (eth < GAS_RESERVE_ETH) needs.push('eth')
  if (weth < WETH_NEEDED) needs.push('weth')
  if (allowWeth < MIN_ALLOWANCE) needs.push('approve-weth')
  if (allowUsdc < MIN_ALLOWANCE) needs.push('approve-usdc')
  if (allowUni < MIN_ALLOWANCE) needs.push('approve-uni')
  if (usdc < USDC_NEEDED) needs.push('usdc')
  // seeding USDC costs WETH, so a wallet that needs USDC must also hold WETH for it
  if (needs.includes('usdc') && !needs.includes('weth') && weth < USDC_PRELOAD_WETH + WETH_NEEDED) needs.push('weth')
  return { index, address, eth, weth, usdc, uni, allowWeth, allowUsdc, allowUni, needs, ready: needs.length === 0, inspected: true }
}

function fmtEth(wei, digits = 4) {
  return Number(formatEther(wei)).toFixed(digits)
}

function fmtUsdc(raw, digits = 2) {
  return Number(formatUnits(raw, 6)).toFixed(digits)
}
