<template>
  <div ref="container" class="w-full h-full"></div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as d3 from 'd3'
import { useEns } from '@/composables/useEns'

const props = defineProps({
  swaps: { type: Array, default: () => [] },
})

const container = ref(null)
const { resolveAddress } = useEns()

let svg = null
let simulation = null

onMounted(() => {
  initGraph()
})

onUnmounted(() => {
  if (simulation) simulation.stop()
})

watch(() => props.swaps, () => {
  updateGraph()
}, { deep: true })

function initGraph() {
  const el = container.value
  if (!el) return

  const { width, height } = el.getBoundingClientRect()

  svg = d3.select(el)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')

  // Gradient definitions for links
  const defs = svg.append('defs')

  // Groups for layering
  svg.append('g').attr('class', 'links')
  svg.append('g').attr('class', 'nodes')

  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id((d) => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30))

  updateGraph()
}

function updateGraph() {
  if (!svg || !props.swaps.length) return

  // Build nodes and links from swaps
  const nodeMap = new Map()
  const links = []

  for (const swap of props.swaps) {
    const sender = swap.sender?.toLowerCase()
    const recipient = swap.recipient?.toLowerCase()
    if (!sender || !recipient) continue

    if (!nodeMap.has(sender)) {
      nodeMap.set(sender, { id: sender, volume: 0, label: truncateAddr(sender) })
    }
    if (!nodeMap.has(recipient)) {
      nodeMap.set(recipient, { id: recipient, volume: 0, label: truncateAddr(recipient) })
    }

    nodeMap.get(sender).volume += Math.abs(swap.amount0 || 0)
    nodeMap.get(recipient).volume += Math.abs(swap.amount0 || 0)

    links.push({ source: sender, target: recipient, value: Math.abs(swap.amount0 || 0) })
  }

  const nodes = Array.from(nodeMap.values())

  // Resolve ENS names in background (non-blocking)
  nodes.forEach(async (node) => {
    try {
      const name = await resolveAddress(node.id)
      if (name) node.label = name
    } catch { /* keep truncated address */ }
  })

  // Size scale
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(nodes, (d) => d.volume) || 1])
    .range([6, 24])

  // Update links
  const linkSel = svg.select('.links')
    .selectAll('line')
    .data(links, (d) => `${d.source?.id || d.source}-${d.target?.id || d.target}`)

  linkSel.exit().remove()

  const linkEnter = linkSel.enter()
    .append('line')
    .attr('stroke', '#334155')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.6)

  const allLinks = linkEnter.merge(linkSel)

  // Update nodes
  const nodeSel = svg.select('.nodes')
    .selectAll('g')
    .data(nodes, (d) => d.id)

  nodeSel.exit().remove()

  const nodeEnter = nodeSel.enter()
    .append('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))

  nodeEnter.append('circle')
    .attr('fill', '#3b82f6')
    .attr('stroke', '#1e3a5f')
    .attr('stroke-width', 1.5)

  nodeEnter.append('text')
    .attr('dy', '0.35em')
    .attr('text-anchor', 'middle')
    .attr('font-size', '9px')
    .attr('fill', '#94a3b8')
    .attr('pointer-events', 'none')

  const allNodes = nodeEnter.merge(nodeSel)

  allNodes.select('circle')
    .attr('r', (d) => radiusScale(d.volume))

  allNodes.select('text')
    .text((d) => d.label)
    .attr('y', (d) => radiusScale(d.volume) + 12)

  // Restart simulation
  simulation.nodes(nodes).on('tick', () => {
    allLinks
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y)

    allNodes.attr('transform', (d) => `translate(${d.x},${d.y})`)
  })

  simulation.force('link').links(links)
  simulation.alpha(0.8).restart()
}

function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart()
  d.fx = d.x
  d.fy = d.y
}

function dragged(event, d) {
  d.fx = event.x
  d.fy = event.y
}

function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0)
  d.fx = null
  d.fy = null
}

function truncateAddr(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
</script>
