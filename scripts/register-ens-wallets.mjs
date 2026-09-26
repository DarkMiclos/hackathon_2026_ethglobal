import fs from 'node:fs'
import os from 'node:os'
import { createPublicClient, createWalletClient, http, parseAbi, toHex, zeroAddress, keccak256, encodeAbiParameters, encodeFunctionData, getCreate2Address, concat, namehash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { packetToBytes, normalize } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { NAMEFLOW_NAMESPACE, LOOKUP_KEY } from '../src/config/ens.js'

const targets = JSON.parse(fs.readFileSync(process.env.NAMEFLOW_WALLETS_FILE || `${os.homedir()}/.config/nameflow/bob-wallets.json`, 'utf8'))
const account = privateKeyToAccount(process.env.SEPOLIA_PRIVATE_KEY)
const transport = http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com')
const client = createPublicClient({ chain: sepolia, transport })
const wallet = createWalletClient({ account, chain: sepolia, transport })
const helper = '0x33f571aa8a160a21b877cf6e0fb8806692b97df5'
const factory = '0x9e726eb570beb6bceb495ab8cda7df517d4e841c'
const implementation = '0xa80338aaa8d23831cea25e858d1774534abb0263'
const navAbi = parseAbi(['function findParentRegistry(bytes name) view returns(address)', 'function findExactOwner(bytes name) view returns(address)', 'function findResolver(bytes name) view returns(address,bytes32,uint256)'])
const registryAbi = parseAbi([
  'function initialize((address account,uint256 roleBitmap)[] grants)',
  'function getSubregistry(string label) view returns(address)',
  'function getResolver(string label) view returns(address)',
  'function getExpiry(uint256 anyId) view returns(uint64)',
  'function findOwner(string label) view returns(address)',
  'function getStatus(uint256 anyId) view returns(uint8)',
  'function getParent() view returns(address parent,string label)',
  'function setParent(address parent,string label)',
  'function setSubregistry(uint256 anyId,address registry)',
  'function register(string label,address owner,address registry,address resolver,uint256 roleBitmap,uint64 expiry) returns(uint256)',
])
const factoryAbi = parseAbi(['function proxyLogic() view returns(address)', 'function deployProxy(address implementation,uint256 salt,bytes data) returns(address)', 'function verifyContract(address proxy) view returns(address)'])
const resolverAbi = parseAbi(['function setAddress(bytes name,uint256 coinType,bytes addressBytes)', 'function setText(bytes name,string key,string value)', 'function multicall(bytes[] calls) returns(bytes[])'])
const dns = name => toHex(packetToBytes(normalize(name)))
const id = label => BigInt(keccak256(toHex(label)))
const regular = 1n | (1n << 8n) | (1n << 16n) | (1n << 20n) | (1n << 24n)
const roles = regular | (regular << 128n) | (1n << 156n)
const evidence = []
async function write(address, abi, functionName, args) {
  const request = { account, address, abi, functionName, args }
  await client.simulateContract(request)
  const hash = await wallet.writeContract(request)
  console.log(functionName, hash)
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw Error('Registration reverted')
  evidence.push({ functionName, hash })
}
const read = (address, functionName, args=[]) => client.readContract({ address, abi: registryAbi, functionName, args })
if (await client.getChainId() !== sepolia.id) throw Error('Wrong chain')
const owner = await client.readContract({address:helper,abi:navAbi,functionName:'findExactOwner',args:[dns(NAMEFLOW_NAMESPACE)]})
if (owner.toLowerCase() !== account.address.toLowerCase()) throw Error('Publisher does not own namespace')
const parentRegistry = await client.readContract({address:helper,abi:navAbi,functionName:'findParentRegistry',args:[dns(NAMEFLOW_NAMESPACE)]})
const [resolver] = await client.readContract({address:sepolia.contracts.ensUniversalResolver.address,abi:navAbi,functionName:'findResolver',args:[dns(NAMEFLOW_NAMESPACE)]})
const expiry = await read(parentRegistry,'getExpiry',[id(NAMEFLOW_NAMESPACE.split('.')[0])])
async function ensureRegistry(fullName, containingRegistry, label) {
  let registry = await read(containingRegistry,'getSubregistry',[label])
  if (registry === zeroAddress) {
    const salt = BigInt(keccak256(encodeAbiParameters([{type:'bytes32'},{type:'bytes32'},{type:'uint256'}],[keccak256(toHex('UserRegistry')),namehash(fullName),0n])))
    const logic = await client.readContract({address:factory,abi:factoryAbi,functionName:'proxyLogic'})
    const outerSalt = keccak256(encodeAbiParameters([{type:'address'},{type:'uint256'}],[account.address,salt]))
    registry = getCreate2Address({from:factory,salt:outerSalt,bytecodeHash:keccak256(concat(['0x3d604d80600a3d3981f3363d3d373d3d3d363d73',logic,'0x5af43d82803e903d91602b57fd5bf3',outerSalt]))})
    const code = await client.getCode({address:registry})
    if (!code || code === '0x') {
      const init = encodeFunctionData({abi:registryAbi,functionName:'initialize',args:[[{account:account.address,roleBitmap:roles}]]})
      await write(factory,factoryAbi,'deployProxy',[implementation,salt,init])
    }
    const actual = await client.readContract({address:factory,abi:factoryAbi,functionName:'verifyContract',args:[registry]})
    if (actual.toLowerCase() !== implementation.toLowerCase()) throw Error('Unexpected registry implementation')
    await write(containingRegistry,registryAbi,'setSubregistry',[id(label),registry])
  }
  const [parent,currentLabel] = await read(registry,'getParent')
  if (parent === zeroAddress) await write(registry,registryAbi,'setParent',[containingRegistry,label])
  else if (parent.toLowerCase() !== containingRegistry.toLowerCase() || currentLabel !== label) throw Error('Registry mounted elsewhere')
  return registry
}
async function ensureName(registry,name,label) {
  const existing = await read(registry,'findOwner',[label])
  if (existing === zeroAddress) {
    if (await read(registry,'getStatus',[id(label)]) !== 0) throw Error(`Reserved name: ${name}`)
    await write(registry,registryAbi,'register',[label,account.address,zeroAddress,resolver,roles,expiry])
  } else if (existing.toLowerCase() !== account.address.toLowerCase() || (await read(registry,'getResolver',[label])).toLowerCase() !== resolver.toLowerCase()) throw Error(`Unexpected owner or resolver: ${name}`)
}
const root = await ensureRegistry(NAMEFLOW_NAMESPACE,parentRegistry,NAMEFLOW_NAMESPACE.split('.')[0])
const parents = [...new Set(targets.map(t=>normalize(t.name).split('.').slice(1).join('.')))]
for (const parent of parents) {
  if (parent.split('.').slice(1).join('.') !== NAMEFLOW_NAMESPACE) throw Error('Wallet parent must be a direct namespace child')
  const label = parent.split('.')[0]
  await ensureName(root,parent,label)
  const registry = await ensureRegistry(parent,root,label)
  for (const target of targets.filter(t=>t.name.endsWith(`.${parent}`))) {
    await ensureName(registry,target.name,target.name.split('.')[0])
  }
}
const calls = []
for (const target of targets) {
  const [route] = await client.readContract({address:sepolia.contracts.ensUniversalResolver.address,abi:navAbi,functionName:'findResolver',args:[dns(target.name)]})
  if (route.toLowerCase() !== resolver.toLowerCase()) throw Error('Unexpected resolver route')
  if ((await client.getEnsAddress({name:target.name}))?.toLowerCase() !== target.address.toLowerCase()) calls.push(encodeFunctionData({abi:resolverAbi,functionName:'setAddress',args:[dns(target.name),60n,target.address]}))
  const lookup = `${target.address.slice(2).toLowerCase()}.lookup.${NAMEFLOW_NAMESPACE}`
  if (await client.getEnsText({name:lookup,key:LOOKUP_KEY}) !== target.name) calls.push(encodeFunctionData({abi:resolverAbi,functionName:'setText',args:[dns(lookup),LOOKUP_KEY,target.name]}))
}
if (calls.length) await write(resolver,resolverAbi,'multicall',[calls])
for (const target of targets) {
  if ((await client.getEnsAddress({name:target.name}))?.toLowerCase() !== target.address.toLowerCase()) throw Error(`Forward verification failed: ${target.name}`)
  console.log('PASS',target.name,target.address)
}
fs.writeFileSync(`${os.homedir()}/.config/nameflow/bob-registration-evidence.json`,JSON.stringify({targets,transactions:evidence},null,2))
