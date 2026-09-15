import type { MarketRegime, MarketRegimeId, MarketSnapshot, ResearchAgentWeights } from "./types";
import { normalizeResearchWeights } from "./learning";

const pct = (n: number | undefined, fallback = 0) => Number.isFinite(n) ? Number(n) : fallback;

// V2.7: historical-candle validation showed the favorable-regime gates were too restrictive.
// Only expansion/risk-on regimes receive the -5 entry adjustment. Defensive and no-trade regimes are unchanged.
const definitions: Record<MarketRegimeId, Omit<MarketRegime, "confidence" | "reasons">> = {
  meme_expansion: { id: "meme_expansion", label: "Meme Expansion", tradeAllowed: true, minAlphaScore: 61, minCouncilConviction: 67, positionSizeMultiplier: 0.9 },
  new_chain_mania: { id: "new_chain_mania", label: "New-Chain Mania", tradeAllowed: true, minAlphaScore: 63, minCouncilConviction: 69, positionSizeMultiplier: 0.82 },
  risk_on_trend: { id: "risk_on_trend", label: "Risk-On Trend", tradeAllowed: true, minAlphaScore: 59, minCouncilConviction: 65, positionSizeMultiplier: 1 },
  sideways_chop: { id: "sideways_chop", label: "Sideways / Chop", tradeAllowed: true, minAlphaScore: 72, minCouncilConviction: 76, positionSizeMultiplier: 0.58 },
  high_volatility: { id: "high_volatility", label: "High Volatility", tradeAllowed: true, minAlphaScore: 76, minCouncilConviction: 80, positionSizeMultiplier: 0.45 },
  risk_off: { id: "risk_off", label: "Risk-Off", tradeAllowed: true, minAlphaScore: 82, minCouncilConviction: 84, positionSizeMultiplier: 0.28 },
  panic_crash: { id: "panic_crash", label: "Panic / Crash", tradeAllowed: false, minAlphaScore: 95, minCouncilConviction: 95, positionSizeMultiplier: 0 },
  low_liquidity: { id: "low_liquidity", label: "Low Liquidity", tradeAllowed: false, minAlphaScore: 95, minCouncilConviction: 95, positionSizeMultiplier: 0 },
};

export function classifyMarketRegime(snapshot: MarketSnapshot): MarketRegime {
  const c = snapshot.context ?? {};
  const benchmark24h = pct(c.benchmark24hPct, 0);
  const benchmark7d = pct(c.benchmark7dPct, 0);
  const chainVolumeChange = pct(c.chainVolumeChangePct, snapshot.volumeAccelerationPct ?? snapshot.socialVelocityPct * 0.18);
  const newPairsChange = pct(c.newPairsChangePct, 0);
  const liquidityRatioPct = snapshot.marketCap > 0 ? snapshot.liquidity / snapshot.marketCap * 100 : 0;
  const reasons: string[] = [];

  let id: MarketRegimeId = "sideways_chop";
  let confidence = 58;

  if (snapshot.liquidity < 20_000 || liquidityRatioPct < 1.2) {
    id = "low_liquidity";
    confidence = 92;
    reasons.push(`Executable liquidity is thin at $${Math.round(snapshot.liquidity).toLocaleString()}.`);
  } else if (benchmark24h <= -7 || (snapshot.priceChange24h <= -32 && snapshot.volatility >= 0.82)) {
    id = "panic_crash";
    confidence = 90;
    reasons.push(`Market/candidate drawdown is consistent with a panic regime (${benchmark24h.toFixed(1)}% benchmark 24h).`);
  } else if (snapshot.volatility >= 0.86) {
    id = "high_volatility";
    confidence = 82;
    reasons.push(`Volatility is extreme at ${(snapshot.volatility * 100).toFixed(0)}%.`);
  } else if ((newPairsChange >= 90 || chainVolumeChange >= 80) && snapshot.socialVelocityPct >= 180 && snapshot.ageMinutes < 1440) {
    id = "new_chain_mania";
    confidence = 79;
    reasons.push(`Chain activity is accelerating (${chainVolumeChange.toFixed(0)}%) with elevated new-pair/narrative activity.`);
  } else if (snapshot.ageMinutes < 720 && snapshot.socialVelocityPct >= 170 && snapshot.buySellRatio >= 1.35 && snapshot.priceChange24h >= 8) {
    id = "meme_expansion";
    confidence = 80;
    reasons.push("Young token + accelerating attention + buy-side flow indicates meme expansion conditions.");
  } else if (benchmark24h >= 1.5 || (benchmark7d >= 5 && snapshot.buySellRatio >= 1.15)) {
    id = "risk_on_trend";
    confidence = 72;
    reasons.push(`Broader trend is constructive (${benchmark24h.toFixed(1)}% 24h / ${benchmark7d.toFixed(1)}% 7d proxy).`);
  } else if (benchmark24h <= -2.5 || snapshot.priceChange24h <= -12) {
    id = "risk_off";
    confidence = 75;
    reasons.push(`Risk appetite is deteriorating (${benchmark24h.toFixed(1)}% benchmark proxy).`);
  } else {
    reasons.push("No strong expansion or crash signal; require stronger alpha before deploying capital.");
  }

  const base = definitions[id];
  if (liquidityRatioPct < 4) reasons.push(`Liquidity/market-cap ratio is only ${liquidityRatioPct.toFixed(1)}%.`);
  if (snapshot.smartMoneyBuys > snapshot.smartMoneySells * 2) reasons.push("Tracked smart-money flow is constructive.");
  return { ...base, confidence, reasons };
}

const biasByRegime: Record<MarketRegimeId, Partial<ResearchAgentWeights>> = {
  meme_expansion: { launch: 1.3, social: 1.22, wallet: 1.28, quant: 1.05, contract: 1.0, bear: 0.95 },
  new_chain_mania: { launch: 1.22, social: 1.12, wallet: 1.25, quant: 1.08, contract: 1.1, bear: 1.02 },
  risk_on_trend: { launch: 1.05, social: 0.95, wallet: 1.12, quant: 1.18, contract: 1.0, bear: 0.92 },
  sideways_chop: { launch: 0.85, social: 0.82, wallet: 1.02, quant: 1.3, contract: 1.05, bear: 1.15 },
  high_volatility: { launch: 0.75, social: 0.72, wallet: 1.0, quant: 1.22, contract: 1.18, bear: 1.35 },
  risk_off: { launch: 0.62, social: 0.58, wallet: 0.9, quant: 1.2, contract: 1.28, bear: 1.5 },
  panic_crash: { launch: 0.45, social: 0.4, wallet: 0.75, quant: 1.15, contract: 1.35, bear: 1.7 },
  low_liquidity: { launch: 0.55, social: 0.5, wallet: 0.82, quant: 1.05, contract: 1.45, bear: 1.55 },
};

export function applyRegimeWeightBias(weights: ResearchAgentWeights, regime: MarketRegime): ResearchAgentWeights {
  const bias = biasByRegime[regime.id];
  return normalizeResearchWeights({
    launch: weights.launch * Number(bias.launch ?? 1),
    social: weights.social * Number(bias.social ?? 1),
    wallet: weights.wallet * Number(bias.wallet ?? 1),
    quant: weights.quant * Number(bias.quant ?? 1),
    contract: weights.contract * Number(bias.contract ?? 1),
    bear: weights.bear * Number(bias.bear ?? 1),
  });
}
