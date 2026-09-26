# NameFlow — Live Uniswap Trading Dashboard

A real-time Uniswap V3 swap dashboard built for **ETHGlobal Tokyo 2026**, powered by ENSv2 identity and MultiBaas event indexing.

## What it does

- **Live trade tape** of Uniswap V3 pool swaps on Sepolia
- **ENSv2 names** replace hex addresses everywhere — traders, pools, and the watchlist itself
- **D3 force graph** visualizes the trader network as swaps land
- **Price chart** decoded from `sqrtPriceX96`
- **Pool watchlist stored in ENSv2** resolver records (not hardcoded)

## Stack

- **Vue 3** (Composition API) + Vite
- **viem** — ENSv2 resolution (forward, reverse, text records)
- **MultiBaas** (Curvegrid) — Swap event indexing and REST API
- **D3.js v7** — Force graph and price chart
- **Tailwind CSS** — Layout and styling

## How MultiBaas is used

MultiBaas indexes Uniswap V3 `Swap` events from linked pool contracts on Sepolia. The dashboard polls MultiBaas Event Queries every 5 seconds for new swaps instead of running its own indexer or scanning blocks via RPC. This saved significant development time during the hackathon.

## Which ENSv2 features we used

- **Hierarchical subnames**: `pool-name.nameflow.eth` for each watched pool
- **Resolver records**: pool addresses, fee tiers, and pair metadata stored on-chain
- **Universal Resolver V2**: forward + reverse resolution on Sepolia
- **Enhanced Access Control**: role-based permissions for who can add pools

## Setup

```bash
git clone https://github.com/YOUR_USER/nameflow-dashboard.git
cd nameflow-dashboard
npm install
cp .env.example .env
# Fill in your MultiBaas deployment URL and API key
npm run dev
```

## Team

Built at ETHGlobal Tokyo 2026.
