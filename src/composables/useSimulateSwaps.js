import { ref, computed } from 'vue'
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const SWAP_ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E'

const WETH_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
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

const TEST_PK = import.meta.env.VITE_TEST_PRIVATE_KEY || ''

export function useSimulateSwaps() {
  const walletAddress = ref('')
  const balance = ref('')
  const status = ref('idle')
  const logs = ref([])
  const swapsDone = ref(0)
  const swapsTotal = ref(0)

  const hasFunds = computed(() => {
    const bal = parseFloat(balance.value)
    return !isNaN(bal) && bal >= 0.008
  })

  let account = null

  function initWallet() {
    if (!TEST_PK) {
      console.warn('No VITE_TEST_PRIVATE_KEY in .env — cannot simulate swaps')
      return null
    }
    account = privateKeyToAccount(TEST_PK)
    walletAddress.value = account.address
    return account
  }

  async function refreshBalance() {
    if (!walletAddress.value) return
    const client = createPublicClient({ chain: sepolia, transport: http() })
    const bal = await client.getBalance({ address: walletAddress.value })
    balance.value = formatEther(bal)
  }

  function addLog(msg) {
    logs.value = [...logs.value, { time: Date.now(), msg }]
  }

  async function executeSwaps(count = 5) {
    if (!account) initWallet()
    status.value = 'running'
    logs.value = []
    swapsDone.value = 0
    swapsTotal.value = count

    const publicClient = createPublicClient({ chain: sepolia, transport: http() })
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http() })

    try {
      const wrapAmount = parseEther(String(0.001 * count))

      addLog(`Wrapping ${formatEther(wrapAmount)} ETH → WETH...`)
      const wrapHash = await walletClient.writeContract({
        address: WETH, abi: WETH_ABI, functionName: 'deposit',
        value: wrapAmount,
      })
      await publicClient.waitForTransactionReceipt({ hash: wrapHash })
      addLog('WETH wrap confirmed')

      addLog('Approving SwapRouter to spend WETH...')
      const approveHash = await walletClient.writeContract({
        address: WETH, abi: WETH_ABI, functionName: 'approve',
        args: [SWAP_ROUTER, wrapAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      addLog('Approval confirmed')

      for (let i = 0; i < count; i++) {
        addLog(`Swap ${i + 1}/${count}: 0.001 WETH → USDC...`)
        const hash = await walletClient.writeContract({
          address: SWAP_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
          args: [{
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 3000,
            recipient: account.address,
            amountIn: parseEther('0.001'),
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
          }],
        })
        await publicClient.waitForTransactionReceipt({ hash })
        swapsDone.value = i + 1
        addLog(`Swap ${i + 1} confirmed (${hash.slice(0, 10)}...)`)
      }

      addLog('All swaps complete — dashboard will update shortly')
      status.value = 'done'
      await refreshBalance()
    } catch (err) {
      const msg = err.shortMessage || err.message || String(err)
      addLog(`Error: ${msg}`)
      status.value = 'error'
    }
  }

  return { walletAddress, balance, hasFunds, status, logs, swapsDone, swapsTotal, initWallet, refreshBalance, executeSwaps }
}
