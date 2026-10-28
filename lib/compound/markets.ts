import { parseAbi } from "viem";

// Compound III (Comet) markets supported for base-asset supply tracking. Addresses verified on-chain
// against compound-v3-weth-supply-pnl-spec.md §3. Add more markets here (with a USD price feed for
// their base asset) to track them too.

export interface CometMarket {
  key: string; // stable id used in position keys
  name: string;
  comet: `0x${string}`;
  rewards: `0x${string}`;
  baseSymbol: string;
  baseDecimals: number;
  /** Chainlink USD feed for the base asset (Comet's own feed for this market is quoted in ETH). */
  baseUsdFeed: `0x${string}`;
  compUsdFeed: `0x${string}`;
  baseIsEth: boolean;
  deployBlock: bigint;
}

export const COMET_MARKETS: CometMarket[] = [
  {
    key: "cwethv3",
    name: "Compound III · WETH",
    comet: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
    rewards: "0x1B0e765F6224C21223AeA2af16c1C46E38885a40",
    baseSymbol: "WETH",
    baseDecimals: 18,
    baseUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // Chainlink ETH/USD
    compUsdFeed: "0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5", // Chainlink COMP/USD
    baseIsEth: true,
    deployBlock: 16400710n,
  },
];

export const COMP_DECIMALS = 18;

export function marketByComet(comet: string): CometMarket {
  const m = COMET_MARKETS.find((x) => x.comet.toLowerCase() === comet.toLowerCase());
  if (!m) throw new Error(`Unsupported Compound III market ${comet}`);
  return m;
}

/** Position key for a wallet's supply in a market (Position.tokenId). */
export const compoundPositionKey = (comet: string, wallet: string) => `${comet.toLowerCase()}:${wallet.toLowerCase()}`;

export const cometAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function userBasic(address account) view returns (int104 principal, uint64 baseTrackingIndex, uint64 baseTrackingAccrued, uint16 assetsIn, uint8 _reserved)",
  "function getUtilization() view returns (uint256)",
  "function getSupplyRate(uint256 utilization) view returns (uint64)",
  "event Supply(address indexed from, address indexed dst, uint256 amount)",
  "event Withdraw(address indexed src, address indexed to, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 amount)",
]);

export const cometRewardsAbi = parseAbi([
  // Non-view in the contract (it accrues first); called with eth_call.
  "function getRewardOwed(address comet, address account) view returns ((address token, uint256 owed))",
  "function rewardsClaimed(address comet, address account) view returns (uint256)",
  "event RewardClaimed(address indexed src, address indexed recipient, address indexed token, uint256 amount)",
]);

export const chainlinkAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);
