<template>
  <div ref="container" class="relative w-full h-full select-none">
    <div
      ref="tooltip"
      class="pointer-events-none absolute z-10 hidden rounded-lg bg-surface-900/95 border border-surface-600 px-3 py-2 text-xs text-gray-200 shadow-xl whitespace-nowrap"
    />
    <div class="absolute bottom-2 left-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500 pointer-events-none">
      <span class="flex items-center gap-1"><span class="inline-block w-4 h-0.5" :style="{ background: BUY }" /> buy: pool → trader</span>
      <span class="flex items-center gap-1"><span class="inline-block w-4 h-0.5" :style="{ background: SELL }" /> sell: trader → pool</span>
      <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full bg-accent-blue" /> trader (size = volume)</span>
      <span class="text-gray-600">drag · scroll to zoom · click pool to focus</span>
    </div>
    <div v-if="!swaps.length" class="absolute inset-0 flex items-center justify-center text-sm text-gray-500 pointer-events-none">
      Waiting for swaps…
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import { poolIcon } from '@/utils/poolIcon'
import { formatAmount, truncateAddr } from '@/config/pools'

const props = defineProps({
  swaps: { type: Array, default: () => [] },         // enriched swaps
  pools: { type: Array, default: () => [] },         // POOLS metadata
  activePool: { type: Object, default: null },
  highlightedTrader: { type: String, default: '' },
  newSwapIds: { type: Array, default: () => [] },
})

const emit = defineEmits(['select-pool', 'select-trader'])

const BUY = '#22c55e'
const SELL = '#f59e0b'

const container = ref(null)
const tooltip = ref(null)

let svg = null
let root = null
let simulation = null
let resizeObs = null
let W = 0
let H = 0
let nodeSel = null
let linkSel = null
let zoom = null

const nodeCache = new Map()     // id -> node object (positions survive re-renders)
const animatedIds = new Set()   // swap ids that already got a particle
let hoverId = null

onMounted(() => {
  const el = container.value
  if (!el) return
  resizeObs = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect
    if (width < 50 || height < 50) return
    const sizeChanged = Math.abs(width - W) > 4 || Math.abs(height - H) > 4
    W = width
    H = height
    if (!svg) initGraph()
    else if (sizeChanged) {
      svg.attr('viewBox', `0 0 ${W} ${H}`)
      simulation.force('center', d3.forceCenter(W / 2, H / 2))
      updateGraph()
    }
  })
  resizeObs.observe(el)
})

onUnmounted(() => {
  simulation?.stop()
  resizeObs?.disconnect()
})

watch(() => props.swaps, () => updateGraph())
watch(() => props.activePool, () => updateGraph())
watch(() => props.highlightedTrader, () => applyEmphasis())

function initGraph() {
  const el = container.value
  d3.select(el).select('svg').remove()

  svg = d3.select(el).append('svg')
    .attr('width', '100%').attr('height', '100%')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')

  const defs = svg.append('defs')
  for (const [id, color] of [['arrow-sell', SELL], ['arrow-buy', BUY]]) {
    defs.append('marker')
      .attr('id', id).attr('viewBox', '0 -4 8 8')
      .attr('refX', 7).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-3L7,0L0,3Z').attr('fill', color)
  }
  const glow = defs.append('filter').attr('id', 'node-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
  glow.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'blur')
  const merge = glow.append('feMerge')
  merge.append('feMergeNode').attr('in', 'blur')
  merge.append('feMergeNode').attr('in', 'SourceGraphic')

  root = svg.append('g').attr('class', 'root')
  root.append('g').attr('class', 'links')
  root.append('g').attr('class', 'particles')
  root.append('g').attr('class', 'nodes')

  zoom = d3.zoom().scaleExtent([0.4, 3]).on('zoom', (event) => root.attr('transform', event.transform))
  svg.call(zoom).on('dblclick.zoom', null)
  svg.on('click', (event) => {
    if (event.target === svg.node()) emit('select-trader', '')
  })

  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id((d) => d.id).distance((l) => 90 + Math.min(60, l.value / 5000)).strength(0.6))
    .force('charge', d3.forceManyBody().strength((d) => (d.type === 'pool' ? -600 : -180)))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide().radius((d) => d.r + 10))
    .alphaDecay(0.04)

  updateGraph()
}

function poolAnchor(index, count) {
  if (count <= 1) return { x: W / 2, y: H / 2 }
  const radius = Math.min(W, H) * 0.26
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
  return { x: W / 2 + Math.cos(angle) * radius, y: H / 2 + Math.sin(angle) * radius }
}

function updateGraph() {
  if (!svg) return
  const tip = d3.select(tooltip.value)

  const poolMap = new Map()
  const walletMap = new Map()
  const linkMap = new Map()

  for (const s of props.swaps) {
    if (!s.pool || !s.trader) continue
    const poolId = s.pool.address
    const value = s.valueUsdc || 0

    if (!poolMap.has(poolId)) {
      poolMap.set(poolId, { id: poolId, type: 'pool', pool: s.pool, label: s.pool.name, volume: 0, buyVol: 0, sellVol: 0, count: 0 })
    }
    if (!walletMap.has(s.trader)) {
      walletMap.set(s.trader, { id: s.trader, type: 'wallet', label: s.traderName || truncateAddr(s.trader), volume: 0, count: 0, pools: new Set() })
    }
    const p = poolMap.get(poolId)
    const t = walletMap.get(s.trader)
    p.volume += value; p.count++
    if (s.side === 'buy') p.buyVol += value; else p.sellVol += value
    t.volume += value; t.count++; t.pools.add(poolId)

    const key = `${s.trader}|${poolId}|${s.side}`
    if (!linkMap.has(key)) {
      linkMap.set(key, {
        id: key,
        source: s.side === 'sell' ? s.trader : poolId,
        target: s.side === 'sell' ? poolId : s.trader,
        trader: s.trader,
        pool: poolId,
        side: s.side,
        value: 0,
        count: 0,
      })
    }
    const l = linkMap.get(key)
    l.value += value
    l.count++
  }

  const poolRadius = d3.scaleSqrt().domain([0, d3.max([...poolMap.values()], (d) => d.volume) || 1]).range([22, 40])
  const walletRadius = d3.scaleSqrt().domain([0, d3.max([...walletMap.values()], (d) => d.volume) || 1]).range([6, 16])
  const linkWidth = d3.scaleSqrt().domain([0, d3.max([...linkMap.values()], (d) => d.value) || 1]).range([1.2, 5])

  // Merge into cached node objects so positions persist between polls
  const pools = props.pools.filter((p) => poolMap.has(p.address))
  const nodes = []
  let added = 0
  pools.forEach((poolMeta, i) => {
    const fresh = poolMap.get(poolMeta.address)
    let node = nodeCache.get(fresh.id)
    const anchor = poolAnchor(i, pools.length)
    if (!node) {
      node = { ...fresh, x: anchor.x, y: anchor.y }
      nodeCache.set(node.id, node)
      added++
    } else {
      Object.assign(node, fresh)
    }
    if (!node.dragged) { node.fx = anchor.x; node.fy = anchor.y }
    node.r = poolRadius(node.volume)
    nodes.push(node)
  })
  for (const fresh of walletMap.values()) {
    let node = nodeCache.get(fresh.id)
    if (!node) {
      // spawn next to the first pool it traded in
      const firstPool = nodeCache.get([...fresh.pools][0])
      node = {
        ...fresh,
        x: (firstPool?.x ?? W / 2) + (Math.random() - 0.5) * 80,
        y: (firstPool?.y ?? H / 2) + (Math.random() - 0.5) * 80,
      }
      nodeCache.set(node.id, node)
      added++
    } else {
      Object.assign(node, fresh)
    }
    node.r = walletRadius(node.volume)
    nodes.push(node)
  }
  const links = [...linkMap.values()]

  // ---- links
  linkSel = root.select('.links').selectAll('path').data(links, (d) => d.id)
  linkSel.exit().transition().duration(300).attr('stroke-opacity', 0).remove()
  const linkEnter = linkSel.enter().append('path')
    .attr('fill', 'none')
    .attr('stroke-opacity', 0)
  linkSel = linkEnter.merge(linkSel)
  linkSel
    .attr('stroke', (d) => (d.side === 'sell' ? SELL : BUY))
    .attr('stroke-width', (d) => linkWidth(d.value))
    .attr('marker-end', (d) => (d.side === 'sell' ? 'url(#arrow-sell)' : 'url(#arrow-buy)'))

  // ---- nodes
  nodeSel = root.select('.nodes').selectAll('g.node').data(nodes, (d) => d.id)
  nodeSel.exit().transition().duration(300).attr('opacity', 0).remove()

  const nodeEnter = nodeSel.enter().append('g')
    .attr('class', 'node')
    .attr('cursor', 'pointer')
    .attr('opacity', 0)
    .call(d3.drag().on('start', dragStarted).on('drag', dragged).on('end', dragEnded))
  nodeEnter.append('circle').attr('class', 'halo')
  nodeEnter.append('circle').attr('class', 'main')
  nodeEnter.append('path').attr('class', 'pie-buy')
  nodeEnter.append('path').attr('class', 'pie-sell')
  nodeEnter.append('image').attr('class', 'pool-icon').attr('preserveAspectRatio', 'xMidYMid slice').attr('pointer-events', 'none')
  nodeEnter.append('text').attr('class', 'label').attr('text-anchor', 'middle').attr('pointer-events', 'none')
  nodeEnter.append('text').attr('class', 'sub').attr('text-anchor', 'middle').attr('pointer-events', 'none')
  nodeEnter.transition().duration(400).attr('opacity', 1)

  nodeSel = nodeEnter.merge(nodeSel)

  nodeSel.select('.halo')
    .attr('r', (d) => d.r + 4)
    .attr('fill', 'none')
    .attr('stroke', (d) => (d.type === 'pool' ? d.pool.color : '#3b82f6'))
    .attr('stroke-opacity', 0)
    .attr('stroke-width', 2)

  nodeSel.select('.main')
    .transition().duration(400)
    .attr('r', (d) => d.r)
    .attr('fill', (d) => (d.type === 'pool' ? '#0e1a2b' : '#3b82f6'))
    .attr('stroke', (d) => (d.type === 'pool' ? d.pool.color : '#1e3a5f'))
    .attr('stroke-width', (d) => (d.type === 'pool' ? 2.5 : 1.5))

  const arc = d3.arc()
  nodeSel.select('.pie-buy')
    .attr('fill', BUY).attr('opacity', 0.75)
    .attr('d', (d) => {
      if (d.type !== 'pool' || !d.volume || poolIcon(d.pool)) return null
      const r = d.r * 0.72
      return arc({ innerRadius: r * 0.45, outerRadius: r, startAngle: 0, endAngle: (d.buyVol / d.volume) * Math.PI * 2 })
    })
  nodeSel.select('.pie-sell')
    .attr('fill', SELL).attr('opacity', 0.75)
    .attr('d', (d) => {
      if (d.type !== 'pool' || !d.volume || poolIcon(d.pool)) return null
      const r = d.r * 0.72
      return arc({ innerRadius: r * 0.45, outerRadius: r, startAngle: (d.buyVol / d.volume) * Math.PI * 2, endAngle: Math.PI * 2 })
    })

  nodeSel.select('.pool-icon')
    .attr('href', d => d.type === 'pool' ? poolIcon(d.pool) : null)
    .attr('display', d => d.type === 'pool' && poolIcon(d.pool) ? null : 'none')
    .attr('x', d => -d.r).attr('y', d => -d.r)
    .attr('width', d => d.r * 2).attr('height', d => d.r * 2)
    .style('clip-path', 'circle(50%)')

  nodeSel.select('.label')
    .text((d) => d.label)
    .attr('font-size', (d) => (d.type === 'pool' ? '11px' : '8px'))
    .attr('font-weight', (d) => (d.type === 'pool' ? 600 : 400))
    .attr('font-family', (d) => (d.type === 'pool' ? 'Inter, sans-serif' : 'JetBrains Mono, monospace'))
    .attr('fill', (d) => (d.type === 'pool' ? '#e2e8f0' : '#94a3b8'))
    .attr('y', (d) => d.r + 12)

  nodeSel.select('.sub')
    .text((d) => (d.type === 'pool' ? `${d.count} swaps · ${formatAmount(d.volume, 0)} USDC` : ''))
    .attr('font-size', '8px').attr('fill', '#64748b')
    .attr('y', (d) => d.r + 22)

  nodeSel
    .on('mouseenter', (event, d) => { hoverId = d.id; applyEmphasis(); showTip(event, d) })
    .on('mousemove', (event, d) => showTip(event, d))
    .on('mouseleave', () => { hoverId = null; applyEmphasis(); tip.classed('hidden', true) })
    .on('click', (event, d) => {
      event.stopPropagation()
      if (d.type === 'pool') emit('select-pool', d.pool)
      else emit('select-trader', d.id)
    })

  simulation.nodes(nodes).on('tick', ticked)
  simulation.force('link').links(links)
  simulation.alpha(added ? 0.6 : 0.15).restart()

  applyEmphasis()
  animateNewSwaps()
}

function ticked() {
  linkSel?.attr('d', linkArc)
  nodeSel?.attr('transform', (d) => `translate(${d.x},${d.y})`)
}

/** Curved path from the edge of the source circle to the edge of the target circle. */
function linkArc(d) {
  const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y
  const dx = tx - sx, dy = ty - sy
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const sr = d.source.r || 8, tr = (d.target.r || 8) + 4
  const ux = dx / dist, uy = dy / dist
  const x1 = sx + ux * sr, y1 = sy + uy * sr
  const x2 = tx - ux * tr, y2 = ty - uy * tr
  const dr = dist * 1.6
  const sweep = d.side === 'sell' ? 1 : 0
  return `M${x1},${y1}A${dr},${dr} 0 0,${sweep} ${x2},${y2}`
}

function applyEmphasis() {
  if (!nodeSel || !linkSel) return
  const focus = hoverId || props.highlightedTrader || null
  if (!focus) {
    nodeSel.transition('emph').duration(200).attr('opacity', 1)
    linkSel.transition('emph').duration(200).attr('stroke-opacity', 0.55)
    nodeSel.select('.halo').attr('stroke-opacity', 0)
    return
  }
  const neighbours = new Set([focus])
  linkSel.each((l) => {
    if (l.trader === focus || l.pool === focus) { neighbours.add(l.trader); neighbours.add(l.pool) }
  })
  nodeSel.transition('emph').duration(200).attr('opacity', (d) => (neighbours.has(d.id) ? 1 : 0.15))
  linkSel.transition('emph').duration(200).attr('stroke-opacity', (l) => (l.trader === focus || l.pool === focus ? 0.9 : 0.06))
  nodeSel.select('.halo').attr('stroke-opacity', (d) => (d.id === focus ? 0.9 : 0))
}

function showTip(event, d) {
  const tip = d3.select(tooltip.value)
  const [mx, my] = d3.pointer(event, container.value)
  const html = d.type === 'pool'
    ? `<div class="font-semibold" style="color:${d.pool.color}">${d.pool.name}</div>` +
      `<div>${d.count} swaps · ${formatAmount(d.volume, 0)} USDC</div>` +
      `<div><span style="color:${BUY}">buy ${formatAmount(d.buyVol, 0)}</span> · <span style="color:${SELL}">sell ${formatAmount(d.sellVol, 0)}</span></div>` +
      `<div class="text-gray-500">click to focus this pool</div>`
    : `<div class="font-mono text-gray-100">${d.id}</div>` +
      `<div>${d.count} swaps · ${formatAmount(d.volume, 0)} USDC · ${d.pools.size} pool${d.pools.size === 1 ? '' : 's'}</div>` +
      `<div class="text-gray-500">click to highlight trader</div>`
  tip.classed('hidden', false)
    .style('left', `${Math.min(mx + 14, W - 220)}px`)
    .style('top', `${Math.max(my - 10, 0)}px`)
    .html(html)
}

/** Particle along the link + pulse ring on the pool for each newly arrived swap. */
function animateNewSwaps() {
  const fresh = props.swaps.filter((s) => props.newSwapIds.includes(s.id) && !animatedIds.has(s.id) && s.pool && s.trader)
  if (!fresh.length) return
  fresh.forEach((s, i) => {
    animatedIds.add(s.id)
    setTimeout(() => fireParticle(s), i * 180)
  })
}

function fireParticle(s) {
  if (!linkSel) return
  const key = `${s.trader}|${s.pool.address}|${s.side}`
  const pathEl = linkSel.filter((l) => l.id === key).node()
  if (!pathEl) return
  const color = s.side === 'sell' ? SELL : BUY
  const particle = root.select('.particles').append('circle')
    .attr('r', 4).attr('fill', color).attr('filter', 'url(#node-glow)')
  particle.transition().duration(1100).ease(d3.easeCubicInOut)
    .attrTween('transform', () => (t) => {
      const len = pathEl.getTotalLength()
      const p = pathEl.getPointAtLength(t * len)
      return `translate(${p.x},${p.y})`
    })
    .on('end', () => { particle.remove(); pulse(s.pool.address, color) })
}

function pulse(nodeId, color) {
  const g = nodeSel.filter((d) => d.id === nodeId)
  if (g.empty()) return
  const r = g.datum().r
  g.append('circle').attr('r', r).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 3).attr('stroke-opacity', 0.9)
    .transition().duration(900).ease(d3.easeCubicOut)
    .attr('r', r * 2.2).attr('stroke-opacity', 0).remove()
}

function dragStarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.25).restart()
  d.fx = d.x; d.fy = d.y
}
function dragged(event, d) {
  d.fx = event.x; d.fy = event.y
}
function dragEnded(event, d) {
  if (!event.active) simulation.alphaTarget(0)
  if (d.type === 'pool') { d.dragged = true } else { d.fx = null; d.fy = null }
}
</script>
