import type { Chain, ExperimentMetrics, ExperimentStage, StrategyExperiment } from "./types";

const thresholds = {
  backtest: { trades: 150, expectancyPct: 1.2, maxDrawdownPct: 25, profitFactor: 1.15 },
  oos: { trades: 75, expectancyPct: 0.8, maxDrawdownPct: 20, profitFactor: 1.1 },
  paper: { trades: 50, expectancyPct: 0.5, maxDrawdownPct: 15, profitFactor: 1.08 },
};

export function evaluatePromotion(stage: ExperimentStage, m: ExperimentMetrics): { ready: boolean; reasons: string[] } {
  if (stage === "research") return { ready: true, reasons: ["Research hypothesis documented; ready for historical backtest."] };
  if (stage === "live" || stage === "paused" || stage === "rejected") return { ready: false, reasons: [`Stage ${stage} requires a manual governance decision.`] };

  const t = thresholds[stage as keyof typeof thresholds];
  if (!t) return { ready: false, reasons: ["No automatic promotion rules for this stage."] };

  const reasons: string[] = [];
  if (m.trades < t.trades) reasons.push(`Need ${t.trades - m.trades} more evaluated trades.`);
  if (m.expectancyPct < t.expectancyPct) reasons.push(`Expectancy ${m.expectancyPct.toFixed(2)}% is below ${t.expectancyPct.toFixed(2)}%.`);
  if (m.maxDrawdownPct > t.maxDrawdownPct) reasons.push(`Drawdown ${m.maxDrawdownPct.toFixed(1)}% exceeds ${t.maxDrawdownPct.toFixed(1)}%.`);
  if (m.profitFactor < t.profitFactor) reasons.push(`Profit factor ${m.profitFactor.toFixed(2)} is below ${t.profitFactor.toFixed(2)}.`);

  return { ready: reasons.length === 0, reasons: reasons.length ? reasons : ["All automatic promotion gates passed."] };
}

export function createCoreExperiment(chains: Chain[]): StrategyExperiment {
  const metrics: ExperimentMetrics = {
    trades: 94,
    winRatePct: 58.5,
    expectancyPct: 1.36,
    maxDrawdownPct: 9.8,
    profitFactor: 1.31,
    slippageBps: 38,
  };
  const stage: ExperimentStage = "paper";
  const promotion = evaluatePromotion(stage, metrics);
  return {
    id: "EXP-0001",
    name: "Cross-chain momentum + smart-money confirmation",
    hypothesis: "Momentum with verified smart-money accumulation and acceptable contract risk has positive net expectancy after fees and slippage.",
    stage,
    version: 2,
    chains,
    metrics,
    promotionReady: promotion.ready,
    promotionReasons: promotion.reasons,
  };
}
