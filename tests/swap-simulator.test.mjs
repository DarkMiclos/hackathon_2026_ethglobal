import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref, computed } from 'vue'
import { parseEther, formatEther, formatUnits, keccak256, encodePacked } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Run the actual composable with fake RPC clients; these tests never send transactions.
function harness({ rejectFirst = false, timeout = false } = {}) {
  const source = readFileSync(new URL('../src/composables/useSimulateSwaps.js', import.meta.url), 'utf8')
    .replace(/^import [\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replaceAll('import.meta.env', 'env').replace('export function', 'function')
  let pending = false
  let sends = 0
  const requests = []
  const client = {
    getBalance: async () => parseEther('1'),
    multicall: async ({ contracts }) => contracts.map(() => ({ result: parseEther('1000') })),
    simulateContract: async () => { assert.equal(pending, false); return { result: 1000n } },
    estimateContractGas: async () => 100000n,
    waitForTransactionReceipt: async () => {
      if (timeout) throw new Error('Receipt timeout')
      pending = false
      return { status: 'success' }
    },
  }
  const wallet = { writeContract: async request => {
    assert.equal(pending, false)
    sends++
    if (rejectFirst && sends === 1) throw new Error('Request exceeds defined limit')
    assert.equal(request.nonce, undefined)
    assert.equal(request.gas, 130000n)
    assert.equal(request.args[0].amountOutMinimum, 990n)
    requests.push(structuredClone(request.args[0]))
    pending = true
    return `0x${sends.toString(16).padStart(64, '0')}`
  } }
  const WETH = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
  const USDC = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'
  const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
  const pools = [[WETH,USDC,3000],[WETH,UNI,3000],[USDC,UNI,3000],[WETH,USDC,500]]
    .map(([a,b,fee]) => ({ token0: {address:a}, token1: {address:b}, fee }))
  const bindings = { ref, computed, parseEther, formatEther, formatUnits, keccak256, encodePacked,
    privateKeyToAccount, POOLS:pools, sepolia:{}, http:()=>null,
    createPublicClient:()=>client, createWalletClient:()=>wallet,
    env:{VITE_TEST_PRIVATE_KEY:'1'.repeat(64)}, localStorage:{getItem:()=>null,setItem:()=>{}} }
  const sim = new Function(...Object.keys(bindings), `${source}\nreturn useSimulateSwaps()`)(...Object.values(bindings))
  return { sim, requests }
}

test('confirms each swap before the next, includes the added fee tier, and protects output', async () => {
  const {sim, requests} = harness()
  await sim.executeSwaps()
  assert.equal(sim.swapsDone.value, 20)
  assert.equal(sim.swapsFailed.value, 0)
  assert.equal(requests.filter(r=>r.fee===500).length, 5)
})
test('a rejected submission does not reserve a nonce for later swaps', async () => {
  const {sim} = harness({rejectFirst:true})
  await sim.executeSwaps()
  assert.equal(sim.swapsDone.value, 19)
  assert.equal(sim.swapsFailed.value, 1)
})
test('an unknown receipt stops the round without claiming failure or resending', async () => {
  const {sim, requests} = harness({timeout:true})
  await sim.executeSwaps()
  assert.equal(requests.length, 1)
  assert.equal(sim.swapsDone.value, 0)
  assert.equal(sim.swapsFailed.value, 0)
  assert.equal(sim.status.value, 'error')
  assert.ok(sim.logs.value.some(l=>l.msg.includes('Confirmation unknown')))
})
