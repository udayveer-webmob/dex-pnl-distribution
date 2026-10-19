import { WETH } from "@/lib/chain/abis";

// Mainnet stablecoins, preferred as the CoinGecko-priced reference token.
const STABLES = new Set([
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0x853d955acef822db058eb8505911ed77f175b99e", // FRAX
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8", // PYUSD
  "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", // USDe
  "0x5f98805a4e8be255a32880fdec7f6728c6568ba0", // LUSD
  "0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f", // GHO
  "0xdc035d45d973e3ec169d2276ddab16f1e407384f", // USDS
]);
const MAJORS = [WETH, "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"]; // WETH, WBTC

/**
 * Which token's USD price is fetched from CoinGecko; the other is derived from the pool price.
 * Stablecoin first, then WETH/WBTC, otherwise token1.
 */
export function chooseReferenceToken(token0: string, token1: string): 0 | 1 {
  const [a, b] = [token0.toLowerCase(), token1.toLowerCase()];
  if (STABLES.has(a)) return 0;
  if (STABLES.has(b)) return 1;
  for (const m of MAJORS) {
    if (a === m) return 0;
    if (b === m) return 1;
  }
  return 1;
}

export const isWeth = (token: string) => token.toLowerCase() === WETH;
