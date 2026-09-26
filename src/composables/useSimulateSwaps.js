import { ref, computed } from 'vue'
import { createWalletClient, createPublicClient, http, parseEther, formatEther, keccak256, encodePacked } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
const SWAP_ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E'
const MAX_UINT256 = 2n ** 256n - 1n

const WETH_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
]

const ERC20_ABI = [
  {
    name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
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

const SWAP_CONFIGS = [
  { tokenIn: WETH, tokenOut: USDC, fee: 3000, amountIn: parseEther('0.001'), label: 'WETH→USDC' },
  { tokenIn: WETH, tokenOut: UNI, fee: 3000, amountIn: parseEther('0.001'), label: 'WETH→UNI' },
  { tokenIn: USDC, tokenOut: UNI, fee: 3000, amountIn: 5_000_000n, label: 'USDC→UNI' },
]

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const TEST_PK = import.meta.env.VITE_TEST_PRIVATE_KEY || ''
const WALLET_COUNT = 5

function derivePrivateKey(masterPk, index) {
  if (index === 0) return masterPk
  return keccak256(encodePacked(['bytes32', 'uint256'], [masterPk, BigInt(index)]))
}

export function useSimulateSwaps() {
  const wallets = ref([])
  const status = ref('idle')
  const logs = ref([])
  const swapsDone = ref(0)
  const swapsTotal = ref(WALLET_COUNT * SWAP_CONFIGS.length)
  const setupDone = ref(false)

  let accounts = []

  const hasFunds = computed(() => {
    if (!wallets.value.length) return false
    const bal = parseFloat(wallets.value[0]?.balance || '0')
    return !isNaN(bal) && bal >= 0.05
  })

  const walletAddress = computed(() => wallets.value[0]?.address || '')
  const balance = computed(() => wallets.value[0]?.balance || '')

  function initWallet() {
    if (!TEST_PK || accounts.length) return
    accounts = []
    const w = []
    for (let i = 0; i < WALLET_COUNT; i++) {
      const pk = derivePrivateKey(TEST_PK, i)
      const account = privateKeyToAccount(pk)
      accounts.push(account)
      w.push({ address: account.address, balance: '' })
    }
    wallets.value = w
  }

  async function refreshBalance() {
    if (!wallets.value.length) return
    const pc = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
    const updated = await Promise.all(wallets.value.map(async (w) => {
      try {
        const bal = await pc.getBalance({ address: w.address })
        return { ...w, balance: formatEther(bal) }
      } catch {
        return { ...w, balance: '?' }
      }
    }))
    wallets.value = updated
  }

  function addLog(msg) {
    logs.value = [...logs.value, { time: Date.now(), msg }]
  }

  async function setupWallets() {
    if (!accounts.length) initWallet()
    status.value = 'running'
    logs.value = []

    const pc = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
    const mainWC = createWalletClient({ account: accounts[0], chain: sepolia, transport: http(SEPOLIA_RPC) })

    try {
      // Fund sub-wallets sequentially to avoid nonce conflicts
      for (let i = 1; i < accounts.length; i++) {
        addLog(`Funding wallet ${i + 1}/${accounts.length}...`)
        const hash = await mainWC.sendTransaction({
          to: accounts[i].address,
          value: parseEther('0.02'),
          gas: 21000n,
        })
        await pc.waitForTransactionReceipt({ hash })
      }
      addLog('All sub-wallets funded')

      // Each wallet: wrap, approve, pre-load USDC (parallel across wallets)
      addLog('Setting up wallets (wrap → approve → pre-load USDC)...')
      await Promise.all(accounts.map(async (acc, i) => {
        const wc = createWalletClient({ account: acc, chain: sepolia, transport: http(SEPOLIA_RPC) })

        // Wrap ETH → WETH
        const wrapHash = await wc.writeContract({
          address: WETH, abi: WETH_ABI, functionName: 'deposit',
          value: parseEther('0.012'),
        })
        await pc.waitForTransactionReceipt({ hash: wrapHash })

        // Approve WETH for router
        const apWeth = await wc.writeContract({
          address: WETH, abi: ERC20_ABI, functionName: 'approve',
          args: [SWAP_ROUTER, MAX_UINT256],
        })
        await pc.waitForTransactionReceipt({ hash: apWeth })

        // Approve USDC for router (can approve before having balance)
        const apUsdc = await wc.writeContract({
          address: USDC, abi: ERC20_ABI, functionName: 'approve',
          args: [SWAP_ROUTER, MAX_UINT256],
        })
        await pc.waitForTransactionReceipt({ hash: apUsdc })

        // Pre-load USDC: swap 0.005 WETH → USDC
        const preHash = await wc.writeContract({
          address: SWAP_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
          args: [{
            tokenIn: WETH, tokenOut: USDC, fee: 3000,
            recipient: acc.address, amountIn: parseEther('0.005'),
            amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
          }],
        })
        await pc.waitForTransactionReceipt({ hash: preHash })

        addLog(`Wallet ${i + 1} ready`)
      }))

      setupDone.value = true
      status.value = 'idle'
      addLog('Setup complete — ready to execute swaps')
      await refreshBalance()
    } catch (err) {
      addLog(`Error: ${err.shortMessage || err.message}`)
      status.value = 'error'
    }
  }

  async function executeSwaps() {
    if (!accounts.length) initWallet()
    status.value = 'running'
    logs.value = []
    swapsDone.value = 0

    const pc = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })

    try {
      addLog(`Broadcasting ${swapsTotal.value} swaps from ${WALLET_COUNT} wallets...`)

      const nonces = await Promise.all(
        accounts.map(acc => pc.getTransactionCount({ address: acc.address }))
      )

      const promises = []
      for (let wi = 0; wi < accounts.length; wi++) {
        const acc = accounts[wi]
        const wc = createWalletClient({ account: acc, chain: sepolia, transport: http(SEPOLIA_RPC) })
        let nonce = nonces[wi]

        for (const cfg of SWAP_CONFIGS) {
          promises.push(
            wc.writeContract({
              address: SWAP_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
              args: [{
                tokenIn: cfg.tokenIn, tokenOut: cfg.tokenOut, fee: cfg.fee,
                recipient: acc.address, amountIn: cfg.amountIn,
                amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
              }],
              nonce: nonce++,
            }).then(hash => {
              addLog(`${cfg.label} from ${acc.address.slice(0, 8)}... sent`)
              return pc.waitForTransactionReceipt({ hash })
            }).then(() => {
              swapsDone.value++
            })
          )
        }
      }

      await Promise.all(promises)
      addLog('All swaps confirmed')
      status.value = 'done'
      await refreshBalance()
    } catch (err) {
      addLog(`Error: ${err.shortMessage || err.message}`)
      status.value = 'error'
    }
  }

  return {
    wallets, walletAddress, balance, hasFunds,
    status, logs, swapsDone, swapsTotal, setupDone,
    initWallet, refreshBalance, setupWallets, executeSwaps,
  }
}
