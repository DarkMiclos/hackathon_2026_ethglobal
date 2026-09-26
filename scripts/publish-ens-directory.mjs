import fs from 'node:fs'
import os from 'node:os'
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'
import { NAMEFLOW_NAMESPACE, DIRECTORY_KEY, POOL_METADATA_KEY } from '../src/config/ens.js'

const seedPath = process.env.NAMEFLOW_SEED_FILE || `${os.homedir()}/.config/nameflow/ens-directory-seed.json`
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
for (const pool of seed.pools) {
  if (!pool.avatar) continue
  const url = new URL(pool.avatar)
  if (url.protocol !== 'https:' || url.username || url.password || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error(`Use a public HTTPS avatar URL: ${pool.ensName}`)
  const response = await fetch(url)
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw Error(`Avatar URL is not an accessible image: ${pool.ensName}`)
  await response.body?.cancel()
}
const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com') })
const abi = parseAbi(['function setText(bytes name,string key,string value)', 'function multicall(bytes[] calls) returns(bytes[])', 'function findResolver(bytes name) view returns(address,bytes32,uint256)'])
const dns = name => toHex(packetToBytes(name))
const entries = [
  { name: NAMEFLOW_NAMESPACE, key: DIRECTORY_KEY, value: JSON.stringify({ version: 1, chainId: sepolia.id, pools: seed.pools.map(p => p.ensName), wallets: seed.wallets.map(w => w.name) }) },
  ...seed.pools.map(({ address, ensName, avatar, ...metadata }) => ({ name: ensName, key: POOL_METADATA_KEY, value: JSON.stringify(metadata) })),
  ...seed.pools.filter(p => p.avatar).map(p => ({ name: p.ensName, key: 'avatar', value: p.avatar })),
]
if (await client.getChainId() !== sepolia.id) throw Error('Wrong network')
const [resolver] = await client.readContract({ address: sepolia.contracts.ensUniversalResolver.address, abi, functionName: 'findResolver', args: [dns(NAMEFLOW_NAMESPACE)] })
for (const identity of [...seed.pools.map(p => ({ name: p.ensName, address: p.address })), ...seed.wallets]) {
  const resolved = await client.getEnsAddress({ name: identity.name })
  if (resolved?.toLowerCase() !== identity.address.toLowerCase()) throw Error(`Address mismatch: ${identity.name}`)
}
const changed = []
for (const entry of entries) {
  if (await client.getEnsText({ name: entry.name, key: entry.key }) !== entry.value) changed.push(entry)
}
console.log(`Directory verified; ${changed.length} records need publication`)
if (!changed.length) process.exit(0)
if (!process.env.SEPOLIA_PRIVATE_KEY) throw Error('Set SEPOLIA_PRIVATE_KEY locally to publish')
const account = privateKeyToAccount(process.env.SEPOLIA_PRIVATE_KEY)
const wallet = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com') })
const request = { account, address: resolver, abi, functionName: 'multicall', args: [changed.map(e => encodeFunctionData({ abi, functionName: 'setText', args: [dns(e.name), e.key, e.value] }))] }
await client.simulateContract(request)
const hash = await wallet.writeContract(request)
console.log('Submitted', hash)
const receipt = await client.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success') throw Error('Publication reverted')
for (const e of changed) if (await client.getEnsText({ name: e.name, key: e.key }) !== e.value) throw Error(`Verification failed: ${e.name} ${e.key}`)
fs.writeFileSync(`${os.homedir()}/.config/nameflow/directory-publication-evidence.json`, JSON.stringify({ hash, block: receipt.blockNumber.toString(), names: changed.map(e => ({name:e.name,key:e.key})), status: receipt.status }, null, 2))
console.log('All published records verified')
