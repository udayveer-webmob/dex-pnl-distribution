// Environment access. Values are read lazily so the app can start (and tell the user what is
// missing) before .env is filled in.

const REQUIRED = ["DATABASE_URL", "ALCHEMY_API_KEY", "COINGECKO_API_KEY"] as const;
type RequiredKey = (typeof REQUIRED)[number];

export class ConfigError extends Error {}

export function requireEnv(key: RequiredKey): string {
  const value = process.env[key]?.trim();
  if (!value) throw new ConfigError(`${key} is not set in .env`);
  return value;
}

export function missingEnv(): RequiredKey[] {
  return REQUIRED.filter((k) => !process.env[k]?.trim());
}

export function coingeckoPlan(): "demo" | "pro" {
  return process.env.COINGECKO_PLAN?.trim().toLowerCase() === "pro" ? "pro" : "demo";
}

export function pollIntervalMs(): number {
  const seconds = Number(process.env.POLL_INTERVAL_SECONDS);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 120) * 1000;
}
