# Compound III WETH Supply Position – Day-wise P&L Specification

Specification for a web app that tracks a wallet's **supply position in the Compound III WETH market (cWETHv3)** and reports **realised** and **unrealised** P&L, broken down **day by day**.

Reporting currency: **USD**.
Scope: supplying the base asset (WETH/ETH). Borrowing and collateral positions are out of scope (see §9).

---

## 1. Core idea

At the end of every day (the **snapshot**), the app values everything and explains the change in net value since the previous snapshot:

```
Closing NAV = Opening NAV
            + Interest income        (realised)
            + COMP reward income     (realised)
            + Gas cost               (realised, negative)
            + Interest revaluation   (unrealised)
            + COMP revaluation       (unrealised)
            + ETH price effect       (unrealised)
            + Capital flows          (not P&L)
```

Differences from a Uniswap v3 LP position:

- **No impermanent loss.** Nothing rebalances the position; it is always 100% ETH.
- **Interest is paid in ETH** and added directly to the supplied balance (no claiming).
- **COMP rewards** are a separate income stream in a third token, accrued until claimed.
- **HODL benchmark = the ETH deposited**, so edge over holding = interest + COMP − gas.

Two moments **move** P&L from unrealised to realised without changing the total:

- Withdrawing ETH realises the price effect and interest revaluation on the withdrawn share.
- Claiming COMP realises the accumulated COMP revaluation on the claimed amount.

Invariant checked every day:

```
Cum. realised + Cum. unrealised = Total P&L = Closing NAV − Net capital deposited
```

---

## 2. P&L categories

### 2.1 Realised (locked in, never reverses)

| Category | Definition | Recorded when |
|---|---|---|
| `interestIncome` | ETH interest accrued during the day × ETH closing price | Daily |
| `compIncome` | COMP accrued during the day × COMP closing price | Daily, claimed or not |
| `gasCost` | Gas for supply / withdraw / claim txs × ETH price at tx (negative) | At each tx |
| `realisedPriceEffect` | ETH price effect on the withdrawn share of principal | On `Withdraw` |
| `realisedInterestReval` | Accumulated revaluation on the withdrawn share of accrued interest | On `Withdraw` |
| `realisedCompReval` | Accumulated revaluation on COMP at the moment it is claimed | On `RewardClaimed` |

### 2.2 Unrealised (mark-to-market, can reverse)

| Category | Definition |
|---|---|
| `priceEffect` | ETH principal × change in ETH price |
| `interestReval` | Interest ETH accrued on earlier days × change in ETH price |
| `compReval` | Unclaimed COMP from earlier days × change in COMP price |

### 2.3 Not P&L

| Category | Definition |
|---|---|
| `capitalIn` | USD value of ETH supplied (at event price) |
| `capitalOut` | USD value of ETH withdrawn (at event price) |
| `compClaimed` | COMP leaving the protocol on claim; value already counted as income + reval |

> **Principal vs interest split.** Compound III does not separate them on-chain; the tracker does. Principal = ETH deposited − principal withdrawn. Interest accrued = supplied balance − principal. On a withdrawal, the withdrawn amount is split pro rata between principal and accrued interest (§4.6).

> **Fee realisation event.** A wallet tracker cannot follow tokens after they leave the protocol, so COMP is treated as realised at the claim price and withdrawn ETH at the withdrawal price.

---

## 3. Data sources

Ethereum mainnet. Verify all addresses against the official Compound docs before use.

| Data | Source |
|---|---|
| Market contract | Comet cWETHv3 proxy `0xA17581A9E3356d9A858b789D68B4d866e593aE94` |
| Supplied balance incl. interest | `comet.balanceOf(wallet)` (WETH, 18 decimals) |
| Stored principal (scaled) | `comet.userBasic(wallet).principal` (positive = supplier) |
| Supply rate | `comet.getSupplyRate(comet.getUtilization())` → per-second rate, 1e18 scale |
| Supply / withdraw events | `Supply(from, dst, amount)`, `Withdraw(src, to, amount)` on Comet; ETH deposits via the Bulker still emit `Supply` |
| COMP owed | `CometRewards.getRewardOwed(comet, wallet)` via `eth_call` (non-view function) – CometRewards `0x1B0e765F6224C21223AeA2af16c1C46E38885a40` |
| COMP claimed | `CometRewards.rewardsClaimed(comet, wallet)` and `RewardClaimed(src, recipient, token, amount)` events |
| ETH price | Chainlink ETH/USD `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` (or `comet.getPrice(baseTokenPriceFeed)`) |
| COMP price | Chainlink COMP/USD `0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5` |
| Gas | Tx receipt: `gasUsed × effectiveGasPrice` |
| Snapshot block | Last block with timestamp < 00:00 UTC of the next day |

All reads for a snapshot use the **same block number**.

---

## 4. Formulas

Notation: `P` = ETH price (USD), `C` = COMP price (USD), `B` = supplied balance (ETH), `p` = principal (ETH), `I` = accrued interest (ETH), `K` = unclaimed COMP.

### 4.1 Balance

```
B_t = comet.balanceOf(wallet) at block_t / 1e18
I_t = B_t − p_t
```

Internally: `B = principal × baseSupplyIndex / 1e15`; the index grows every second at the supply rate.

### 4.2 Supply rate (for display / projections only)

```
ratePerSecond = getSupplyRate(getUtilization()) / 1e18
APR           = ratePerSecond × 31,536,000
APY           = (1 + ratePerSecond)^31,536,000 − 1
```

P&L always uses the **measured** balance change, never the projected rate.

### 4.3 Interest income for a day

```
interestETH_t   = B_t − B_{t−1} − supplied_t + withdrawn_t      // ETH, flows during the day
interestIncome_t = interestETH_t × P_t
```

Valued at the day's closing price (no intra-day revaluation).

### 4.4 Revaluation and price effect

```
priceEffect_t   = p_{t−1} × (P_t − P_{t−1})        // principal held at previous snapshot
interestReval_t = I_{t−1} × (P_t − P_{t−1})        // interest accrued before today
```

`p × ΔP + I × ΔP = B × ΔP`: together they equal what holding the supplied ETH would have done. The split shows how much of the move is on capital vs. on earnings.

### 4.5 COMP rewards

```
earnedCOMP_t  = getRewardOwed_t + rewardsClaimed_t           // cumulative, never decreases
newCOMP_t     = earnedCOMP_t − earnedCOMP_{t−1}
compIncome_t  = newCOMP_t × C_t
compReval_t   = K_{t−1} × (C_t − C_{t−1})
K_t           = getRewardOwed_t
```

If the market has no reward speed (`baseTrackingSupplySpeed = 0`), all COMP fields are zero.

### 4.6 Realisation on withdrawal

Withdraw amount `w` (ETH) when the balance before is `B`:

```
f = w / B                                  // share of position withdrawn
principalOut = f × p ;   interestOut = f × I

realisedPriceEffect   += f × cumUnrealisedPriceEffect
realisedInterestReval += f × cumUnrealisedInterestReval
cumUnrealisedPriceEffect   ×= (1 − f)
cumUnrealisedInterestReval ×= (1 − f)
p ×= (1 − f) ;  costBasis ×= (1 − f)
capitalOut += w × P_at_withdraw
```

### 4.7 Realisation on COMP claim

```
share = claimed / K_before
realisedCompReval += share × cumUnrealisedCompReval
cumUnrealisedCompReval ×= (1 − share)
```

### 4.8 Deposit

```
p += amount ;  costBasis += amount × P_at_deposit ;  capitalIn += amount × P_at_deposit
```

### 4.9 Gas

```
gasCost = −(gasUsed × effectiveGasPrice / 1e18) × P_at_tx
```

---

## 5. Daily algorithm

```
for each day d in [startDate .. today]:
    block_d = lastBlockBefore(midnightUTC(d + 1))

    events_d = Supply / Withdraw (Comet) and RewardClaimed (CometRewards)
               for wallet in (block_{d−1}, block_d], sorted by block, logIndex

    checkpoints = [block_{d−1}] + [e.block for e in events_d] + [block_d]

    for each consecutive pair (a, b) in checkpoints:
        state_b = readState(block_b)            // B, K, P, C
        accumulate interestIncome, compIncome, priceEffect, interestReval, compReval from a → b
        if b is an event:
            Supply        → §4.8, gas
            Withdraw      → §4.6, gas
            RewardClaimed → §4.7, gas

    write DailyRow(d)
    assert reconciliation checks (§7)
```

---

## 6. Data model

### 6.1 `SupplySnapshot`

```json
{
  "market": "cWETHv3",
  "date": "2026-10-16",
  "block": 26200000,
  "ethPrice": 2400.00,
  "compPrice": 40.00,
  "suppliedBalanceEth": 4.117682,
  "principalEth": 4.116555,
  "interestAccruedEth": 0.001128,
  "unclaimedComp": 0.003383,
  "supplyApr": 0.02,
  "hodlEth": 4.116555,
  "hodlValue": 9879.73,
  "costBasis": 10000.00
}
```

### 6.2 `DailyPnlRow`

```json
{
  "date": "2026-10-16",
  "openingNav": 10084.81,
  "closingNav": 9877.61,

  "daily": {
    "interestIncome": 0.54,
    "compIncome": 0.14,
    "gasCost": -2.00,
    "interestReval": -0.05,
    "compReval": 0.00,
    "priceEffect": -205.83,
    "capitalIn": 0.00,
    "capitalOut": 0.00,
    "pnl": -207.20
  },

  "reclassified": {
    "priceEffectToRealised": -120.28,
    "interestRevalToRealised": 0.00,
    "compRevalToRealised": 0.00
  },

  "cumulative": {
    "realised": {
      "interestIncome": 2.69,
      "compIncome": 0.68,
      "gasCost": -5.50,
      "compReval": 0.02,
      "interestReval": 0.00,
      "priceEffect": -120.28,
      "total": -122.39
    },
    "unrealised": {
      "priceEffect": 0.00,
      "interestReval": 0.00,
      "compReval": 0.00,
      "total": 0.00
    },
    "totalPnl": -122.39
  },

  "checks": { "navReconciles": true, "pnlReconciles": true }
}
```

NAV = `B × P + K × C − cumulative gas + value of ETH withdrawn and COMP claimed at their exit prices`.

---

## 7. Reconciliation checks (run every day)

1. `closingNav = openingNav + daily.pnl + capitalIn − capitalOut`
2. `daily.pnl = interestIncome + compIncome + gasCost + interestReval + compReval + priceEffect`
3. `cum.realised.total + cum.unrealised.total = totalPnl`
4. `totalPnl = closingNav − Σ capitalIn + Σ capitalOut`
5. `B_t = p_t + I_t` and `B_t − B_{t−1} = interestETH_t + supplied_t − withdrawn_t`
6. `cum.unrealised.priceEffect = p × P − costBasis` and `cum.unrealised.interestReval = I × P − (income value of the interest still held)`
7. Reclassifications sum to zero across realised + unrealised on each day.

Tolerance: ±$0.01 per figure. Store full precision; round only for display.

---

## 8. Worked example (5 days)

Setup: $10,000 supplied at ETH = $2,429.22 → **4.116555 ETH**. Illustrative rates: **2.0% supply APR**, **0.5% COMP reward APR**, COMP ≈ $40. ETH price path matches the Uniswap v3 example.

Daily interest = balance × 2% ÷ 365 ≈ **0.000226 ETH/day**, added to the balance.

Events: Day 1 supply (gas $2.00) · Day 4 claim and sell COMP (gas $1.50) · Day 5 withdraw all and claim remaining COMP (gas $2.00).

### 8.1 State (end of day)

| Day | ETH close | COMP close | Supplied balance (ETH) | Interest that day (ETH) | Interest accrued (ETH, cum.) | Unclaimed COMP | HODL value |
|---|---|---|---|---|---|---|---|
| 0 | $2,429.22 | $40.00 | 4.116555 | – | 0.000000 | 0.000000 | $10,000.00 |
| 1 | $2,420.00 | $40.00 | 4.116780 | 0.000226 | 0.000226 | 0.003412 | $9,962.06 |
| 2 | $2,300.00 | $38.00 | 4.117006 | 0.000226 | 0.000451 | 0.006825 | $9,468.08 |
| 3 | $2,370.00 | $39.00 | 4.117231 | 0.000226 | 0.000677 | 0.010252 | $9,756.23 |
| 4 | $2,450.00 | $41.00 | 4.117457 | 0.000226 | 0.000902 | 0 (sold 0.013621 for $0.56) | $10,085.56 |
| 5 | $2,400.00 | $40.00 | 4.117682 (withdrawn) | 0.000226 | 0.001128 | 0 (claimed 0.003383) | $9,879.73 |

### 8.2 Daily P&L

| Day | Opening NAV | Interest (R) | COMP (R) | Gas (R) | Interest reval. (U) | COMP reval. (U) | ETH price effect (U) | Daily P&L | Closing NAV |
|---|---|---|---|---|---|---|---|---|---|
| 1 | $10,000.00 | +$0.55 | +$0.14 | −$2.00 | $0.00 | $0.00 | −$37.94 | −$39.25 | $9,960.75 |
| 2 | $9,960.75 | +$0.52 | +$0.13 | $0.00 | −$0.03 | −$0.01 | −$493.99 | −$493.38 | $9,467.37 |
| 3 | $9,467.37 | +$0.53 | +$0.13 | $0.00 | +$0.03 | +$0.01 | +$288.16 | +$288.86 | $9,756.23 |
| 4 | $9,756.23 | +$0.55 | +$0.14 | −$1.50 | +$0.05 | +$0.02 | +$329.32 | +$328.58 | $10,084.81 |
| 5 | $10,084.81 | +$0.54 | +$0.14 | −$2.00 | −$0.05 | $0.00 | −$205.83 | −$207.20 | $9,877.61 |

### 8.3 Reclassifications

| Day | Event | Out of unrealised | Into realised |
|---|---|---|---|
| 4 | COMP claimed and sold | COMP reval. +$0.02 | Realised COMP reval. +$0.02 |
| 5 | Full withdrawal | Price effect −$120.28, interest reval. $0.00 | Realised price effect −$120.28 |

### 8.4 Cumulative

| Day | Interest | COMP | Gas | Realised COMP reval. | Realised price effect | **Cum. realised** | Price effect (U) | Interest reval. (U) | COMP reval. (U) | **Cum. unrealised** | **Total P&L** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | $0.55 | $0.14 | −$2.00 | $0.00 | $0.00 | **−$1.31** | −$37.94 | $0.00 | $0.00 | **−$37.94** | **−$39.25** |
| 2 | $1.07 | $0.27 | −$2.00 | $0.00 | $0.00 | **−$0.66** | −$531.93 | −$0.03 | −$0.01 | **−$531.97** | **−$532.63** |
| 3 | $1.60 | $0.40 | −$2.00 | $0.00 | $0.00 | **$0.00** | −$243.77 | $0.00 | $0.00 | **−$243.77** | **−$243.77** |
| 4 | $2.15 | $0.54 | −$3.50 | $0.02 | $0.00 | **−$0.79** | +$85.55 | +$0.05 | $0.00 | **+$85.60** | **+$84.81** |
| 5 | $2.69 | $0.68 | −$5.50 | $0.02 | −$120.28 | **−$122.39** | $0.00 | $0.00 | $0.00 | **$0.00** | **−$122.39** |

Figures are rounded to the cent; components are summed from rounded values.

Summary: ETH price fall −$120.28 (same as holding, no IL); earnings $3.37 (interest $2.69 + COMP $0.68) vs gas $5.50 → **−$122.39 total, $2.12 worse than holding**. At these rates, $10,000 earns ≈ $0.69/day, so ~8 days are needed to cover this gas.

Use these rows as **unit-test fixtures** for the P&L engine.

---

## 9. Edge cases and options

| Case | Handling |
|---|---|
| Partial withdrawal | Split pro rata between principal and accrued interest (§4.6) |
| Additional deposit | Split the day at the event; add to principal, HODL ETH and cost basis |
| Supply via Bulker (native ETH) | Still emits `Supply` on Comet; read amount from the event |
| Transfer of Comet balance (`transfer`) | Out: treat as withdrawal at market price. In: treat as deposit at market price |
| Varying supply rate | No special handling: interest is measured from balance changes |
| COMP claimed to another address | Still realised for this wallet (`RewardClaimed.src = wallet`) |
| No reward programme | All COMP fields are zero |
| Wallet borrows (negative principal) | Out of scope; flag the position and skip |
| Collateral assets in the WETH market (e.g. wstETH) | Out of scope: collateral earns no interest; would be price effect + gas only |
| Protocol loss / bad debt | Absorbed by Comet reserves; if a supplier balance ever drops without a withdrawal, record it as a separate realised `protocolLoss` |
| Timezone | All days in UTC |

---

## 10. UI suggestions

- Wallet input → supplied balance, current APR/APY, unclaimed COMP.
- Daily table (§8.2) and cumulative table (§8.4) with a daily/cumulative toggle.
- Charts: closing NAV vs HODL value; cumulative interest + COMP vs cumulative gas (break-even line); cumulative realised, unrealised and total P&L.
- Reconciliation badge per row.
- Export rows as CSV/JSON.
- Shared engine with the Uniswap v3 tracker: same `DailyPnlRow` shape, with `ilChange` = 0 and income fields renamed per protocol.
