// Adapted from Boring Avatars' Bauhaus renderer; see licenses/boring-avatars-MIT.txt.
const colors = ['#651366', '#a71a5b', '#e7204e', '#f76e2a', '#f0c505']
const cache = new Map()
const digit = (number, index) => Math.floor(number / 10 ** index % 10)
const unit = (number, range, index) => number % range * (index && digit(number, index) % 2 === 0 ? -1 : 1)

export function walletAvatar(address) {
  const seed = (address || '').toLowerCase()
  if (!seed) return null
  if (cache.has(seed)) return cache.get(seed)
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  hash = Math.abs(hash)
  const properties = Array.from({ length: 4 }, (_, i) => ({
    color: colors[(hash + i) % colors.length],
    x: unit(hash * (i + 1), 40 - (i + 17), 1),
    y: unit(hash * (i + 1), 40 - (i + 17), 2),
    rotate: unit(hash * (i + 1), 360),
  }))
  const [background, shape, circle, line] = properties
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none"><defs><clipPath id="round"><circle cx="40" cy="40" r="40"/></clipPath></defs><g clip-path="url(#round)"><rect width="80" height="80" fill="${background.color}"/><rect x="10" y="30" width="80" height="${digit(hash, 2) % 2 === 0 ? 80 : 10}" fill="${shape.color}" transform="translate(${shape.x} ${shape.y}) rotate(${shape.rotate} 40 40)"/><circle cx="40" cy="40" r="16" fill="${circle.color}" transform="translate(${circle.x} ${circle.y})"/><line x1="0" y1="40" x2="80" y2="40" stroke-width="2" stroke="${line.color}" transform="translate(${line.x} ${line.y}) rotate(${line.rotate} 40 40)"/></g></svg>`
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
  cache.set(seed, url)
  return url
}
