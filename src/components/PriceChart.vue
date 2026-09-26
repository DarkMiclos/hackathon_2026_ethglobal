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
import { POOLS, decodePrice, formatAmount } from '@/config/pools'

const props = defineProps({
  swaps: { type: Array, default: () => [] },          // enriched, all pools
  activePool: { type: Object, default: null },        // pool or ALL_POOLS
  poolStates: { type: Object, default: () => ({}) },  // address -> slot0 state
})

const container = ref(null)
const tooltip = ref(null)
let ro = null

onMounted(() => {
  ro = new ResizeObserver(() => draw())
  ro.observe(container.value)
  draw()
})
onUnmounted(() => ro?.disconnect())

watch(() => [props.swaps, props.activePool, props.poolStates], draw, { deep: false })

const BUY = '#22c55e'
const SELL = '#f59e0b'

function seriesFor(pool) {
  return props.swaps
    .filter((s) => s.pool?.address === pool.address && s.price != null && Number.isFinite(s.price))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.timestamp - b.timestamp)
    .map((s) => ({ t: s.timestamp * 1000, price: s.price, side: s.side, swap: s }))
}

function draw() {
  const el = container.value
  if (!el) return
  d3.select(el).selectAll('svg').remove()
  const { width, height } = el.getBoundingClientRect()
  if (width <= 0 || height <= 0) return

  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height)

  if (props.activePool?.address) {
    drawSingle(svg, width, height, props.activePool)
  } else {
    drawSmallMultiples(svg, width, height)
  }
}

function drawSingle(svg, width, height, pool) {
  const data = seriesFor(pool)
  const margin = { top: 8, right: 56, bottom: 20, left: 8 }
  const w = width - margin.left - margin.right
  const h = height - margin.top - margin.bottom
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const live = decodePrice(props.poolStates[pool.address]?.sqrtPriceX96, pool)

  if (!data.length) {
    g.append('text').attr('x', w / 2).attr('y', h / 2).attr('text-anchor', 'middle')
      .attr('fill', '#64748b').attr('font-size', '11px').text('no indexed swaps for this pool yet')
    if (live != null) {
      g.append('text').attr('x', w / 2).attr('y', h / 2 + 16).attr('text-anchor', 'middle')
        .attr('fill', '#94a3b8').attr('font-size', '11px').attr('font-family', 'JetBrains Mono, monospace')
        .text(`live ${formatAmount(live)} ${pool.quote.symbol}`)
    }
    return
  }

  const now = Date.now()
  const tExtent = d3.extent(data, (d) => d.t)
  const span = Math.max(tExtent[1] - tExtent[0], 60_000)
  const x = d3.scaleTime().domain([tExtent[0] - span * 0.05, Math.max(tExtent[1], now) + span * 0.05]).range([0, w])

  const prices = data.map((d) => d.price)
  if (live != null) prices.push(live)
  let [pMin, pMax] = d3.extent(prices)
  if (pMin === pMax) { pMin *= 0.999; pMax *= 1.001 }
  const pad = (pMax - pMin) * 0.2
  const y = d3.scaleLinear().domain([pMin - pad, pMax + pad]).range([h, 0])
  const fmtTick = priceFormatter(pMax - pMin + pad * 2)

  // grid + axes
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(3).tickSize(-w).tickFormat(''))
    .call((ax) => ax.select('.domain').remove())
    .selectAll('line').attr('stroke', '#1e293b')

  g.append('g').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(d3.timeFormat('%H:%M')))
    .call((ax) => ax.select('.domain').attr('stroke', '#334155'))
    .call((ax) => ax.selectAll('line').attr('stroke', '#334155'))
    .selectAll('text').attr('fill', '#64748b').attr('font-size', '9px')

  g.append('g').attr('transform', `translate(${w},0)`)
    .call(d3.axisRight(y).ticks(3).tickFormat(fmtTick))
    .call((ax) => ax.select('.domain').remove())
    .call((ax) => ax.selectAll('line').attr('stroke', '#334155'))
    .selectAll('text').attr('fill', '#64748b').attr('font-size', '9px')

  // gradient area + line
  const gid = `price-grad-${pool.alias}`
  const grad = svg.append('defs').append('linearGradient').attr('id', gid)
    .attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%')
  grad.append('stop').attr('offset', '0%').attr('stop-color', pool.color).attr('stop-opacity', 0.35)
  grad.append('stop').attr('offset', '100%').attr('stop-color', pool.color).attr('stop-opacity', 0)

  const line = d3.line().x((d) => x(d.t)).y((d) => y(d.price)).curve(d3.curveStepAfter)
  const area = d3.area().x((d) => x(d.t)).y0(h).y1((d) => y(d.price)).curve(d3.curveStepAfter)

  // extend the last price to "now" so the step reads as current
  const extended = [...data, { t: Math.max(now, tExtent[1]), price: data[data.length - 1].price, side: null }]
  g.append('path').datum(extended).attr('d', area).attr('fill', `url(#${gid})`)
  g.append('path').datum(extended).attr('d', line).attr('fill', 'none').attr('stroke', pool.color).attr('stroke-width', 1.75)

  // live price from slot0 (MultiBaas contract call)
  if (live != null) {
    g.append('line').attr('x1', 0).attr('x2', w).attr('y1', y(live)).attr('y2', y(live))
      .attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3').attr('stroke-opacity', 0.6)
    const label = g.append('g').attr('transform', `translate(${w + 2},${y(live)})`)
    label.append('rect').attr('x', 0).attr('y', -7).attr('width', 54).attr('height', 14).attr('rx', 3).attr('fill', '#e2e8f0')
    label.append('text').attr('x', 27).attr('y', 3.5).attr('text-anchor', 'middle')
      .attr('fill', '#0a0e17').attr('font-size', '9px').attr('font-weight', 600)
      .attr('font-family', 'JetBrains Mono, monospace').text(fmtTick(live))
  }

  // swap markers
  const tip = d3.select(tooltip.value)
  g.selectAll('circle.swap').data(data).enter().append('circle')
    .attr('class', 'swap')
    .attr('cx', (d) => x(d.t)).attr('cy', (d) => y(d.price)).attr('r', 3.5)
    .attr('fill', (d) => (d.side === 'buy' ? BUY : SELL))
    .attr('stroke', '#0a0e17').attr('stroke-width', 1)
    .style('cursor', 'pointer')
    .on('mousemove', (event, d) => {
      const [mx, my] = d3.pointer(event, container.value)
      tip.classed('hidden', false)
        .style('left', `${Math.min(mx + 10, width - 150)}px`).style('top', `${Math.max(my - 34, 0)}px`)
        .html(
          `<span style="color:${d.side === 'buy' ? BUY : SELL}">${d.side.toUpperCase()}</span> ` +
          `${formatAmount(d.swap.amountIn)} ${d.swap.tokenIn.symbol} → ${formatAmount(d.swap.amountOut)} ${d.swap.tokenOut.symbol}<br>` +
          `<span style="color:#94a3b8">price</span> ${formatAmount(d.price)} ${pool.quote.symbol} · ${d3.timeFormat('%H:%M:%S')(d.t)}`,
        )
    })
    .on('mouseleave', () => tip.classed('hidden', true))
}

/** Axis formatter with enough precision to tell ticks apart across a narrow price range. */
function priceFormatter(span) {
  if (!Number.isFinite(span) || span <= 0) return (v) => formatAmount(v)
  if (span < 0.01) return d3.format('.5f')
  if (span < 1) return d3.format('.3f')
  if (span < 10) return d3.format('.2f')
  if (span < 100) return d3.format(',.1f')
  if (span < 1_000_000) return d3.format(',.0f')
  return (v) => formatAmount(v)
}

function drawSmallMultiples(svg, width, height) {
  const rows = POOLS.length
  const rowH = height / rows
  const labelW = 96
  const valueW = 86
  const margin = { left: labelW, right: valueW, top: 6, bottom: 6 }
  const w = width - margin.left - margin.right
  const now = Date.now()

  POOLS.forEach((pool, i) => {
    const data = seriesFor(pool)
    const g = svg.append('g').attr('transform', `translate(0,${i * rowH})`)
    const live = decodePrice(props.poolStates[pool.address]?.sqrtPriceX96, pool)
    const last = data.length ? data[data.length - 1].price : live
    const first = data.length ? data[0].price : null
    const change = first && last ? ((last - first) / first) * 100 : null

    if (i > 0) {
      g.append('line').attr('x1', 8).attr('x2', width - 8).attr('y1', 0).attr('y2', 0).attr('stroke', '#1e293b')
    }

    // label
    g.append('circle').attr('cx', 10).attr('cy', rowH / 2).attr('r', 3.5).attr('fill', pool.color)
    g.append('text').attr('x', 18).attr('y', rowH / 2 - 2).attr('fill', '#cbd5e1').attr('font-size', '10px').attr('font-weight', 600).text(pool.name)
    g.append('text').attr('x', 18).attr('y', rowH / 2 + 9).attr('fill', '#64748b').attr('font-size', '8px')
      .text(`${pool.quote.symbol} per ${pool.base.symbol} · ${data.length} swaps`)

    // value
    g.append('text').attr('x', width - 6).attr('y', rowH / 2 - 1).attr('text-anchor', 'end')
      .attr('fill', '#e2e8f0').attr('font-size', '11px').attr('font-family', 'JetBrains Mono, monospace').attr('font-weight', 600)
      .text(last != null ? formatAmount(last) : '—')
    g.append('text').attr('x', width - 6).attr('y', rowH / 2 + 10).attr('text-anchor', 'end')
      .attr('fill', change == null ? '#64748b' : change >= 0 ? BUY : '#ef4444').attr('font-size', '9px')
      .text(change == null ? (live != null ? 'live slot0' : 'no data') : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(3)}%`)

    if (data.length < 1) return

    const tExtent = d3.extent(data, (d) => d.t)
    const span = Math.max(tExtent[1] - tExtent[0], 60_000)
    const x = d3.scaleTime().domain([tExtent[0], Math.max(tExtent[1], now)]).range([margin.left, margin.left + w])
    let [pMin, pMax] = d3.extent(data, (d) => d.price)
    if (live != null) { pMin = Math.min(pMin, live); pMax = Math.max(pMax, live) }
    if (pMin === pMax) { pMin *= 0.999; pMax *= 1.001 }
    const y = d3.scaleLinear().domain([pMin, pMax]).range([rowH - margin.bottom, margin.top])

    const extended = [...data, { t: Math.max(now, tExtent[1]), price: data[data.length - 1].price }]
    const line = d3.line().x((d) => x(d.t)).y((d) => y(d.price)).curve(d3.curveStepAfter)
    g.append('path').datum(extended).attr('d', line).attr('fill', 'none').attr('stroke', pool.color).attr('stroke-width', 1.5).attr('stroke-opacity', 0.9)

    g.selectAll('circle.pt').data(data).enter().append('circle')
      .attr('cx', (d) => x(d.t)).attr('cy', (d) => y(d.price)).attr('r', 2)
      .attr('fill', (d) => (d.side === 'buy' ? BUY : SELL))

    if (live != null) {
      g.append('circle').attr('cx', x(Math.max(now, tExtent[1]))).attr('cy', y(live)).attr('r', 3)
        .attr('fill', '#e2e8f0').attr('class', 'live-dot')
    }
    void span
  })
}
</script>
