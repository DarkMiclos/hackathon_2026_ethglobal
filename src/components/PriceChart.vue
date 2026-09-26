<template>
  <div ref="container" class="w-full h-full"></div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import * as d3 from 'd3'

const props = defineProps({
  swaps: { type: Array, default: () => [] },
})

const container = ref(null)
let svg = null

onMounted(() => {
  initChart()
})

watch(() => props.swaps, () => {
  drawChart()
}, { deep: true })

function initChart() {
  const el = container.value
  if (!el) return

  svg = d3.select(el)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')

  drawChart()
}

function drawChart() {
  if (!svg || !props.swaps.length) return

  svg.selectAll('*').remove()

  const el = container.value
  const { width, height } = el.getBoundingClientRect()
  const margin = { top: 10, right: 20, bottom: 25, left: 50 }
  const w = width - margin.left - margin.right
  const h = height - margin.top - margin.bottom

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Convert sqrtPriceX96 to price, or use a placeholder
  const data = props.swaps
    .filter((s) => s.sqrtPriceX96)
    .map((s, i) => ({
      index: i,
      price: decodeSqrtPrice(s.sqrtPriceX96),
      timestamp: s.timestamp || i,
    }))

  if (!data.length) return

  const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, w])
  const y = d3.scaleLinear()
    .domain(d3.extent(data, (d) => d.price))
    .nice()
    .range([h, 0])

  // Axes
  g.append('g')
    .attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(() => ''))
    .selectAll('line,path').attr('stroke', '#334155')

  g.append('g')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('.4f')))
    .selectAll('line,path').attr('stroke', '#334155')

  g.selectAll('text').attr('fill', '#64748b').attr('font-size', '10px')

  // Line
  const line = d3.line()
    .x((d) => x(d.index))
    .y((d) => y(d.price))
    .curve(d3.curveMonotoneX)

  // Gradient fill
  const gradient = svg.append('defs')
    .append('linearGradient')
    .attr('id', 'price-gradient')
    .attr('x1', '0%').attr('y1', '0%')
    .attr('x2', '0%').attr('y2', '100%')

  gradient.append('stop').attr('offset', '0%').attr('stop-color', '#3b82f6').attr('stop-opacity', 0.3)
  gradient.append('stop').attr('offset', '100%').attr('stop-color', '#3b82f6').attr('stop-opacity', 0)

  // Area
  const area = d3.area()
    .x((d) => x(d.index))
    .y0(h)
    .y1((d) => y(d.price))
    .curve(d3.curveMonotoneX)

  g.append('path').datum(data).attr('d', area).attr('fill', 'url(#price-gradient)')
  g.append('path').datum(data).attr('d', line).attr('fill', 'none').attr('stroke', '#3b82f6').attr('stroke-width', 2)
}

/**
 * Decode Uniswap V3 sqrtPriceX96 to human-readable price.
 * price = (sqrtPriceX96 / 2^96)^2
 * This gives token1/token0. Adjust decimals per pair as needed.
 */
function decodeSqrtPrice(sqrtPriceX96) {
  const Q96 = 2n ** 96n
  const sqrtPrice = Number(BigInt(sqrtPriceX96)) / Number(Q96)
  return sqrtPrice * sqrtPrice
}
</script>
