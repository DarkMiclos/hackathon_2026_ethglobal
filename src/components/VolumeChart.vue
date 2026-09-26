<template>
  <div ref="container" class="relative w-full h-full">
    <div
      ref="tooltip"
      class="pointer-events-none absolute z-10 hidden rounded-md bg-surface-900/95 border border-surface-600 px-2 py-1 text-[10px] text-gray-200 shadow-lg whitespace-nowrap"
    />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import { formatAmount } from '@/config/pools'

const props = defineProps({
  swaps: { type: Array, default: () => [] },   // enriched swaps with valueUsdc
  pools: { type: Array, default: () => [] },
  activePool: { type: Object, default: null },
})

const emit = defineEmits(['select-pool'])

const container = ref(null)
const tooltip = ref(null)
let ro = null

onMounted(() => {
  ro = new ResizeObserver(() => draw())
  ro.observe(container.value)
  draw()
})
onUnmounted(() => ro?.disconnect())
watch(() => [props.swaps, props.activePool], draw, { deep: false })

const BUY = '#22c55e'
const SELL = '#f59e0b'

function draw() {
  const el = container.value
  if (!el) return
  d3.select(el).selectAll('svg').remove()
  const { width, height } = el.getBoundingClientRect()
  if (width <= 0 || height <= 0) return

  const margin = { top: 14, right: 8, bottom: 22, left: 8 }
  const w = width - margin.left - margin.right
  const h = height - margin.top - margin.bottom

  const data = props.pools.filter((p) => p.address).map((pool) => {
    const rows = props.swaps.filter((s) => s.pool?.address === pool.address)
    const buy = rows.filter((s) => s.side === 'buy').reduce((a, s) => a + (s.valueUsdc || 0), 0)
    const sell = rows.filter((s) => s.side === 'sell').reduce((a, s) => a + (s.valueUsdc || 0), 0)
    return { pool, buy, sell, total: buy + sell, count: rows.length }
  })

  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const x = d3.scaleBand().domain(data.map((d) => d.pool.address)).range([0, w]).padding(0.35)
  const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.total) || 1]).nice().range([h, 0])

  g.append('g')
    .call(d3.axisLeft(y).ticks(3).tickSize(-w).tickFormat(''))
    .call((ax) => ax.select('.domain').remove())
    .selectAll('line').attr('stroke', '#1e293b')

  const tip = d3.select(tooltip.value)
  const active = props.activePool?.address

  const bar = g.selectAll('g.bar').data(data).enter().append('g')
    .attr('class', 'bar')
    .attr('transform', (d) => `translate(${x(d.pool.address)},0)`)
    .style('cursor', 'pointer')
    .attr('opacity', (d) => (active && active !== d.pool.address ? 0.35 : 1))
    .on('click', (_, d) => emit('select-pool', d.pool))
    .on('mousemove', (event, d) => {
      const [mx, my] = d3.pointer(event, container.value)
      tip.classed('hidden', false)
        .style('left', `${Math.min(mx + 10, width - 160)}px`).style('top', `${Math.max(my - 40, 0)}px`)
        .html(
          `<b>${d.pool.name}</b> · ${d.count} swaps<br>` +
          `<span style="color:${BUY}">buy</span> ${formatAmount(d.buy, 0)} · ` +
          `<span style="color:${SELL}">sell</span> ${formatAmount(d.sell, 0)} USDC`,
        )
    })
    .on('mouseleave', () => tip.classed('hidden', true))

  // sell segment (bottom), buy segment (top)
  bar.append('rect')
    .attr('x', 0).attr('width', x.bandwidth())
    .attr('y', h).attr('height', 0)
    .attr('fill', SELL).attr('rx', 2)
    .transition().duration(500)
    .attr('y', (d) => y(d.sell)).attr('height', (d) => h - y(d.sell))
  bar.append('rect')
    .attr('x', 0).attr('width', x.bandwidth())
    .attr('y', h).attr('height', 0)
    .attr('fill', BUY).attr('rx', 2)
    .transition().duration(500)
    .attr('y', (d) => y(d.total)).attr('height', (d) => y(d.sell) - y(d.total))

  // pool colour strip under each bar
  bar.append('rect')
    .attr('x', 0).attr('width', x.bandwidth()).attr('y', h + 2).attr('height', 2)
    .attr('fill', (d) => d.pool.color)

  bar.append('text')
    .attr('x', x.bandwidth() / 2).attr('y', (d) => y(d.total) - 4)
    .attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', '#cbd5e1')
    .attr('font-family', 'JetBrains Mono, monospace')
    .text((d) => (d.total > 0 ? formatAmount(d.total, 0) : ''))

  bar.append('text')
    .attr('x', x.bandwidth() / 2).attr('y', h + 14)
    .attr('text-anchor', 'middle').attr('font-size', '9px')
    .attr('fill', (d) => (active === d.pool.address ? '#e2e8f0' : '#64748b'))
    .text((d) => d.pool.name)

}
</script>
