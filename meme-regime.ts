import { deriveLaunchVelocity } from "./launch-velocity";
import type { MarketRegime, MarketSnapshot, MemeRegime } from "./types";

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const ratio = (a: number, b: number) => b > 0 ? a / b : 0;

const launchpadVenue = (venue: string) => /pump|meteora|raydium|four\.meme|moonshot|launch|bonding/i.test(venue);

/**
 * Meme-native classification is deliberately token-first. Broad-market regime is context,
 * not a directional veto. Deterministic contract/liquidity/risk checks still remain outside
 * this classifier and can always block execution.
 */
export function classifyMemeRegime(snapshot: MarketSnapshot, marketRegime: MarketRegime): MemeRegime {
  const volumeToMc = ratio(snapshot.volume24h, Math.max(snapshot.marketCap, 1));
  const liquidityToMc = ratio(snapshot.liquidity, Math.max(snapshot.marketCap, 1));
  const holderGrowth = snapshot.holderGrowthPct ?? 0;
  const volumeAcceleration = snapshot.volumeAccelerationPct ?? 0;
  const launchVelocity = deriveLaunchVelocity(snapshot);

  let likelihood = 0;
  if (snapshot.assetClass === "meme") likelihood = 100;
  else {
    if (launchpadVenue(snapshot.venue)) likelihood += 24;
    if (snapshot.ageMinutes <= 1440) likelihood += 22;
    else if (snapshot.ageMinutes <= 10080) likelihood += 12;
    if (snapshot.marketCap <= 50_000_000) likelihood += 12;
    if (snapshot.priceChange24h >= 20) likelihood += 12;
    if (snapshot.socialVelocityPct >= 100) likelihood += 10;
    if (volumeToMc >= 0.35) likelihood += 12;
    if (holderGrowth >= 5) likelihood += 8;
    if (launchVelocity.compositeScore >= 65) likelihood += 10;
  }
  likelihood = Math.round(clamp(likelihood));
  const isMeme = snapshot.assetClass === "meme" || (snapshot.assetClass !== "standard" && likelihood >= 52);

  const momentum = clamp(45 + snapshot.priceChange24h * 0.42 + (snapshot.marketCapChange5mPct ?? 0) * 2.2);
  const volumeIntensity = clamp(35 + volumeToMc * 48 + Math.max(0, volumeAcceleration) * 0.11);
  const participation = clamp(42 + holderGrowth * 2.1 + Math.min(18, Math.log10(Math.max(10, snapshot.holders)) * 4));
  const liquidityQuality = clamp(38 + liquidityToMc * 650 + Math.min(20, snapshot.liquidity / 35_000));
  const flow = clamp(50 + (snapshot.buySellRatio - 1) * 30 + (snapshot.smartMoneyBuys - snapshot.smartMoneySells) * 4);
  const attention = clamp(35 + snapshot.socialVelocityPct * 0.18 + (snapshot.ageMinutes < 720 ? 9 : 0));
  const ageAsymmetry = clamp(82 - Math.log10(Math.max(snapshot.marketCap, 10_000) / 10_000) * 10 + (snapshot.ageMinutes < 720 ? 10 : snapshot.ageMinutes < 1440 ? 5 : 0));

  const breakoutScore = Math.round(clamp(
    momentum * 0.19 +
    volumeIntensity * 0.17 +
    participation * 0.11 +
    liquidityQuality * 0.10 +
    flow * 0.09 +
    attention * 0.07 +
    ageAsymmetry * 0.10 +
    launchVelocity.compositeScore * 0.17,
  ));

  const contextModifierByRegime: Record<MarketRegime["id"], number> = {
    meme_expansion: 1,
    new_chain_mania: 1,
    risk_on_trend: 1,
    sideways_chop: 0.9,
    high_volatility: 0.78,
    risk_off: 0.72,
    panic_crash: 0.58,
    low_liquidity: 0,
  };
  const broadMarketModifier = contextModifierByRegime[marketRegime.id];

  let id: MemeRegime["id"] = "not_meme";
  let label = "Standard Asset";
  let entryAllowed = false;
  let minAlphaScore = 100;
  let minCouncilConviction = 100;
  let requiredResearchSupport = 6;
  let starterPositionMultiplier = 0;
  const reasons: string[] = [];

  const exhausted = snapshot.priceChange24h >= 220 && snapshot.buySellRatio < 0.72 && volumeAcceleration < 0;
  if (!isMeme) {
    reasons.push(`Meme likelihood ${likelihood}/100; use the standard market-regime lane.`);
  } else if (marketRegime.id === "low_liquidity" || snapshot.liquidity < 20_000 || liquidityToMc < 0.012) {
    id = "meme_unsafe";
    label = "Meme Unsafe / Thin Liquidity";
    reasons.push("Meme-specific momentum cannot overrule executable-liquidity requirements.");
  } else if (exhausted) {
    id = "meme_exhaustion";
    label = "Meme Exhaustion";
    minAlphaScore = 78;
    minCouncilConviction = 80;
    requiredResearchSupport = 5;
    starterPositionMultiplier = 0.25 * broadMarketModifier;
    reasons.push("Price is extended while buy-side flow and acceleration are deteriorating.");
  } else if (breakoutScore >= 82) {
    id = "meme_acceleration";
    label = "Meme Acceleration";
    entryAllowed = true;
    minAlphaScore = 52;
    minCouncilConviction = 64;
    requiredResearchSupport = 4;
    starterPositionMultiplier = 0.72 * broadMarketModifier;
    reasons.push(`Token-specific breakout score is ${breakoutScore}/100: acceleration can trade independently of broad-market direction.`);
  } else if (breakoutScore >= 70) {
    id = "meme_breakout";
    label = "Meme Breakout";
    entryAllowed = true;
    minAlphaScore = 54;
    minCouncilConviction = 65;
    requiredResearchSupport = 4;
    starterPositionMultiplier = 0.56 * broadMarketModifier;
    reasons.push(`Token-specific breakout score is ${breakoutScore}/100: allow a small starter if the council confirms.`);
  } else {
    id = "meme_discovery";
    label = "Meme Discovery";
    minAlphaScore = 62;
    minCouncilConviction = 68;
    requiredResearchSupport = 4;
    starterPositionMultiplier = 0.35 * broadMarketModifier;
    reasons.push(`Meme-like candidate detected, but breakout evidence is only ${breakoutScore}/100.`);
  }

  if (isMeme && marketRegime.id !== "meme_expansion" && marketRegime.id !== "new_chain_mania") {
    reasons.push(`${marketRegime.label} now modifies sizing instead of automatically deciding a meme trade.`);
  }
  if (snapshot.buySellRatio < 1) reasons.push(`Buy/sell ratio is ${snapshot.buySellRatio.toFixed(2)}x; this weakens the case but is not a standalone meme veto.`);
  if (holderGrowth >= 8) reasons.push(`Holder participation is expanding (${holderGrowth.toFixed(1)}% proxy).`);
  if (volumeToMc >= 0.75) reasons.push(`24h volume is ${volumeToMc.toFixed(2)}x market cap, consistent with exceptional attention/turnover.`);
  if (isMeme && snapshot.ageMinutes <= 1440) reasons.push(`Launch velocity is ${launchVelocity.compositeScore.toFixed(0)}/100 · ${launchVelocity.holdersPerMinute.toFixed(2)} holders/min · $${Math.round(launchVelocity.volumeUsdPerMinute).toLocaleString()}/min volume.`);

  return {
    id,
    label,
    isMeme,
    likelihood,
    breakoutScore,
    launchVelocityScore: launchVelocity.compositeScore,
    holdersPerMinute: launchVelocity.holdersPerMinute,
    volumeUsdPerMinute: launchVelocity.volumeUsdPerMinute,
    entryAllowed,
    minAlphaScore,
    minCouncilConviction,
    requiredResearchSupport,
    starterPositionMultiplier: Number(Math.max(0, starterPositionMultiplier).toFixed(3)),
    broadMarketModifier,
    reasons,
  };
}
