// CoinGecko USD prices, with an in-memory series per token and a TokenPrice table cache.
//
// Live prices (timestamps within a few minutes of now) use /simple endpoints. Historical prices
// use market_chart/range over windows of <= 90 days, which CoinGecko returns at hourly
// granularity, and pick the point nearest the requested timestamp.

import { coingeckoPlan, requireEnv } from "@/lib/env";
import { db } from "@/lib/db";

export const ETH = "eth"; // key for native ether (gas)

const LIVE_WINDOW_S = 600;
const LIVE_TTL_MS = 60_000;
const WINDOW_S = 89 * 86400;
const MAX_GAP_S = 2 * 86400; // a historical point further away than this is not trusted

type Point = [number, number]; // [unix seconds, usd]

const live = new Map<string, { usd: number; at: number }>();
const series = new Map<string, { from: number; to: number; points: Point[] }[]>();

let lastRequest = 0;

async function cg<T>(path: string): Promise<T> {
  const pro = coingeckoPlan() === "pro";
  const base = pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  const header = pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key";
  const spacing = pro ? 150 : 2100; // stay under the plan's per-minute limit

  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + spacing - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();

    const res = await fetch(`${base}${path}`, { headers: { [header]: requireEnv("COINGECKO_API_KEY") } });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`CoinGecko ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function livePrice(token: string): Promise<number> {
  const hit = live.get(token);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.usd;

  let usd: number | undefined;
  if (token === ETH) {
    usd = (await cg<{ ethereum?: { usd: number } }>("/simple/price?ids=ethereum&vs_currencies=usd")).ethereum?.usd;
  } else {
    const r = await cg<Record<string, { usd?: number }>>(
      `/simple/token_price/ethereum?contract_addresses=${token}&vs_currencies=usd`,
    );
    usd = r[token]?.usd;
  }
  if (usd === undefined) throw new Error(`CoinGecko has no USD price for ${token}`);

  live.set(token, { usd, at: Date.now() });
  await db()
    .tokenPrice.upsert({
      where: { token_timestamp: { token, timestamp: new Date(Math.floor(Date.now() / 60_000) * 60_000) } },
      create: { token, timestamp: new Date(Math.floor(Date.now() / 60_000) * 60_000), usd },
      update: { usd },
    })
    .catch(() => undefined);
  return usd;
}

function nearest(points: Point[], ts: number): Point | undefined {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0) return undefined;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= ts) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo][0] - ts) <= Math.abs(points[hi][0] - ts) ? points[lo] : points[hi];
}

async function loadWindow(token: string, ts: number) {
  const now = Math.floor(Date.now() / 1000);
  const from = ts - 86400;
  const to = Math.min(now, from + WINDOW_S);

  // Try the DB cache first.
  const cached = await db().tokenPrice.findMany({
    where: { token, timestamp: { gte: new Date(from * 1000), lte: new Date(to * 1000) } },
    orderBy: { timestamp: "asc" },
  });
  let points: Point[] = cached.map((p) => [Math.floor(p.timestamp.getTime() / 1000), p.usd]);
  const covered = points.length > 0 && points[0][0] - from < 7200 && to - points[points.length - 1][0] < 7200;

  if (!covered) {
    const path =
      token === ETH
        ? `/coins/ethereum/market_chart/range?vs_currency=usd&from=${from}&to=${to}`
        : `/coins/ethereum/contract/${token}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
    const r = await cg<{ prices: [number, number][] }>(path);
    points = r.prices.map(([ms, usd]) => [Math.floor(ms / 1000), usd]);
    await db()
      .tokenPrice.createMany({
        data: points.map(([s, usd]) => ({ token, timestamp: new Date(s * 1000), usd })),
        skipDuplicates: true,
      })
      .catch(() => undefined);
  }

  const windows = series.get(token) ?? [];
  windows.push({ from, to, points });
  series.set(token, windows);
  return points;
}

/** USD price of `token` (lowercase address, or ETH) at unix time `ts`. */
export async function usdPrice(token: string, ts: number): Promise<number> {
  token = token.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  if (now - ts <= LIVE_WINDOW_S) return livePrice(token);

  const window = series.get(token)?.find((w) => ts >= w.from && ts <= w.to);
  const points = window ? window.points : await loadWindow(token, ts);
  const p = nearest(points, ts);
  if (!p || Math.abs(p[0] - ts) > MAX_GAP_S) {
    throw new Error(`No CoinGecko price for ${token} near ${new Date(ts * 1000).toISOString()}`);
  }
  return p[1];
}
