import { getChainConfig } from "./chains";
import type { ExecutionPlan, ExecutionRequest, MarketSnapshot, PaperFill, PortfolioRiskContext, RiskCheck, StrategyExperiment, TradingMode } from "./types";

export function buildExecutionPlan(args: {
  mode: TradingMode;
  snapshot: MarketSnapshot;
  decision: "BUY" | "WATCH" | "SKIP" | "EXIT";
  conviction: number;
  risk: RiskCheck;
  portfolio: PortfolioRiskContext;
  experiment: StrategyExperiment;
  decisionId: string;
}): ExecutionPlan {
  const { mode, snapshot, decision, conviction, risk, portfolio, experiment, decisionId } = args;
  if (decision !== "BUY") return { allowed: false, mode, reason: `No entry order: CIO decision is ${decision}.` };
  if (!risk.passed) return { allowed: false, mode, reason: "No entry order: deterministic risk gate vetoed the trade." };
  if (mode === "live" && !portfolio.liveTradingEnabled) return { allowed: false, mode, reason: "Live trading is globally disabled." };
  if (experiment.stage !== "paper" && mode === "paper") return { allowed: false, mode, reason: `Experiment stage ${experiment.stage} is not approved for paper execution.` };
  if (experiment.stage !== "live" && mode === "live") return { allowed: false, mode, reason: "Strategy has not graduated to live stage." };

  const notionalUsd = Number((portfolio.equityUsd * (risk.maxPositionPct / 100)).toFixed(2));
  if (notionalUsd <= 0) return { allowed: false, mode, reason: "Risk engine allocated zero notional." };

  const request: ExecutionRequest = {
    mode,
    chain: snapshot.chain,
    tokenAddress: snapshot.tokenAddress,
    symbol: snapshot.symbol,
    side: "BUY",
    notionalUsd,
    maxSlippageBps: conviction >= 85 ? 125 : 90,
    strategyId: experiment.id,
    decisionId,
  };
  return { allowed: true, mode, request, reason: `${mode.toUpperCase()} execution approved by CIO + deterministic risk gate.` };
}

export async function executePaper(request: ExecutionRequest, snapshot: MarketSnapshot): Promise<PaperFill> {
  if (request.mode !== "paper") throw new Error("Paper executor only accepts paper requests");
  getChainConfig(request.chain); // verifies supported chain and preserves a shared routing boundary with live mode.
  const simulatedSlippageBps = Math.min(request.maxSlippageBps, Math.max(8, Math.round((request.notionalUsd / Math.max(snapshot.liquidity, 1)) * 10_000 * 0.65 + snapshot.volatility * 18)));
  const priceImpact = request.side === "BUY" ? 1 + simulatedSlippageBps / 10_000 : 1 - simulatedSlippageBps / 10_000;
  const feeRate = snapshot.chainFamily === "solana" ? 0.0015 : 0.0025;
  return {
    id: `PF-${Date.now().toString(36).toUpperCase()}`,
    chain: request.chain,
    symbol: request.symbol,
    side: request.side,
    requestedUsd: request.notionalUsd,
    filledUsd: Number((request.notionalUsd * (1 - feeRate)).toFixed(2)),
    fillPrice: snapshot.price * priceImpact,
    slippageBps: simulatedSlippageBps,
    feeUsd: Number((request.notionalUsd * feeRate).toFixed(2)),
    createdAt: new Date().toISOString(),
  };
}
