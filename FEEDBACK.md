# Uniswap Developer Feedback — NameFlow (ETHGlobal Tokyo 2026)

A fun, flowy, wavy app called NameFlow that displays Uniswap V3 pool info using Curvegrid and ENS.

Under the hood it indexes the `Swap` event of three
V3 pools through MultiBaas, decodes `sqrtPriceX96`, `tick` and `liquidity` straight from the event,
and drives real trades through `SwapRouter02` from a built-in simulator so there is always traffic
to visualise. Everything below comes from building that in a weekend.

## What we used

| Piece | Where | In our code |
|---|---|---|
| `UniswapV3Pool.Swap` event | three Sepolia pools (see README) | decoded in `src/config/pools.js` (`enrichSwap`, `decodePrice`) |
| `slot0()`, `liquidity()`, `token0()`, `token1()`, `fee()` | same pools | read through MultiBaas contract calls in `src/composables/useMultiBaas.js` |
| `SwapRouter02.exactInputSingle` | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` | `src/composables/useSimulateSwaps.js` |
| `WETH9.deposit` + ERC-20 `approve` | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | same file, wallet preparation |
| `UniswapV3Factory` | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` | linked in MultiBaas for future `PoolCreated` discovery |

## What worked well

- **The `Swap` event carries enough state to build a market view without extra RPC calls.**
  `sqrtPriceX96`, `tick` and `liquidity` on every event meant our price chart, tick strip and
  liquidity readout came for free from the indexed log stream. That is a great design decision.
- **`exactInputSingle` is the right size of primitive for a simulator.** One struct, one call,
  works for every pair. Combined with `simulateContract` we could quote, set `amountOutMinimum`
  at 1% slippage and estimate gas before signing, all client-side.
- **Deterministic token ordering** (`token0 < token1` by address) made pool metadata easy to
  verify on-chain: we cross-check the ENS-published pair against `token0()`/`token1()`/`fee()`
  at load time and refuse mismatches.
- **Docs for the core contracts are clear**, and the V3 math (price from `sqrtPriceX96`,
  tick to price) is well explained once you find the right page.

## What cost us time

1. **Finding canonical Sepolia addresses.** Router, factory, WETH9 and especially "which USDC"
   took real searching across docs, GitHub issues and Etherscan. A single maintained table of
   Sepolia deployments *including the test tokens used by the reference pools* would have saved
   an hour on day one.
2. **Thin testnet liquidity.** The USDC/UNI 0.3% pool we found had almost no liquidity: one
   5 USDC swap moved its price by 150%. We had to shrink that leg to 0.5 USDC and alternate
   swap direction per wallet and per round to keep pools near-neutral during demos. Guidance on
   which Sepolia pools are seeded deeply enough for demos, or a small "demo liquidity" programme,
   would help every hackathon team.
3. **Sign conventions and decimals are an easy trap.** `amount0`/`amount1` are signed from the
   pool's perspective, and the human price needs `10^(dec0 - dec1)` plus an inversion depending
   on which token you treat as the base. We got it wrong once before reading the event docs
   carefully. A short "decoding a Swap event in JavaScript" snippet in the docs, with decimals
   handling, would remove the most common first-day bug.
4. **`amountOutMinimum: 0` is tempting in examples** and we used it before adding a quote step.
   Examples that show `simulateContract` (or the Quoter) feeding `amountOutMinimum` would push
   people toward safe defaults from the start.
5. **`sqrtPriceX96` overflows JavaScript numbers.** Every team rediscovers BigInt for this.
   An official tiny helper (`sqrtPriceX96ToPrice(sqrtP, dec0, dec1)`) published by Uniswap would be
   copied everywhere instead of reimplemented with bugs.

## Suggestions

- Publish a **Sepolia "hackathon kit"**: verified addresses for factory, router, quoter, WETH9,
  test USDC/UNI/DAI, plus three or four pools with known liquidity.
- Add a **JavaScript event-decoding page** next to the Solidity reference: `Swap`, `Mint`,
  `Burn` with BigInt-safe price and decimals examples.
- Consider **emitting a human-friendly view function** or documenting the `slot0` tuple layout
  more prominently; the positional array is easy to misread.

## Team

- Miklós Lockár — GitHub `@DarkMiclos`, Discord `@darkmiclos`, X `@asd12346477221`
- Yuma Kamei — GitHub `@gatolife-creator`, Discord `gatolife`, X `@gatolife81`

Repository: https://github.com/DarkMiclos/hackathon_2026_ethglobal
