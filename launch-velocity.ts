import type { LaunchMetrics, MarketSnapshot } from "./types";

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const logScore = (value: number, divisor: number, base = 25, scale = 36) => clamp(base + Math.log10(1 + Math.max(0, value) / divisor) * scale);

export type LaunchVelocity = {
  ageWindowMinutes: number;
  holdersPerMinute: number;
  transactionsPerMinute: number | null;
  uniqueBuyersPerMinute: number | null;
  volumeUsdPerMinute: number;
  liquidityFormationUsdPerMinute: number;
  holderScore: number;
  transactionScore: number;
  buyerScore: number;
  volumeScore: number;
  liquidityScore: number;
  accelerationScore: number;
  compositeScore: number;
  directFields: string[];
  fallbackFields: string[];
  reasons: string[];
};

/**
 * V2.10 converts newborn-token totals into rates the Council can reason about.
 * For tokens younger than 24h, 24h totals are effectively "since launch" totals,
 * so holders/age and volume/age are meaningful conservative fallback rates.
 * Direct provider rates always win when supplied through snapshot.launchMetrics.
 */
export function deriveLaunchVelocity(snapshot: MarketSnapshot): LaunchVelocity {
  const metrics: LaunchMetrics = snapshot.launchMetrics ?? {};
  const ageWindowMinutes = Math.max(1, Math.min(1440, snapshot.ageMinutes));
  const newborn = snapshot.ageMinutes <= 1440;
  const directFields: string[] = [];
  const fallbackFields: string[] = [];

  const choose = (name: keyof LaunchMetrics, direct: number | undefined, fallback: number | null): number | null => {
    if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) {
      directFields.push(String(name));
      return direct;
    }
    if (fallback !== null && Number.isFinite(fallback) && fallback >= 0) {
      fallbackFields.push(String(name));
      return fallback;
    }
    return null;
  };

  const holdersPerMinute = choose("holdersPerMinute", metrics.holdersPerMinute, newborn ? snapshot.holders / ageWindowMinutes : null) ?? 0;
  const volumeUsdPerMinute = choose("volumeUsdPerMinute", metrics.volumeUsdPerMinute, newborn ? snapshot.volume24h / ageWindowMinutes : null) ?? 0;
  const liquidityFormationUsdPerMinute = choose("liquidityAddedUsdPerMinute", metrics.liquidityAddedUsdPerMinute, newborn ? snapshot.liquidity / ageWindowMinutes : null) ?? 0;
  const transactionsPerMinute = choose("transactionsPerMinute", metrics.transactionsPerMinute, null);
  const uniqueBuyersPerMinute = choose("uniqueBuyersPerMinute", metrics.uniqueBuyersPerMinute, null);

  const holderScore = logScore(holdersPerMinute, 0.8, 24, 38);
  const volumeScore = logScore(volumeUsdPerMinute, 1_000, 24, 34);
  const liquidityScore = logScore(liquidityFormationUsdPerMinute, 100, 24, 32);
  const transactionScore = transactionsPerMinute === null ? 50 : logScore(transactionsPerMinute, 2, 24, 34);
  const buyerScore = uniqueBuyersPerMinute === null ? 50 : logScore(uniqueBuyersPerMinute, 0.5, 24, 34);

  const accelerationInputs = [
    metrics.holderAccelerationPct,
    metrics.transactionAccelerationPct,
    metrics.volumeAccelerationPct,
    snapshot.volumeAccelerationPct,
    snapshot.holderGrowthPct,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const avgAcceleration = accelerationInputs.length ? accelerationInputs.reduce((a, b) => a + b, 0) / accelerationInputs.length : 0;
  const accelerationScore = clamp(50 + avgAcceleration * 0.22);

  const compositeScore = Number(clamp(
    holderScore * 0.28 +
    volumeScore * 0.27 +
    transactionScore * 0.15 +
    buyerScore * 0.10 +
    liquidityScore * 0.12 +
    accelerationScore * 0.08,
  ).toFixed(1));

  const reasons = [
    `${holdersPerMinute.toFixed(2)} holders/min`,
    `$${Math.round(volumeUsdPerMinute).toLocaleString()}/min volume pace`,
    `$${Math.round(liquidityFormationUsdPerMinute).toLocaleString()}/min liquidity-formation proxy`,
  ];
  if (transactionsPerMinute !== null) reasons.push(`${transactionsPerMinute.toFixed(1)} transactions/min`);
  if (uniqueBuyersPerMinute !== null) reasons.push(`${uniqueBuyersPerMinute.toFixed(2)} unique buyers/min`);
  if (fallbackFields.length) reasons.push(`Fallback rates derived from newborn-token totals: ${fallbackFields.join(", ")}`);

  return {
    ageWindowMinutes,
    holdersPerMinute,
    transactionsPerMinute,
    uniqueBuyersPerMinute,
    volumeUsdPerMinute,
    liquidityFormationUsdPerMinute,
    holderScore: Number(holderScore.toFixed(1)),
    transactionScore: Number(transactionScore.toFixed(1)),
    buyerScore: Number(buyerScore.toFixed(1)),
    volumeScore: Number(volumeScore.toFixed(1)),
    liquidityScore: Number(liquidityScore.toFixed(1)),
    accelerationScore: Number(accelerationScore.toFixed(1)),
    compositeScore,
    directFields,
    fallbackFields,
    reasons,
  };
}
