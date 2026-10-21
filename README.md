# Uniswap v3 LP P&L Tracker

A single-page dashboard that tracks a wallet's Uniswap v3 positions on Ethereum mainnet and reports their P&L day by day. Each day's P&L is split into these components (see [uniswap-v3-lp-pnl-spec.md](uniswap-v3-lp-pnl-spec.md)):

- Realised: fee income, gas, realised fee revaluation, realised price effect, realised IL.
- Unrealised: price effect, impermanent loss, fee revaluation.

## How it works

- **Web app** (`next dev`): add a wallet, list its active positions, and start or pause tracking a position. For each tracked position it shows:
  - charts: P&L per day by component, cumulative realised / unrealised / total P&L, position value against HODL value, and an intraday chart
  - a day-wise table
  - CSV and JSON export
- **Worker** ([worker/index.ts](worker/index.ts)): when you start tracking a position, the worker replays its history from the mint block as one snapshot per UTC day. Every liquidity event gets its own snapshot as well. After that it takes a snapshot every 2 minutes. It stops on its own once the position is fully withdrawn and collected.
- **Engine** ([lib/pnl/engine.ts](lib/pnl/engine.ts)): pure P&L state machine. Tested against the spec's worked example (`npm test`).
- **Prices**:
  - Pool price: read from `slot0` at the same block as the position.
  - USD price: from CoinGecko for one reference token, a stablecoin if the pool has one, otherwise WETH or WBTC. The other token's USD price comes from the pool price.
- **NAV** is what the position holds: liquidity value plus uncollected fees, minus the gas paid for it. Withdrawn principal and collected fees count as capital out at the moment they leave, so re-depositing the same funds doesn't inflate NAV. Total P&L = NAV − (capital in − capital out).

## Setup

1. Start Postgres, either:
   - `npm run db:up` (Docker, port 5433), or
   - any Postgres database you already have.
2. Fill in `.env`:
   ```
   DATABASE_URL="postgresql://pnl:pnl@localhost:5433/pnl?schema=public"
   ALCHEMY_API_KEY="..."        # mainnet, needs archive access for history
   COINGECKO_API_KEY="..."
   COINGECKO_PLAN="demo"        # or "pro"
   POLL_INTERVAL_SECONDS=120
   ```
3. `npm install`, then `npx prisma migrate dev --name init`.
4. `npm run dev` starts the web app on http://localhost:3000 and the worker together.

To run them separately, use `npm run dev:web` and `npm run worker`. The worker reads `.env` only at startup, so restart it after editing the file.

## Limitations

- **Transferred NFTs**: if a position NFT is moved to another wallet, tracking does not treat that as a withdrawal. Spec §9 describes how it should be handled.
- **Multi-position transactions**: gas is charged per transaction to every position that has an event in that transaction.
- **Wallet totals**: P&L is reported per position only. There is no combined row for the whole wallet yet.
