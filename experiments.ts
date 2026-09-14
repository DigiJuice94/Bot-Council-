import type { Chain, ExperimentMetrics, ExperimentStage, ProfitabilityMetrics, StrategyExperiment } from "./types";

const thresholds = {
  backtest: { trades: 150, expectancyPct: 1.2, maxDrawdownPct: 25, profitFactor: 1.15 },
  oos: { trades: 75, expectancyPct: 0.8, maxDrawdownPct: 20, profitFactor: 1.1 },
  paper: { trades: 50, expectancyPct: 0.5, maxDrawdownPct: 15, profitFactor: 1.08 },
};

export function evaluatePromotion(stage: ExperimentStage, m: ExperimentMetrics, profitability?: ProfitabilityMetrics): { ready: boolean; reasons: string[] } {
  if (stage === "research") return { ready: true, reasons: ["Research hypothesis documented; ready for historical backtest."] };
  if (stage === "live" || stage === "paused" || stage === "rejected") return { ready: false, reasons: [`Stage ${stage} requires a manual governance decision.`] };

  const t = thresholds[stage as keyof typeof thresholds];
  if (!t) return { ready: false, reasons: ["No automatic promotion rules for this stage."] };
  const reasons: string[] = [];
  if (m.trades < t.trades) reasons.push(`Need ${t.trades - m.trades} more evaluated trades.`);
  if (m.expectancyPct < t.expectancyPct) reasons.push(`Expectancy ${m.expectancyPct.toFixed(2)}% is below ${t.expectancyPct.toFixed(2)}%.`);
  if (m.maxDrawdownPct > t.maxDrawdownPct) reasons.push(`Drawdown ${m.maxDrawdownPct.toFixed(1)}% exceeds ${t.maxDrawdownPct.toFixed(1)}%.`);
  if (m.profitFactor < t.profitFactor) reasons.push(`Profit factor ${m.profitFactor.toFixed(2)} is below ${t.profitFactor.toFixed(2)}.`);

  if (!profitability || profitability.source === "none" || profitability.source === "demo") {
    reasons.push("No reproducible historical/paper profitability benchmark is attached.");
  } else {
    if (profitability.totalReturnPct <= 0) reasons.push("Measured total return is not positive.");
    if (profitability.excessReturnPct <= 0) reasons.push("Strategy has not beaten the supplied baseline after costs.");
    if (profitability.positiveFoldPct < 70) reasons.push(`Only ${profitability.positiveFoldPct.toFixed(0)}% of walk-forward folds are positive; require 70%+.`);
    if (profitability.ruinProbabilityPct > 10) reasons.push(`Monte Carlo ruin probability ${profitability.ruinProbabilityPct.toFixed(1)}% exceeds 10%.`);
    if (profitability.sharpe < 0.75) reasons.push(`Sharpe ${profitability.sharpe.toFixed(2)} is below 0.75.`);
  }
  return { ready: reasons.length === 0, reasons: reasons.length ? reasons : ["All automatic profitability and risk promotion gates passed."] };
}

function demoMetrics(): ExperimentMetrics {
  return { trades: 0, winRatePct: 0, expectancyPct: 0, maxDrawdownPct: 0, profitFactor: 0, slippageBps: 0 };
}

export function createCoreExperiment(chains: Chain[], profitability?: ProfitabilityMetrics | null): StrategyExperiment {
  const metrics: ExperimentMetrics = profitability ? {
    trades: profitability.trades,
    winRatePct: profitability.winRatePct,
    expectancyPct: profitability.expectancyPct,
    maxDrawdownPct: profitability.maxDrawdownPct,
    profitFactor: profitability.profitFactor,
    slippageBps: profitability.slippageBps,
  } : demoMetrics();
  const stage: ExperimentStage = "paper";
  const promotion = evaluatePromotion(stage, metrics, profitability ?? undefined);
  return {
    id: "EXP-0001",
    name: "Regime-aware alpha + council confirmation",
    hypothesis: "A deterministic alpha engine filtered by regime, independent specialist analysis, hard safety checks, adaptive weighting and disciplined exits can produce positive net expectancy after fees and slippage.",
    stage,
    version: 4,
    chains,
    metrics,
    profitability: profitability ?? undefined,
    promotionReady: promotion.ready,
    promotionReasons: profitability ? promotion.reasons : ["No measured profitability benchmark yet. Live promotion is blocked until historical, walk-forward and paper evidence is stored."],
  };
}
