<template>
  <div ref="container" class="relative w-full h-full">
    <div
      ref="tooltip"
      class="pointer-events-none absolute z-10 hidden rounded-lg bg-surface-900/95 border border-surface-600 px-3 py-2 text-xs text-gray-200 shadow-xl whitespace-nowrap"
    />
    <div class="absolute top-0 left-0 right-0 flex justify-between text-[10px] text-gray-500 pointer-events-none px-1">
      <span>traders</span><span>pools · width ∝ √USDC value</span><span>token received</span>
    </div>
    <div v-if="!swaps.length" class="absolute inset-0 flex items-center justify-center text-sm text-gray-500 pointer-events-none">
      Waiting for swaps…
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey'
import { formatAmount, truncateAddr } from '@/config/pools'

const props = defineProps({
  swaps: { type: Array, default: () => [] },  // enriched swaps with valueUsdc
  highlightedTrader: { type: String, default: '' },
})
const emit = defineEmits(['select-pool', 'select-trader'])

const container = ref(null)
const tooltip = ref(null)
let ro = null

onMounted(() => {
  ro = new ResizeObserver(() => draw())
  ro.observe(container.value)
  draw()
})
onUnmounted(() => ro?.disconnect())
watch(() => [props.swaps, props.highlightedTrader], draw, { deep: false })

function draw() {
  const el = container.value
  if (!el) return
  d3.select(el).selectAll('svg').remove()
  const { width, height } = el.getBoundingClientRect()
  if (width <= 0 || height <= 0 || !props.swaps.length) return

  const nodeMap = new Map()
  const linkMap = new Map()
  const addNode = (id, attrs) => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, ...attrs })
    return nodeMap.get(id)
  }
  const addLink = (source, target, value, meta) => {
    const key = `${source}→${target}`
    if (!linkMap.has(key)) linkMap.set(key, { source, target, value: 0, count: 0, ...meta })
    const l = linkMap.get(key)
    l.value += value
    l.count++
  }

  for (const s of props.swaps) {
    if (!s.pool || !s.trader) continue
    // sqrt scaling: link width grows with value but one whale cannot flatten every other flow
    const v = Math.sqrt(Math.max(s.valueUsdc || 0, 0.000001))
    const tId = `t:${s.trader}`
    const pId = `p:${s.pool.address}`
    const kId = `k:${s.tokenOut.symbol}`
    addNode(tId, { kind: 'trader', label: s.traderName || truncateAddr(s.trader), address: s.trader, color: '#3b82f6' })
    addNode(pId, { kind: 'pool', label: s.pool.name, pool: s.pool, color: s.pool.color })
    addNode(kId, { kind: 'token', label: s.tokenOut.symbol, color: s.tokenOut.color })
    addLink(tId, pId, v, { color: s.pool.color, trader: s.trader, pool: s.pool })
    addLink(pId, kId, v, { color: s.tokenOut.color, pool: s.pool, token: s.tokenOut.symbol })
  }

  const graph = sankey()
    .nodeId((d) => d.id)
    .nodeWidth(12)
    .nodePadding(Math.max(6, Math.min(18, height / (nodeMap.size + 2))))
    .nodeAlign(sankeyJustify)
    .nodeSort((a, b) => b.value - a.value)
    .extent([[Math.min(190, Math.round(width * 0.18)), 16], [width - 70, height - 6]])({
      nodes: [...nodeMap.values()].map((n) => ({ ...n })),
      links: [...linkMap.values()].map((l) => ({ ...l })),
    })

  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height)
  const tip = d3.select(tooltip.value)
  const focus = props.highlightedTrader

  const link = svg.append('g').attr('fill', 'none').selectAll('path').data(graph.links).enter().append('path')
    .attr('d', sankeyLinkHorizontal())
    .attr('stroke', (d) => d.color)
    .attr('stroke-width', (d) => Math.max(1, d.width))
    .attr('stroke-opacity', (d) => (focus ? (touchesTrader(d, focus) ? 0.75 : 0.06) : 0.4))
    .style('cursor', 'pointer')
    .on('mouseenter', function () { d3.select(this).attr('stroke-opacity', 0.85) })
    .on('mousemove', (event, d) => {
      const [mx, my] = d3.pointer(event, container.value)
      tip.classed('hidden', false)
        .style('left', `${Math.min(mx + 12, width - 200)}px`).style('top', `${Math.max(my - 30, 0)}px`)
        .html(`<b>${d.source.label}</b> → <b>${d.target.label}</b><br>${d.count} swaps · ${formatAmount(d.value * d.value, 0)} USDC`)
    })
    .on('mouseleave', function (_, d) {
      d3.select(this).attr('stroke-opacity', focus ? (touchesTrader(d, focus) ? 0.75 : 0.06) : 0.4)
      tip.classed('hidden', true)
    })

  const node = svg.append('g').selectAll('g').data(graph.nodes).enter().append('g')
    .style('cursor', (d) => (d.kind === 'token' ? 'default' : 'pointer'))
    .attr('opacity', (d) => (focus && d.kind === 'trader' && d.address !== focus ? 0.3 : 1))
    .on('click', (_, d) => {
      if (d.kind === 'pool') emit('select-pool', d.pool)
      if (d.kind === 'trader') emit('select-trader', d.address)
    })
    .on('mousemove', (event, d) => {
      const [mx, my] = d3.pointer(event, container.value)
      tip.classed('hidden', false)
        .style('left', `${Math.min(mx + 12, width - 200)}px`).style('top', `${Math.max(my - 30, 0)}px`)
        .html(`<b>${d.kind === 'trader' ? d.address : d.label}</b><br>${d.kind === 'pool' ? `${d.pool.fee / 10000}% fee · ` : ''}width ∝ √value`)
    })
    .on('mouseleave', () => tip.classed('hidden', true))

  node.append('rect')
    .attr('x', (d) => d.x0).attr('y', (d) => d.y0)
    .attr('width', (d) => d.x1 - d.x0).attr('height', (d) => Math.max(1, d.y1 - d.y0))
    .attr('fill', (d) => d.color).attr('rx', 2)
    .attr('stroke', (d) => (focus && d.address === focus ? '#fff' : 'none'))

  node.append('text')
    .attr('x', (d) => (d.x0 < width / 2 ? d.x0 - 6 : d.x1 + 6))
    .attr('y', (d) => (d.y0 + d.y1) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', (d) => (d.x0 < width / 2 ? 'end' : 'start'))
    .attr('font-size', (d) => (d.kind === 'pool' ? '10px' : '9px'))
    .attr('font-family', (d) => (d.kind === 'trader' ? 'JetBrains Mono, monospace' : 'Inter, sans-serif'))
    .attr('font-weight', (d) => (d.kind === 'trader' ? 400 : 600))
    .attr('fill', (d) => (d.kind === 'trader' ? '#94a3b8' : '#e2e8f0'))
    .text((d) => d.label)
    .filter((d) => d.kind === 'pool')
    .attr('x', (d) => (d.x0 + d.x1) / 2)
    .attr('y', (d) => d.y0 - 5)
    .attr('text-anchor', 'middle')

  void link
}

function touchesTrader(l, trader) {
  return l.trader === trader || (l.source.kind === 'pool' && l.source.sourceLinks?.some((x) => x.trader === trader))
}
</script>
