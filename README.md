# NameFlow — Live Uniswap Trading Dashboard

A real-time Uniswap V3 swap dashboard built for **ETHGlobal Tokyo 2026**, powered by ENSv2 identity and MultiBaas event indexing.

## What it does

- **Live trade tape** of Uniswap V3 pool swaps on Sepolia, with human-readable amounts, buy/sell side, and Etherscan links
- **Trader × Pool network** (D3 force graph): pools pinned in a ring, traders sized by USDC-valued volume, buy/sell arrows, particles fly along a link when a new swap is indexed
- **Flow view** (D3 Sankey): trader → pool → token received, so you can see where value moves
- **Timeline view**: one lane per pool, every swap as a dot sized by value, coloured by side
- **Pool focus**: click any pool (selector, graph node, volume bar, timeline lane) to filter everything and open a pool card with live `slot0()` price, liquidity, tick range, net token flow, indexing status, and top traders
- **Trader focus**: click a trader anywhere to highlight their swaps across all views
- **Price panel**: per-pool step chart with buy/sell markers and the live on-chain price; small multiples for all pools
- **ENSv2 names** for traders and pools (in progress)

## Stack

- **Vue 3** (Composition API) + Vite
- **MultiBaas** (Curvegrid) — Swap event indexing, event queries, contract calls, chain status, via `@curvegrid/multibaas-sdk`
- **viem** — ENSv2 resolution and the Sepolia swap simulator
- **D3.js v7** + **d3-sankey** — force graph, Sankey, timeline, price and volume charts
- **Tailwind CSS** — layout and styling

## How MultiBaas is used

All on-chain data on screen comes through the MultiBaas REST API using the official TypeScript SDK (`src/composables/useMultiBaas.js`). No RPC log scanning, no custom indexer.

| Dashboard element | MultiBaas feature | SDK call |
|---|---|---|
| Trade tape, graph, timeline, price series | Saved **Event Query** `swap_events` over the three linked `UniswapV3Pool` contracts (paged, 50 rows per page) | `EventQueriesApi.executeEventQuery` |
| "N swaps indexed" in the header | Event query record count | `EventQueriesApi.countEventQueryRecords` |
| Pool card: net token flow, tick range, first/last block, last price | **Arbitrary event query** with server-side aggregators (`add`, `min`, `max`, `last`) grouped by `contract_address` | `EventQueriesApi.executeArbitraryEventQuery` |
| Pool card and price panel: live price and tick, liquidity | **Contract calls** `slot0()` and `liquidity()` on each pool through its MultiBaas address alias | `ContractsApi.callContractFunction` |
| Pool card: "indexed to block" | Per-contract event indexing status | `ContractsApi.getEventIndexingStatus` |
| Header: chain head and base fee | Chain status | `ChainsApi.getChainStatus` |

### Request budget

The dashboard is designed to stay well inside API limits:

- An idle poll is **one request**: the `swap_events` record count, every 10 seconds (every 4 seconds for 90 seconds after the simulator broadcasts swaps).
- Rows are fetched **only when the count moves**, and only the rows past the ones already held (the saved query returns rows in ascending block order with stable offsets). The first load takes the newest 200 rows in parallel 50-row pages.
- Pool state (`slot0`, `liquidity`, indexer status) and the aggregated query are refreshed **only for pools that received new swaps**, never on a timer.
- The chain head in the header refreshes once a minute.
- Polling pauses while the tab is hidden, never overlaps an in-flight request, and backs off exponentially on errors.
- The header shows a live count of MultiBaas requests made since page load.

Steady state with no trading is about 7 requests per minute. ENS lookups go to the Sepolia RPC, not MultiBaas, and cache both hits and misses.

In development the Vite dev server proxies `/multibaas-api` to the deployment to avoid CORS. If MultiBaas is not configured or unreachable the UI falls back to demo data and says so in the header.

## Which ENSv2 features we used

- **Hierarchical subnames**: `pool-name.nameflow.eth` for each watched pool
- **Resolver records**: pool addresses, fee tiers, and pair metadata stored on-chain
- **Universal Resolver V2**: forward + reverse resolution on Sepolia
- **Enhanced Access Control**: role-based permissions for who can add pools

## Swap simulator

The **Simulate Swaps** panel derives five wallets from a test private key, funds the sub-wallets, wraps ETH, approves the Uniswap router, and broadcasts swaps across all three pools so the dashboard has live traffic during a demo. Use a throwaway Sepolia key with faucet funds only: the key is bundled into the client through `VITE_TEST_PRIVATE_KEY`.

## Setup

```bash
git clone https://github.com/YOUR_USER/nameflow-dashboard.git
cd nameflow-dashboard
npm install
cp .env.example .env
# Fill in your MultiBaas deployment URL and API key (and optionally a throwaway test key)
npm run dev
```

MultiBaas setup used for this deployment: the three pool addresses are linked to `UniswapV3Pool` contracts under the aliases `wethusdcpool1`, `wethunipool1`, and `usdcuni3pool1`, and an event query named `swap_events` selects the `Swap` event inputs plus `block_number`, `tx_hash`, `contract_address`, and `triggered_at`. Pool and token metadata lives in `src/config/pools.js`.

## Team

Built at ETHGlobal Tokyo 2026.
