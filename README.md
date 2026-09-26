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
- **ENS names and avatars** read directly from Sepolia resolver records
- **Add pool via ENS**: the namespace owner connects a browser wallet, pastes a Uniswap V3 pool address, and the app registers `<pair>.nameflow.eth` in the ENSv2 registry, publishes its address and metadata records, and appends it to the directory. Anyone else sees a read-only badge: ENSv2 access control, on screen
- **Replay**: rebuild the indexed history swap by swap through every view, with speed control and a scrubber, so the dashboard moves even when the chain is quiet
- **Time window** (15m / 1h / 24h / all) shared by all views, and a collapsible side panel for presenting (`[` toggles it, `1`/`2`/`3` switch views, `Esc` clears focus)
- **Graph layout persists** across reloads within the tab

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

## Deploying to Vercel

The repo includes `api/multibaas/[...path].js`, an edge function that proxies `/api/multibaas/*` to the MultiBaas deployment and injects the API key server-side. Production builds call MultiBaas through it by default, so:

- no CORS origin has to be registered in MultiBaas, and
- the key is never shipped in the bundle.

Set `MULTIBAAS_URL` and `MULTIBAAS_API_KEY` (no `VITE_` prefix) in the Vercel project settings and deploy. `vercel.json` rewrites every non-API path to `index.html` for the Vue router. The proxy forwards only the read endpoints the dashboard uses, and only for requests coming from the site itself (it checks `Origin`, `Referer`, and `Sec-Fetch-Site`), so opening a proxy URL directly in a browser or with curl returns 403. To let another origin use it, set `MULTIBAAS_PROXY_ALLOWED_ORIGINS` to a comma-separated list. To call MultiBaas directly instead, set `VITE_MULTIBAAS_PROXY=false`, ship `VITE_MULTIBAAS_URL` and `VITE_MULTIBAAS_API_KEY`, and add the site origin under MultiBaas Admin > CORS.

## Setup

```bash
git clone https://github.com/YOUR_USER/nameflow-dashboard.git
cd nameflow-dashboard
npm install
cp .env.example .env
# Fill in your MultiBaas deployment URL and API key (and optionally a throwaway test key)
npm run dev
```

MultiBaas setup used for this deployment: the three pool addresses are linked to `UniswapV3Pool` contracts under the aliases `wethusdcpool1`, `wethunipool1`, and `usdcuni3pool1`, and an event query named `swap_events` selects the `Swap` event inputs plus `block_number`, `tx_hash`, `contract_address`, and `triggered_at`. Pool and token metadata is loaded from ENS text records; `src/config/pools.js` contains only the runtime collection and calculation helpers.

## Team

Built at ETHGlobal Tokyo 2026.

## ENS directory and avatars

The app starts with `nameflow.eth` on Sepolia. Its `nameflow:directory` text record contains a versioned list of pool and wallet names. Each pool's `nameflow:pool` text record contains pair metadata and MultiBaas aliases. Addresses come from ENS forward resolution and pool token addresses and fee tiers are verified against the pool contract. Missing or invalid directory records show an error rather than a static identity list.

Pool icons prefer the ENS `avatar` record through viem. Until avatar URLs are published, the UI uses the prepared local image matching the resolved token pair. This image fallback contains no ENS names or wallet/pool addresses. The three prepared PNGs are in `public/pool-avatars/`; they have not been published to GitHub and their avatar records have not been set. After hosting them at public HTTPS URLs, add each URL as the corresponding pool's `avatar` in the publication seed and run the publisher. Do not use a localhost URL in an ENS avatar record.

Publication uses an external seed at `~/.config/nameflow/ens-directory-seed.json` (override with `NAMEFLOW_SEED_FILE`). The seed is only an administrative publication input; the frontend never reads it. Set `SEPOLIA_PRIVATE_KEY` locally for publication; never commit the key or expose it through a `VITE_` variable.

```bash
node scripts/publish-ens-directory.mjs
node scripts/verify-ens-directory.mjs
```

The scripts need Node 20 or newer (`import.meta.resolve`). If the ENS directory cannot be read at startup, the dashboard falls back to the built-in list of the same three pools and shows a warning instead of a blank screen.

The publisher skips unchanged records, simulates a resolver multicall, waits for confirmation, and verifies the resulting records. The verifier loads the same ENS directory as the app and checks forward and managed reverse mappings. Managed reverse lookup reads `nameflow:name` at `<address-without-0x>.lookup.nameflow.eth` and accepts it only if forward resolution matches the address. This namespace lookup is separate from an ENS primary reverse name. Standard primary reverse resolution is used as a fallback.

ENS reads are cached for five minutes (one minute for missing records). Reload the page after changing records to read them immediately.

The existing simulator has five wallets. Its main wallet and four derived sub-wallets are listed as Bob identities in the ENS directory. The simulator panel displays the resolved names while retaining addresses for copying. To register wallet names from a local public list (`[{"name":"…","address":"0x…"}]`), use `NAMEFLOW_WALLETS_FILE` with `scripts/register-ens-wallets.mjs` and the namespace owner's local `SEPOLIA_PRIVATE_KEY`. This creates missing subname registries and forward/managed reverse records; it does not generate or fund wallets.

Wallet avatars use the Boring Avatars Bauhaus algorithm with the palette #651366, #a71a5b, #e7204e, #f76e2a, #f0c505. They are generated locally from normalized wallet addresses, remain stable when ENS names change, and do not use an external avatar API or ENS avatar records. Attribution and the upstream MIT license are in licenses/boring-avatars-MIT.txt.
