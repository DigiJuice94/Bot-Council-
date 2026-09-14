import { deriveLaunchVelocity } from "./launch-velocity";
import type { AlphaComponent, AlphaSignal, MarketRegime, MarketSnapshot } from "./types";

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

function component(name: string, score: number, weight: number, note: string): AlphaComponent {
  return { name, score: Number(clamp(score).toFixed(1)), weight, note };
}

export function evaluateAlpha(snapshot: MarketSnapshot, regime: MarketRegime): AlphaSignal {
  const volumeAcceleration = snapshot.volumeAccelerationPct ?? Math.min(300, snapshot.socialVelocityPct * 0.35 + snapshot.priceChange24h * 2);
  const holderGrowth = snapshot.holderGrowthPct ?? Math.max(-10, Math.min(30, (snapshot.buySellRatio - 1) * 8 + snapshot.smartMoneyBuys - snapshot.smartMoneySells));
  const liquidityChange = snapshot.liquidityChangePct ?? 0;
  const marketCapAccel = snapshot.marketCapChange5mPct ?? snapshot.priceChange24h / 12;
  const liquidityRatio = snapshot.marketCap > 0 ? snapshot.liquidity / snapshot.marketCap : 0;
  const netSmart = snapshot.smartMoneyBuys - snapshot.smartMoneySells;
  const launchVelocity = deriveLaunchVelocity(snapshot);
  const newborn = snapshot.ageMinutes <= 1440;

  const momentum = component("Momentum", 50 + snapshot.priceChange24h * 0.8 + marketCapAccel * 3, 0.18, `${snapshot.priceChange24h.toFixed(1)}% 24h · ${marketCapAccel.toFixed(1)}% short-horizon MC proxy`);
  const volumeBase = 48 + volumeAcceleration * 0.18;
  const volume = component("Volume acceleration", newborn ? Math.max(volumeBase, launchVelocity.volumeScore) : volumeBase, 0.17, newborn ? `${volumeAcceleration.toFixed(0)}% acceleration proxy · $${Math.round(launchVelocity.volumeUsdPerMinute).toLocaleString()}/min launch volume` : `${volumeAcceleration.toFixed(0)}% acceleration proxy`);
  const flow = component("Order + wallet flow", 50 + (snapshot.buySellRatio - 1) * 28 + netSmart * 5, 0.2, `${snapshot.buySellRatio.toFixed(2)}x buy/sell · ${netSmart >= 0 ? "+" : ""}${netSmart} tracked smart flow`);
  const liquidity = component("Liquidity quality", 42 + liquidityRatio * 260 + Math.min(16, snapshot.liquidity / 50_000) + liquidityChange * 0.25, 0.16, `${(liquidityRatio * 100).toFixed(1)}% liquidity/MC · ${liquidityChange.toFixed(1)}% liquidity change`);
  const participationBase = 48 + holderGrowth * 2 + Math.min(12, Math.log10(Math.max(10, snapshot.holders)) * 3);
  const participation = component("Holder participation", newborn ? Math.max(participationBase, launchVelocity.holderScore) : participationBase, 0.11, newborn ? `${launchVelocity.holdersPerMinute.toFixed(2)} holders/min · ${snapshot.holders.toLocaleString()} holders` : `${holderGrowth.toFixed(1)}% holder-growth proxy · ${snapshot.holders.toLocaleString()} holders`);
  const asymmetryRaw = 72 - Math.log10(Math.max(snapshot.marketCap, 10_000) / 10_000) * 12 + (snapshot.ageMinutes < 180 ? 12 : snapshot.ageMinutes < 720 ? 6 : 0) + Math.min(12, snapshot.socialVelocityPct / 30) + (newborn ? Math.max(0, launchVelocity.compositeScore - 60) * 0.12 : 0);
  const asymmetry = component("Asymmetry", asymmetryRaw, 0.18, `${snapshot.ageMinutes}m old · $${Math.round(snapshot.marketCap).toLocaleString()} market cap`);

  const components = [momentum, volume, flow, liquidity, participation, asymmetry];
  const weighted = components.reduce((sum, row) => sum + row.score * row.weight, 0);
  const concentrationPenalty = Math.max(0, snapshot.top10Pct - 35) * 0.45 + Math.max(0, snapshot.bundledPct - 10) * 0.8;
  const volatilityPenalty = Math.max(0, snapshot.volatility - 0.65) * 28;
  const safetyPenalty = (!snapshot.sellable || snapshot.honeypot ? 100 : 0) + (snapshot.liquidityLocked ? 0 : 5);
  const score = Math.round(clamp(weighted - concentrationPenalty - volatilityPenalty - safetyPenalty));

  const upsideProxy = Math.max(1.2, 1 + clamp(asymmetry.score, 0, 100) / 34);
  const downsideProxy = Math.max(0.35, 1 + snapshot.volatility * 0.8 + concentrationPenalty / 30);
  const rewardRiskProxy = Number((upsideProxy / downsideProxy).toFixed(2));

  const reasons = [
    `Deterministic alpha score ${score}/100; regime requires ${regime.minAlphaScore}.`,
    `Reward/risk proxy ${rewardRiskProxy.toFixed(2)}x; asymmetry ${asymmetry.score.toFixed(0)}/100.`,
    ...(newborn ? [`Launch velocity ${launchVelocity.compositeScore.toFixed(0)}/100 · ${launchVelocity.holdersPerMinute.toFixed(2)} holders/min · $${Math.round(launchVelocity.volumeUsdPerMinute).toLocaleString()}/min volume.`] : []),
  ];
  if (!regime.tradeAllowed) reasons.push(`${regime.label} is configured as NO-TRADE regardless of candidate excitement.`);
  if (concentrationPenalty > 8) reasons.push("Concentration materially reduces expected edge.");
  if (flow.score >= 70) reasons.push("Order/wallet flow is confirming the setup.");
  if (liquidity.score < 50) reasons.push("Liquidity quality is weak enough to constrain execution.");

  const action: AlphaSignal["action"] = !regime.tradeAllowed || score < regime.minAlphaScore - 8
    ? "NO_TRADE"
    : score >= regime.minAlphaScore
      ? "TRADE"
      : "CAUTION";

  return {
    score,
    action,
    rewardRiskProxy,
    asymmetryScore: Math.round(asymmetry.score),
    components,
    reasons,
  };
}
