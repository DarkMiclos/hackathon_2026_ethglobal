const localIcons = {
  'USDC-WETH': '/pool-avatars/weth-usdc-3000.png',
  'UNI-WETH': '/pool-avatars/weth-uni-3000.png',
  'UNI-USDC': '/pool-avatars/usdc-uni-3000.png',
}

export function poolIcon(pool) {
  if (!pool) return null
  if (pool.avatar) return pool.avatar
  const pair = [pool.token0?.symbol, pool.token1?.symbol].sort().join('-')
  return localIcons[pair] || null
}
