import type { ExitStrategy, MarketRegime, MarketSnapshot, RiskCheck } from "./types";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function entryLiquidityExitFloor(liquidityUsd: number, earlyRunner: boolean): number {
  return Math.max(earlyRunner ? 500 : 15_000, Math.round(liquidityUsd * 0.4));
}

export function buildExitStrategy(snapshot: MarketSnapshot, conviction: number, risk: RiskCheck, regime?: MarketRegime): ExitStrategy {
  const volPct = snapshot.volatility * 100;
  const favorable = regime?.id === "meme_expansion" || regime?.id === "new_chain_mania" || regime?.id === "risk_on_trend";
  const regimeTrailBonus = regime?.id === "meme_expansion" || regime?.id === "new_chain_mania" ? 4 : regime?.id === "high_volatility" ? 2 : 0;
  const regimeStopBonus = regime?.id === "high_volatility" ? 2 : regime?.id === "risk_off" ? -1 : 0;
  const stopLossPct = Number(clamp(8 + volPct * 0.08 + Math.max(0, 70 - risk.riskScore) * 0.05 + regimeStopBonus, 7, 20).toFixed(1));
  const trailingStopPct = Number(clamp(10 + volPct * 0.09 + regimeTrailBonus, 9, 26).toFixed(1));
  const maxHoldMinutes = snapshot.ageMinutes < 90 ? 360 : regime?.id === "sideways_chop" ? 480 : 720;
  const earlyRunnerPool = snapshot.marketCap >= 8_000 && snapshot.marketCap <= 80_000 && snapshot.ageMinutes <= 1_440;
  const firstTarget = conviction >= 88 ? 28 : conviction >= 80 ? 23 : conviction >= 72 ? 18 : 15;

  // Every trade is fully realizable; staged targets sum to 100% with no residual bag.
  const runnerSellPct = 35;
  const winnerTrailingStopPct = Number(clamp(trailingStopPct + (favorable ? 5 : 3), trailingStopPct, 32).toFixed(1));
  const winnerMaxHoldMinutes = favorable ? (regime?.id === "risk_on_trend" ? 2160 : 2880) : Math.max(maxHoldMinutes, 1440);

  return {
    stopLossPct,
    trailingStopPct,
    takeProfits: [
      { gainPct: firstTarget, sellPct: 18, label: "TP1" },
      { gainPct: Math.round(firstTarget * 2), sellPct: 22, label: "TP2" },
      { gainPct: Math.round(firstTarget * 3.5), sellPct: 25, label: "TP3" },
      { gainPct: Math.round(firstTarget * 6), sellPct: runnerSellPct, label: "Runner" },
    ],
    maxHoldMinutes,
    liquidityFloorUsd: entryLiquidityExitFloor(snapshot.liquidity, earlyRunnerPool),
    winnerActivationPct: Number(Math.max(6, firstTarget * 0.4).toFixed(1)),
    winnerTrailingStopPct,
    winnerMaxHoldMinutes,
    breakEvenBufferPct: 1.5,
    invalidationRules: [
      "Smart-money flow flips decisively net-sell",
      "Buy/sell ratio falls below 0.75x while price weakens",
      "Holder concentration or bundled supply breaches the deterministic cap",
      "Alpha score/regime deteriorates enough that the original entry thesis no longer exists",
      "Scale-ins are allowed only while profitable and reconfirmed; averaging down is forbidden",
    ],
    emergencyRules: [
      "Sellability or honeypot check fails",
      "Liquidity collapses below the position floor",
      "Mint/freeze authority or contract safety changes materially",
      "Portfolio daily-loss or exposure kill-switch fires",
    ],
  };
}
