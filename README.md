# NameFlow — Live Uniswap Trading Dashboard

**A fun, flowy, wavy app called NameFlow that displays Uniswap V3 pool info using Curvegrid and ENS.**

Built at **ETHGlobal Tokyo 2026**. Sepolia testnet. Live demo: see the Vercel link on the repository page.

- [1. What it is](#1-what-it-is)
- [2. How it works](#2-how-it-works) · [Uniswap V3](#uniswap-v3-integration) · [MultiBaas](#how-multibaas-is-used) · [ENSv2](#how-ensv2-is-used) · [Visualizations](#visualizations) · [Swap simulator](#swap-simulator)
- [3. Team](#3-team)
- [4. Setup and testing](#4-setup-and-testing)
- [5. Our experience with MultiBaas](#5-our-experience-with-multibaas)
- [Uniswap developer feedback](FEEDBACK.md)

---

## 1. What it is

A single-page dashboard that watches a set of Uniswap V3 pools on Sepolia and shows every swap the moment it is indexed: a force-directed trader × pool network, a Sankey of value flow, a per-pool timeline, price and volume charts, a live trade tape, and a pool card with on-chain state. Traders and pools appear under their ENS names and avatars instead of hex addresses. The pool watchlist itself lives in ENSv2 text records under `nameflow.eth`, and the namespace owner can add a pool from the UI by registering a new subname. A built-in simulator drives real swaps from five ENS-named wallets so the screen is never idle, and a replay mode re-runs the indexed history when the chain is quiet.

---

## 2. How it works

```
Sepolia ── Uniswap V3 pools ── Swap / slot0 / liquidity
   │                                   │
   │  MultiBaas indexes Swap events    │  MultiBaas contract calls
   ▼                                   ▼
 Event query `swap_events` ──► useMultiBaas.js ──► Vue state ──► D3 views
                                       ▲
 nameflow.eth text records ──► useEns.js (names, avatars, watchlist)
 SwapRouter02 ◄── useSimulateSwaps.js (five named wallets, real swaps)
```

### Uniswap V3 integration

Contracts on Sepolia (chain id 11155111):

| Contract | Address | Used for |
|---|---|---|
| `UniswapV3Pool` WETH/USDC 0.3% | `0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50` | `Swap` events, `slot0()`, `liquidity()` |
| `UniswapV3Pool` WETH/UNI 0.3% | `0x287B0e934ed0439E2a7b1d5F0FC25eA2c24b64f7` | same |
| `UniswapV3Pool` USDC/UNI 0.3% | `0x349492f65C8B27efEF83456189b85D0Fa32afCcd` | same |
| `SwapRouter02` | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` | `exactInputSingle` from the simulator |
| `UniswapV3Factory` | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` | linked in MultiBaas for pool discovery |
| `WETH9` | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | `deposit`, `approve` |
| USDC (test) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6-decimal quote asset |
| UNI (test) | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | 18-decimal asset |

Where to verify the integration in code:

- **Swap event decoding**: [`src/config/pools.js`](src/config/pools.js) — `decodePrice` (line 31) converts `sqrtPriceX96` to a human price with decimals and base/quote orientation; `enrichSwap` (line 49) applies the Uniswap sign convention to `amount0`/`amount1` to derive side, tokens in/out and amounts; `swapValueUsdc` (line 83) values every swap in USDC for cross-pool comparison.
- **Pool state reads**: [`src/composables/useMultiBaas.js`](src/composables/useMultiBaas.js) — `fetchPoolState` (line 185) calls `slot0()` and `liquidity()`; `fetchPoolAggregates` (line 141) runs a grouped aggregate over `Swap(address,address,int256,int256,uint160,uint128,int24)` (line 47).
- **Real swaps**: [`src/composables/useSimulateSwaps.js`](src/composables/useSimulateSwaps.js) — `ROUTER_ABI` (line 34) and `executeSwaps` (line 300) quote each `exactInputSingle` with `simulateContract` (line 340), set `amountOutMinimum` to 99% of the quote (line 342), estimate gas, then send and confirm sequentially; `prepareWallets` (line 216) wraps ETH, approves the router and seeds USDC only where a wallet is short.
- **Tests**: [`tests/swap-simulator.test.mjs`](tests/swap-simulator.test.mjs) runs the simulator against fake RPC clients (no transactions) and checks sequencing, slippage protection, fee-tier coverage and failure handling.

### How MultiBaas is used

All on-chain data on screen comes through the MultiBaas REST API using the official TypeScript SDK (`src/composables/useMultiBaas.js`). No RPC log scanning, no custom indexer.

| Dashboard element | MultiBaas feature | SDK call |
|---|---|---|
| Trade tape, graph, timeline, price series | Saved **Event Query** `swap_events` over the linked `UniswapV3Pool` contracts (paged, 50 rows per page) | `EventQueriesApi.executeEventQuery` |
| "N swaps indexed" in the header | Event query record count | `EventQueriesApi.countEventQueryRecords` |
| Pool card: net token flow, tick range, first/last block, last price | **Arbitrary event query** with server-side aggregators (`add`, `min`, `max`, `last`) grouped by `contract_address` | `EventQueriesApi.executeArbitraryEventQuery` |
| Pool card and price panel: live price and tick, liquidity | **Contract calls** `slot0()` and `liquidity()` on each pool address | `ContractsApi.callContractFunction` |
| Pool card: "indexed to block" | Per-contract event indexing status | `ContractsApi.getEventIndexingStatus` |
| Header: chain head and base fee | Chain status | `ChainsApi.getChainStatus` |
| Add pool (best effort) | Address alias + contract link so a new pool starts indexing | `AddressesApi.setAddress`, `ContractsApi.linkAddressContract` |

MultiBaas setup used for this deployment: the three pool addresses are linked to `UniswapV3Pool` contracts, and an event query named `swap_events` selects the `Swap` event inputs plus `block_number`, `tx_hash`, `contract_address` and `triggered_at`. Pool metadata is read from ENS at startup.

**Request budget.** The dashboard is designed to stay well inside API limits:

- An idle poll is **one request**: the `swap_events` record count, every 10 seconds (every 4 seconds for 90 seconds after the simulator broadcasts swaps).
- Rows are fetched **only when the count moves**, and only the rows past the ones already held (the saved query returns rows in ascending block order with stable offsets). The first load takes the newest 200 rows in parallel 50-row pages.
- Pool state (`slot0`, `liquidity`, indexer status) and the aggregated query are refreshed **only for pools that received new swaps**, never on a timer.
- The chain head in the header refreshes once a minute. Polling pauses while the tab is hidden, never overlaps an in-flight request, and backs off exponentially on errors.
- The header shows a live count of MultiBaas requests made since page load. Steady state with no trading is about 7 requests per minute.

In development the Vite dev server proxies `/multibaas-api` to the deployment. In production an edge function (`api/multibaas/[...path].js`) proxies the read endpoints and injects the API key server-side, so the key never ships in the bundle and no CORS origin is needed.

### How ENSv2 is used

The app starts from `nameflow.eth` on Sepolia (`src/composables/useEns.js`, `loadDirectory` at line 70):

- **Watchlist in text records.** The `nameflow:directory` record on `nameflow.eth` lists pool and wallet subnames. Each pool subname (for example `weth-usdc-3000.nameflow.eth`) resolves to the pool address and carries a `nameflow:pool` record with pair metadata and MultiBaas labels. Token addresses and fee tiers are verified against the pool contract before use; invalid records are rejected.
- **Names for traders.** Every trader address is resolved through a managed reverse lookup (`<address>.lookup.nameflow.eth` → `nameflow:name`), accepted only if forward resolution matches, with a standard primary-name fallback (`resolveAddress`, line 45). The five simulator wallets are `main.bob.nameflow.eth` and `sub-1..4.bob.nameflow.eth`.
- **Avatars.** Pool icons prefer the ENS `avatar` record; wallets use locally generated Bauhaus avatars (Boring Avatars algorithm, MIT, see `licenses/`).
- **Subname registration from the UI.** "+ Add pool" opens a dialog (`src/components/AddPoolModal.vue`, `src/composables/useEnsAdmin.js`). The connected wallet is checked against the ENSv2 owner of `nameflow.eth`; only the owner can proceed (that check is the visible piece of ENSv2 access control). `publishPool` (line 157) registers the subname in the namespace's ENSv2 registry (`register`, line 179), then publishes the address record, the `nameflow:pool` metadata, the optional `avatar` record and the updated directory in one resolver `multicall` (line 211). Every write is simulated before the wallet signs.
- **Scripts** in `scripts/` publish and verify the directory and register wallet names from the command line (Node 20+).

If the ENS directory cannot be read at startup, the dashboard falls back to a built-in list of the same three pools and shows a warning instead of a blank screen.

### Visualizations

- **Network** (D3 force graph): pools pinned in a ring, traders sized by USDC-valued volume, buy/sell arrows, particles fly along a link and the pool pulses when a new swap is indexed. Hover to focus, click a pool to filter, click a trader to highlight them everywhere. Layout persists across reloads.
- **Flow** (D3 Sankey): trader → pool → token received.
- **Timeline**: one lane per pool, every swap a dot sized by value and coloured by side.
- **Prices**: per-pool step chart with buy/sell markers and the live `slot0` price; small multiples for the combined view.
- **Volume per pool**, stacked buy/sell, USDC-valued.
- **Pool card**: live price, liquidity, tick range strip, net token flow, indexing status, top traders.
- **Replay**: re-run the indexed history through every view with a scrubber and speed control.
- **Time window** (15m / 1h / 24h / all), collapsible side panel for presenting (`[`), `1`/`2`/`3` switch views, `Esc` clears focus.

### Swap simulator

The **Simulate Swaps** panel derives five wallets from a throwaway private key and drives real Uniswap swaps so the dashboard has live traffic during a demo. Readiness (ETH for gas, WETH, USDC, router allowances) is read from chain in one multicall, so a page reload never forgets that wallets are prepared. **Prepare wallets** funds, wraps, approves and seeds USDC only where a wallet is short. **Execute** runs one round: one swap per supported pool per wallet, direction alternating per wallet and per round so pools stay close to net-neutral, each swap quoted, slippage-protected and confirmed before the next.

---

## 3. Team

| | GitHub | Discord | X / Twitter |
|---|---|---|---|
| **Miklós Lockár** | [@DarkMiclos](https://github.com/DarkMiclos) | @darkmiclos | [@asd12346477221](https://x.com/asd12346477221) |
| **Yuma Kamei** | [@gatolife-creator](https://github.com/gatolife-creator) | gatolife | [@gatolife81](https://x.com/gatolife81) |

---

## 4. Setup and testing

### Prerequisites

- Node.js 20 or newer (22 recommended; the ENS scripts use `import.meta.resolve`)
- A MultiBaas deployment on Sepolia with the pools linked and the `swap_events` query (see above), plus a **read-only** API key
- Optional: a Sepolia RPC URL (Alchemy, Infura, dRPC). The public default works but is slow.

### Run locally

```bash
git clone https://github.com/DarkMiclos/hackathon_2026_ethglobal.git
cd hackathon_2026_ethglobal
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `VITE_MULTIBAAS_URL` | yes | `https://<deployment>.multibaas.com` |
| `VITE_MULTIBAAS_API_KEY` | yes | read-only key; without it the app runs on demo data and says so in the header |
| `VITE_SEPOLIA_RPC_URL` | recommended | used for ENS resolution and the simulator |
| `VITE_TEST_PRIVATE_KEY` | only for the simulator | a **throwaway** key; it is bundled into the browser build |

```bash
npm run dev
```

Open http://localhost:5173. The header dot is green when MultiBaas is live, amber on demo data, red if the deployment is unreachable. The Vite dev server proxies `/multibaas-api` to MultiBaas, so no CORS setup is needed locally.

### Run the tests

```bash
npm test
```

Runs the simulator tests with Node's built-in runner against fake RPC clients. No network, no transactions, no key needed.

### Run test transactions (simulator)

1. Set `VITE_TEST_PRIVATE_KEY` in `.env` to a fresh key that holds nothing valuable and restart `npm run dev`.
2. Open **Simulate Swaps**. The main wallet address is shown with a copy button. Send it about **0.3 Sepolia ETH** from a faucet (Alchemy, Infura, Google Cloud faucets all work). The panel tells you the exact shortfall.
3. Click **Refresh**, then **Prepare wallets**. This funds the four sub-wallets, wraps ETH to WETH, approves the router for WETH/USDC/UNI and seeds USDC by swapping a little WETH. It only does the steps a wallet is missing, so it is safe to run again.
4. Click **Execute N swaps**. Each swap is quoted, sent and confirmed in turn; progress and transaction hashes appear in the log. Within about 10–30 seconds MultiBaas indexes the events and they animate into the dashboard.
5. Run another round any time. Direction alternates each round, so repeated rounds do not push the tiny testnet pools in one direction.

If you want the simulator wallets to show ENS names, they must be listed in the `nameflow.eth` directory (the five wallets derived from the team's key already are). Other keys will show as addresses.

### ENS directory administration (owner only)

The watchlist and wallet names are published with the namespace owner's key, never through a `VITE_` variable:

```bash
SEPOLIA_PRIVATE_KEY=0x… node scripts/publish-ens-directory.mjs   # publishes changed records from ~/.config/nameflow/ens-directory-seed.json
node scripts/verify-ens-directory.mjs                              # reads the directory exactly as the app does and checks every name
NAMEFLOW_WALLETS_FILE=wallets.json SEPOLIA_PRIVATE_KEY=0x… node scripts/register-ens-wallets.mjs
```

Or use **+ Add pool** in the UI with the owner wallet connected in MetaMask (Sepolia). ENS reads are cached for five minutes (one minute for misses); reload after publishing.

### Deploy to Vercel

Set `MULTIBAAS_URL` and `MULTIBAAS_API_KEY` (no `VITE_` prefix) and `VITE_SEPOLIA_RPC_URL` (a dedicated Sepolia RPC; the public ones rate-limit) in the Vercel project, then redeploy (environment variables only apply to builds made after they are set). Production builds call MultiBaas through `api/multibaas/[...path].js`, which forwards only the read endpoints, injects the key, and refuses requests from other origins. `vercel.json` rewrites non-API paths to `index.html` for the router.

Check the deployment with `https://<your-site>/api/health`. It must return JSON with `"proxyConfigured": true`. If it returns Vercel's `NOT_FOUND` page, the `api/` directory is not being built as functions: confirm the project's **Root Directory** is the repository root, the **Framework Preset** is Vite, and no legacy `builds` override is configured. While the function is missing, the app automatically falls back to calling MultiBaas directly **if** `VITE_MULTIBAAS_URL` and `VITE_MULTIBAAS_API_KEY` are set for the build and the site origin is registered under MultiBaas Admin → CORS. Only do that with a **read-only** key: anything shipped in a `VITE_` variable is visible to every visitor.

---

## 5. Our experience with MultiBaas

We really loved the idea of turning smart contracts into callable API endpoints. It let us build a new frontend like this one in a very short time: indexing the pools, querying events with server-side aggregation, and reading `slot0` and `liquidity` were each a single SDK call, and the saved event query meant we never wrote an indexer.

Sadly we did not have enough time to explore all of MultiBaas thoroughly. We had planned to integrate cloud wallets (so the simulator's key would never touch the browser) and webhooks (to replace polling with push), and both remain next steps rather than shipped features.

Personally, using Curvegrid and MultiBaas reminded me of when I was first learning how APIs work and how to use them, so it was quite nostalgic. The documentation is good, with clear examples. Two things that cost us a little time and might help other teams: the event query page size cap of 50 rows is not obvious until you hit a 400 "invalid request", and the API key roles could use a more prominent "make this one read-only for the frontend" pointer.

We would love to connect with the team more. As a test automation engineer myself, I am interested in what kind of automation tests exist for a system like this.
