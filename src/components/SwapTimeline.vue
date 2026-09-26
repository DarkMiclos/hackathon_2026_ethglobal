<template>
  <div ref="container" class="relative w-full h-full">
    <div
      ref="tooltip"
      class="pointer-events-none absolute z-10 hidden rounded-lg bg-surface-900/95 border border-surface-600 px-3 py-2 text-xs text-gray-200 shadow-xl whitespace-nowrap"
    />
    <div v-if="!swaps.length" class="absolute inset-0 flex items-center justify-center text-sm text-gray-500 pointer-events-none">
      Waiting for swaps…
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import { formatAmount, truncateAddr } from '@/config/pools'

const props = defineProps({
  swaps: { type: Array, default: () => [] },
  pools: { type: Array, default: () => [] },
  highlightedTrader: { type: String, default: '' },
  newSwapIds: { type: Array, default: () => [] },
})
const emit = defineEmits(['select-pool', 'select-trader'])

const BUY = '#22c55e'
const SELL = '#f59e0b'

const container = ref(null)
const tooltip = ref(null)
let ro = null
let timer = null

onMounted(() => {
  ro = new ResizeObserver(() => draw())
  ro.observe(container.value)
  timer = setInterval(draw, 10000) // keep "now" edge moving
  draw()
})
onUnmounted(() => { ro?.disconnect(); clearInterval(timer) })
watch(() => [props.swaps, props.highlightedTrader], draw, { deep: false })

function draw() {
  const el = container.value
  if (!el) return
  d3.select(el).selectAll('svg').remove()
  const { width, height } = el.getBoundingClientRect()
  if (width <= 0 || height <= 0 || !props.swaps.length) return

  const rows = props.pools.filter((p) => p.address)
  const margin = { top: 10, right: 16, bottom: 24, left: 96 }
  const w = width - margin.left - margin.right
  const h = height - margin.top - margin.bottom
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const now = Date.now()
  const times = props.swaps.map((s) => s.timestamp * 1000)
  const tMin = d3.min(times)
  const span = Math.max(now - tMin, 5 * 60_000)
  const x = d3.scaleTime().domain([now - span * 1.04, now + span * 0.02]).range([0, w])
  const y = d3.scaleBand().domain(rows.map((p) => p.address)).range([0, h]).paddingInner(0.2)
  const r = d3.scaleSqrt().domain([0, d3.max(props.swaps, (s) => s.valueUsdc) || 1]).range([3, Math.min(16, y.bandwidth() / 2.2)])

  // row bands + labels
  const band = g.selectAll('g.row').data(rows).enter().append('g').attr('class', 'row')
    .attr('transform', (p) => `translate(0,${y(p.address)})`)
    .style('cursor', 'pointer')
    .on('click', (_, p) => emit('select-pool', p))
  band.append('rect').attr('x', 0).attr('width', w).attr('height', y.bandwidth()).attr('fill', '#111827').attr('rx', 6)
  band.append('rect').attr('x', 0).attr('width', 3).attr('height', y.bandwidth()).attr('fill', (p) => p.color).attr('rx', 1.5)
  band.append('line').attr('x1', 0).attr('x2', w).attr('y1', y.bandwidth() / 2).attr('y2', y.bandwidth() / 2)
    .attr('stroke', '#1e293b').attr('stroke-dasharray', '2,4')
  band.append('text').attr('x', -10).attr('y', y.bandwidth() / 2 - 3).attr('text-anchor', 'end')
    .attr('fill', '#cbd5e1').attr('font-size', '10px').attr('font-weight', 600).text((p) => p.name)
  band.append('text').attr('x', -10).attr('y', y.bandwidth() / 2 + 9).attr('text-anchor', 'end')
    .attr('fill', '#64748b').attr('font-size', '8px')
    .text((p) => {
      const n = props.swaps.filter((s) => s.pool?.address === p.address).length
      return `${n} swap${n === 1 ? '' : 's'}`
    })

  // time axis
  g.append('g').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(w / 110))).tickFormat(d3.timeFormat('%H:%M')))
    .call((ax) => ax.select('.domain').attr('stroke', '#334155'))
    .call((ax) => ax.selectAll('line').attr('stroke', '#334155'))
    .selectAll('text').attr('fill', '#64748b').attr('font-size', '9px')

  // now marker
  g.append('line').attr('x1', x(now)).attr('x2', x(now)).attr('y1', 0).attr('y2', h)
    .attr('stroke', '#475569').attr('stroke-dasharray', '3,3')
  g.append('text').attr('x', x(now)).attr('y', -2).attr('text-anchor', 'end').attr('fill', '#64748b').attr('font-size', '8px').text('now')

  const tip = d3.select(tooltip.value)
  const focus = props.highlightedTrader
  const fresh = new Set(props.newSwapIds)

  // jitter per swap so overlapping dots spread vertically inside the band
  const jitter = (s, i) => (((i * 7919) % 11) / 10 - 0.5) * (y.bandwidth() - r(s.valueUsdc || 0) * 2) * 0.6

  const dots = g.selectAll('circle.swap').data(props.swaps.filter((s) => s.pool), (s) => s.id).enter().append('circle')
    .attr('class', 'swap')
    .attr('cx', (s) => x(s.timestamp * 1000))
    .attr('cy', (s, i) => y(s.pool.address) + y.bandwidth() / 2 + jitter(s, i))
    .attr('fill', (s) => (s.side === 'buy' ? BUY : SELL))
    .attr('fill-opacity', (s) => (focus ? (s.trader === focus ? 0.95 : 0.12) : 0.75))
    .attr('stroke', (s) => (focus && s.trader === focus ? '#fff' : s.pool.color))
    .attr('stroke-width', (s) => (focus && s.trader === focus ? 1.5 : 0.75))
    .style('cursor', 'pointer')
    .on('click', (event, s) => { event.stopPropagation(); emit('select-trader', s.trader) })
    .on('mousemove', (event, s) => {
      const [mx, my] = d3.pointer(event, container.value)
      tip.classed('hidden', false)
        .style('left', `${Math.min(mx + 12, width - 230)}px`).style('top', `${Math.max(my - 44, 0)}px`)
        .html(
          `<div style="color:${s.side === 'buy' ? BUY : SELL}" class="font-semibold">${s.side.toUpperCase()} ${s.pool.base.symbol} · ${s.pool.name}</div>` +
          `<div>${formatAmount(s.amountIn)} ${s.tokenIn.symbol} → ${formatAmount(s.amountOut)} ${s.tokenOut.symbol}</div>` +
          `<div class="text-gray-400">${truncateAddr(s.trader)} · ${d3.timeFormat('%H:%M:%S')(s.timestamp * 1000)} · block ${s.blockNumber}</div>`,
        )
    })
    .on('mouseleave', () => tip.classed('hidden', true))

  dots.attr('r', (s) => (fresh.has(s.id) ? 0 : r(s.valueUsdc || 0)))
  dots.filter((s) => fresh.has(s.id))
    .transition().duration(700).ease(d3.easeElasticOut.amplitude(1).period(0.5))
    .attr('r', (s) => r(s.valueUsdc || 0))
}
</script>
