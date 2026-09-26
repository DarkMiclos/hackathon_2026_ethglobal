import fs from 'node:fs/promises'
import { NAMEFLOW_NAMESPACE } from '../src/config/ens.js'
const source = (await fs.readFile(new URL('../src/composables/useEns.js', import.meta.url), 'utf8'))
  .replace("from 'viem'", `from '${import.meta.resolve('viem')}'`)
  .replace("from 'viem/chains'", `from '${import.meta.resolve('viem/chains')}'`)
  .replace("from 'viem/ens'", `from '${import.meta.resolve('viem/ens')}'`)
  .replace("from 'vue'", `from '${import.meta.resolve('vue')}'`)
  .replace("from '@/config/ens'", `from '${new URL('../src/config/ens.js', import.meta.url)}'`)
  .replace('import.meta.env.VITE_SEPOLIA_RPC_URL', 'process.env.SEPOLIA_RPC_URL')
const { useEns } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const { loadDirectory, resolveAddress } = useEns()
const directory = await loadDirectory()
if (!directory.pools.length) throw Error('No pools returned from ENS')
console.log(`Directory read from ${NAMEFLOW_NAMESPACE}`)
for (const entry of [...directory.pools, ...directory.wallets]) {
  if (await resolveAddress(entry.address) !== entry.ensName) throw Error(`Lookup mismatch: ${entry.ensName}`)
  console.log(`PASS ${entry.ensName} -> ${entry.address}${entry.avatar ? ' avatar resolved' : ''}`)
}
