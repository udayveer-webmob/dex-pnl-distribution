import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { requireEnv } from "@/lib/env";

const globalForViem = globalThis as unknown as { viemClient?: PublicClient };

/**
 * Alchemy mainnet client. Reads are batched into JSON-RPC batches rather than Multicall3,
 * because Multicall3 does not exist at blocks before March 2022 and backfills read old blocks.
 */
export function chain(): PublicClient {
  if (!globalForViem.viemClient) {
    const url = `https://eth-mainnet.g.alchemy.com/v2/${requireEnv("ALCHEMY_API_KEY")}`;
    globalForViem.viemClient = createPublicClient({
      chain: mainnet,
      transport: http(url, { batch: { batchSize: 50, wait: 10 }, retryCount: 4, retryDelay: 500 }),
    }) as PublicClient;
  }
  return globalForViem.viemClient;
}
