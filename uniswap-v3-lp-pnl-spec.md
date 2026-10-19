# Uniswap v3 LP Position – Day-wise P&L Specification

Specification for a web app that tracks a wallet's Uniswap v3 ETH/USDC liquidity positions and reports **realised** and **unrealised** P&L, broken down **day by day**.

Reporting currency: **USD** (USDC is valued at a configurable price, default $1.00).
Reference pool: Uniswap v3 USDC/WETH 0.05%, Ethereum mainnet, `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640` (token0 = USDC, 6 decimals; token1 = WETH, 18 decimals).

---

## 1. Core idea

At the end of every day (the **snapshot**), the app values everything and explains the change in net value since the previous snapshot:

```
Closing NAV = Opening NAV
            + Fee income            (realised)
            + Gas cost              (realised, negative)
            + Fee revaluation       (unrealised)
            + ETH price effect      (unrealised)
            + Impermanent loss Δ    (unrealised)
            + Capital flows         (not P&L)
```

Two moments **move** P&L from unrealised to realised without changing the total:

- Withdrawing liquidity realises the ETH price effect and IL on the withdrawn share.
- Collecting fees realises the accumulated revaluation on the collected fees.

Invariant checked every day:

```
Cum. realised + Cum. unrealised = Total P&L = Closing NAV − Net capital deposited
```

---

## 2. P&L categories

### 2.1 Realised (locked in, never reverses)

| Category | Definition | Recorded when |
|---|---|---|
| `feeIncome` | New fees earned by the position, valued at the snapshot price of the day they were earned | Daily, claimed or not |
| `gasCost` | Gas for mint / increase / decrease / collect transactions, valued at the price at tx time (negative) | At each tx |
| `realisedFeeReval` | Accumulated revaluation on fees at the moment they are collected | On `Collect` |
| `realisedPriceEffect` | ETH price effect on the withdrawn share of the position | On `DecreaseLiquidity` |
| `realisedIL` | Impermanent loss on the withdrawn share of the position | On `DecreaseLiquidity` |

### 2.2 Unrealised (mark-to-market, can reverse)

| Category | Definition |
|---|---|
| `priceEffect` | HODL ETH units × change in ETH price. What simply holding the deposit would have done |
| `impermanentLoss` | Position value − HODL value. Always ≤ 0 cumulatively; daily change can be positive (recovery) |
| `feeReval` | Change in value of uncollected fees held in ETH (and USDC if de-pegged) since they were earned |

### 2.3 Not P&L

| Category | Definition |
|---|---|
| `capitalIn` | USD value of tokens deposited (mint / increase liquidity) |
| `capitalOut` | USD value of tokens withdrawn (decrease liquidity, principal only) |
| `feesCollected` | Fees leaving the position on `Collect`. Value already counted as income + reval, so not new P&L |

> **Design choice – fee realisation event.** A wallet tracker cannot follow tokens after they leave the position, so collected fees are treated as realised at the collect price (`feeRealisation = "collect"`). If the user tracks their wallet manually, the option `"convert"` keeps collected ETH fees as unrealised until they are swapped to USDC.

---

## 3. Data sources

| Data | Source |
|---|---|
| Positions owned by wallet | `NonfungiblePositionManager` (`0xC36442b4a4522E871399CD717aBDD847Ab11FE88`): `Transfer` events / `balanceOf` + `tokenOfOwnerByIndex` |
| Position config | `positions(tokenId)` → `tickLower`, `tickUpper`, `liquidity`, `feeGrowthInside0LastX128`, `feeGrowthInside1LastX128`, `tokensOwed0`, `tokensOwed1` |
| Liquidity events | `IncreaseLiquidity(tokenId, liquidity, amount0, amount1)`, `DecreaseLiquidity(...)`, `Collect(tokenId, recipient, amount0, amount1)` |
| Pool price at a block | `pool.slot0()` → `sqrtPriceX96`, `tick` |
| Uncollected fees at a block | `pool.feeGrowthGlobal{0,1}X128`, `pool.ticks(tickLower/tickUpper).feeGrowthOutside{0,1}X128` + position data (formula §4.4) |
| Gas | Tx receipt: `gasUsed × effectiveGasPrice` |
| Snapshot block | Last block with timestamp < 00:00 UTC of the next day (block-by-timestamp lookup) |

All on-chain reads for a snapshot use the **same block number** so prices, liquidity and fees are consistent.

---

## 4. Formulas

Notation: `P` = ETH price in USDC, `√P` = its square root, `L` = position liquidity in human units, `Pa`/`Pb` = range min/max price, `u` = USDC price in USD.

### 4.1 Price from the pool

```
sqrtPriceRaw = sqrtPriceX96 / 2^96
P            = 10^(18 − 6) / sqrtPriceRaw^2          // USDC per ETH
```

Because token0 = USDC, a **higher ETH price is a lower tick**:

```
Pa (min ETH price) = 10^12 / 1.0001^tickUpper
Pb (max ETH price) = 10^12 / 1.0001^tickLower
```

### 4.2 Liquidity units

```
L_human = L_raw / 10^((18 + 6) / 2) = L_raw / 10^12
```

### 4.3 Position token amounts and value

```
s       = clamp(√P, √Pa, √Pb)
ETH     = L × (1/s − 1/√Pb)
USDC    = L × (s − √Pa)
V       = (ETH × P + USDC) × u                         // position value, excl. fees
```

### 4.4 Uncollected fees (per token, raw units)

```
below = (tickCurrent >= tickLower) ? feeGrowthOutside_lower : feeGrowthGlobal − feeGrowthOutside_lower
above = (tickCurrent <  tickUpper) ? feeGrowthOutside_upper : feeGrowthGlobal − feeGrowthOutside_upper
feeGrowthInside = feeGrowthGlobal − below − above                       // uint256, wrap-around arithmetic

uncollected = tokensOwed + L_raw × (feeGrowthInside − feeGrowthInsideLast) / 2^128
```

Convert to human units: USDC ÷ 10^6, WETH ÷ 10^18.

### 4.5 Fee income for a day

Track cumulative fees **earned** in token units (never decreases):

```
earned_t = uncollected_t + collectedFees_cumulative_t
newFees_ETH  = earned_ETH_t  − earned_ETH_{t−1}
newFees_USDC = earned_USDC_t − earned_USDC_{t−1}

feeIncome_t = (newFees_USDC + newFees_ETH × P_t) × u_t
```

New fees are valued at the **day's closing price** (no intra-day revaluation). For per-trade accuracy, replace with swap-level valuation (§9).

### 4.6 Fee revaluation

Applied only to fees already held at the previous snapshot:

```
feeReval_t = heldFees_ETH_{t−1} × (P_t − P_{t−1}) × u_t
           + (heldFees_USDC_{t−1} + heldFees_ETH_{t−1} × P_{t−1}) × (u_t − u_{t−1})   // de-peg term, 0 if u fixed
```

`heldFees` = uncollected fees (plus collected-but-unconverted fees when `feeRealisation = "convert"`).

### 4.7 HODL benchmark, price effect and IL

The HODL basket is the tokens deposited, adjusted for later deposits and withdrawals:

```
On deposit  (amount0, amount1):  hodlETH += amountETH;  hodlUSDC += amountUSDC
On withdraw (fraction f of L):    hodlETH ×= (1 − f);    hodlUSDC ×= (1 − f)

HODL_t           = (hodlETH × P_t + hodlUSDC) × u_t
priceEffect_t    = hodlETH × (P_t − P_{t−1}) × u_t                // daily
ILchange_t       = (V_t − V_{t−1}) − priceEffect_t                // daily
cumIL_t          = V_t − HODL_t                                   // ≤ 0
```

Benchmark = **original deposit** (not rebased daily), so cumulative IL matches the standard IL figure. It resets only on capital flows.

### 4.8 Realisation on withdrawal

When liquidity fraction `f = ΔL / L_before` is removed:

```
realisedPriceEffect += f × cumUnrealisedPriceEffect
realisedIL          += f × cumUnrealisedIL
cumUnrealisedPriceEffect ×= (1 − f)
cumUnrealisedIL          ×= (1 − f)
costBasis                ×= (1 − f)
capitalOut              += value of principal tokens withdrawn (at event price)
```

Check: `realisedPriceEffect + realisedIL` on the event = `f × (V − costBasis)` at the event price.

### 4.9 Realisation on collect

When fees are collected (`feeRealisation = "collect"`):

```
share = collected_ETH / heldFees_ETH          // fraction of held ETH fees collected
realisedFeeReval += share × cumUnrealisedFeeReval
cumUnrealisedFeeReval ×= (1 − share)
heldFees −= collected amounts
```

### 4.10 Gas

```
gasCost = −(gasUsed × effectiveGasPrice / 10^18) × P_at_tx × u
```

---

## 5. Daily algorithm

```
for each day d in [startDate .. today]:
    block_d = lastBlockBefore(midnightUTC(d + 1))

    events_d = all IncreaseLiquidity / DecreaseLiquidity / Collect for the
               wallet's tokenIds in (block_{d−1}, block_d], sorted by block, logIndex

    // Split the day at each event so flows are valued at the event price
    checkpoints = [block_{d−1}] + [e.block for e in events_d] + [block_d]

    for each consecutive pair (a, b) in checkpoints:
        state_b = readState(block_b)             // P, L, fees, tokens (§4)
        accumulate feeIncome, feeReval, priceEffect, ILchange from a → b
        if b is an event:
            apply event:
              Increase  → capitalIn, update hodl basket and costBasis
              Decrease  → realise PE + IL (§4.8), capitalOut
              Collect   → realise fee reval (§4.9)
              add gasCost for the tx

    write DailyRow(d)
    assert reconciliation checks (§7)
```

Checkpoint states for events can use the price from the event's block; the day's figures are the sum of its sub-intervals.

---

## 6. Data model

### 6.1 `PositionSnapshot`

```json
{
  "tokenId": 123456,
  "date": "2026-10-16",
  "block": 26200000,
  "ethPrice": 2400.00,
  "usdcPrice": 1.00,
  "inRange": true,
  "liquidity": "2030747838324900000000",
  "positionEth": 2.3707,
  "positionUsdc": 4244.68,
  "positionValue": 9934.40,
  "hodlEth": 2.1207,
  "hodlUsdc": 4848.39,
  "hodlValue": 9938.04,
  "heldFeesEth": 0.0003,
  "heldFeesUsdc": 10.22,
  "heldFeesValue": 10.94,
  "costBasis": 10000.00
}
```

### 6.2 `DailyPnlRow` (one per position per day, plus an aggregated wallet row)

```json
{
  "date": "2026-10-16",
  "openingNav": 10048.08,
  "closingNav": 9939.85,

  "daily": {
    "feeIncome": 1.62,
    "gasCost": -2.00,
    "feeReval": 0.00,
    "priceEffect": -106.03,
    "ilChange": -1.82,
    "capitalIn": 0.00,
    "capitalOut": 0.00,
    "pnl": -108.23
  },

  "reclassified": {
    "feeRevalToRealised": 0.00,
    "priceEffectToRealised": -61.94,
    "ilToRealised": -3.65
  },

  "cumulative": {
    "realised": {
      "feeIncome": 10.79,
      "gasCost": -5.50,
      "feeReval": 0.15,
      "priceEffect": -61.94,
      "il": -3.65,
      "total": -60.15
    },
    "unrealised": {
      "priceEffect": 0.00,
      "il": 0.00,
      "feeReval": 0.00,
      "total": 0.00
    },
    "totalPnl": -60.15
  },

  "checks": { "navReconciles": true, "pnlReconciles": true }
}
```

NAV for a position = `positionValue + heldFeesValue − cumulative gas paid + value of tokens withdrawn/collected` (tokens that left the position stay in NAV at their exit value so that P&L is not lost when funds leave).

---

## 7. Reconciliation checks (run every day)

1. `closingNav = openingNav + daily.pnl + capitalIn − capitalOut`
2. `daily.pnl = feeIncome + gasCost + feeReval + priceEffect + ilChange`
3. `cum.realised.total + cum.unrealised.total = totalPnl`
4. `totalPnl = closingNav − Σ capitalIn + Σ capitalOut`
5. `cum.unrealised.priceEffect + cum.unrealised.il = positionValue − costBasis`
6. `cum.unrealised.il = positionValue − hodlValue` (≤ 0)
7. Reclassifications sum to zero across realised + unrealised on each day.

Tolerance: ±$0.01 per figure for rounding. Store full precision; round only for display.

---

## 8. Worked example (5 days)

Setup: $10,000 deposited at ETH = $2,429.22, range $2,199.57–$2,700.00 (tick-snapped), L = 2,030.75 (human units). Deposit = 2.1207 ETH + 4,848.39 USDC. Gas paid from wallet. Fee amounts are illustrative; prices, balances, HODL and IL use the exact v3 formulas.

Events: Day 1 deposit (gas $2.00) · Day 4 collect fees and swap 0.00174 ETH of fees to USDC (gas $1.50) · Day 5 withdraw all (gas $2.00).

### 8.1 State (end of day)

| Day | ETH close | Position ETH | Position USDC | Position value | HODL value | Fees held | Event |
|---|---|---|---|---|---|---|---|
| 0 | $2,429.22 | 2.1207 | 4,848.39 | $10,000.00 | $10,000.00 | $0.00 | Deposit |
| 1 | $2,420.00 | 2.1991 | 4,658.34 | $9,980.09 | $9,980.46 | $3.00 | – |
| 2 | $2,300.00 | 3.2623 | 2,150.00 | $9,653.23 | $9,725.97 | $5.13 | – |
| 3 | $2,370.00 | 2.6322 | 3,620.94 | $9,859.37 | $9,874.42 | $7.31 | – |
| 4 | $2,450.00 | 1.9456 | 5,275.65 | $10,042.25 | $10,044.08 | $9.32 | Collect + swap ETH fees |
| 5 | $2,400.00 | 2.3707 | 4,244.68 | $9,934.40 | $9,938.04 | $10.94 | Withdraw all |

### 8.2 Daily P&L

| Day | Opening NAV | Fee income (R) | Gas (R) | Fee reval. (U) | ETH price effect (U) | IL change (U) | Daily P&L | Closing NAV |
|---|---|---|---|---|---|---|---|---|
| 1 | $10,000.00 | +$3.00 | −$2.00 | $0.00 | −$19.54 | −$0.36 | −$18.90 | $9,981.10 |
| 2 | $9,981.10 | +$2.20 | $0.00 | −$0.07 | −$254.48 | −$72.39 | −$324.74 | $9,656.36 |
| 3 | $9,656.36 | +$2.08 | $0.00 | +$0.10 | +$148.45 | +$57.69 | +$208.32 | $9,864.68 |
| 4 | $9,864.68 | +$1.89 | −$1.50 | +$0.12 | +$169.66 | +$13.23 | +$183.40 | $10,048.08 |
| 5 | $10,048.08 | +$1.62 | −$2.00 | $0.00 | −$106.03 | −$1.82 | −$108.23 | $9,939.85 |

### 8.3 Reclassifications

| Day | Event | Out of unrealised | Into realised |
|---|---|---|---|
| 4 | ETH fees collected and swapped | Fee reval. +$0.15 | Realised fee reval. +$0.15 |
| 5 | Liquidity withdrawn | Price effect −$61.94, IL −$3.65 | Realised position P&L −$65.59 |

### 8.4 Cumulative

| Day | Fee income | Gas | Realised fee reval. | Realised position P&L | **Cum. realised** | Price effect | IL | Fee reval. | **Cum. unrealised** | **Total P&L** |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | $3.00 | −$2.00 | $0.00 | $0.00 | **$1.00** | −$19.54 | −$0.36 | $0.00 | **−$19.90** | **−$18.90** |
| 2 | $5.20 | −$2.00 | $0.00 | $0.00 | **$3.20** | −$274.02 | −$72.75 | −$0.07 | **−$346.84** | **−$343.64** |
| 3 | $7.28 | −$2.00 | $0.00 | $0.00 | **$5.28** | −$125.57 | −$15.06 | +$0.03 | **−$140.60** | **−$135.32** |
| 4 | $9.17 | −$3.50 | $0.15 | $0.00 | **$5.82** | +$44.09 | −$1.83 | $0.00 | **+$42.26** | **+$48.08** |
| 5 | $10.79 | −$5.50 | $0.15 | −$65.59 | **−$60.15** | $0.00 | $0.00 | $0.00 | **$0.00** | **−$60.15** |

Summary: LP activity +$5.44 (fees $10.79 + reval $0.15 − gas $5.50); position −$65.59 (price −$61.94, IL −$3.65); total −$60.15 vs −$61.96 for simply holding.

Use these rows as **unit-test fixtures** for the P&L engine.

---

## 9. Edge cases and options

| Case | Handling |
|---|---|
| Multiple positions (tokenIds) | Compute per position, then sum each field into a wallet-level row |
| Add liquidity to an existing position | Split the day at the event; add tokens to HODL basket and cost basis |
| Partial withdrawal | Realise fraction `f` (§4.8); scale HODL basket and cost basis by `1 − f` |
| Collect without withdrawal | Realise fee reval for the collected share (§4.9); gas is realised |
| `DecreaseLiquidity` + `Collect` in one tx | Principal goes to `capitalOut`; only amounts above principal are fees |
| Position out of range | Fees stop; IL and price effect continue (position is 100% ETH below Pa, 100% USDC above Pb) |
| Position NFT transferred in/out | Treat transfer-in as deposit at market value, transfer-out as full withdrawal |
| USDC de-peg | Set `usdcPrice` from an oracle; de-peg term appears in fee reval and position values |
| Intra-day fee valuation | Optional: value each swap's fee at the swap price using pool `Swap` events and per-swap `feeGrowthGlobal` |
| Protocol fee switch | Already reflected in `feeGrowthGlobal` (LP share only); no adjustment needed |
| Timezone | All days in UTC; configurable in UI only for display |

---

## 10. UI suggestions

- Wallet input → list of positions (range, in-range status, current value).
- Daily table per position and for the whole wallet: §8.2 and §8.4 layouts, with a toggle between "daily" and "cumulative".
- Charts: closing NAV vs HODL value; stacked bars of daily P&L by category; lines for cumulative realised, unrealised and total P&L.
- Reconciliation badge per row (green if all §7 checks pass).
- Export rows as CSV/JSON.
