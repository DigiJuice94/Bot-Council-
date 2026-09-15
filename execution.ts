import { getChainConfig } from "./chains";
import { verifyPaperRoute } from "./route-feasibility";
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
  allocationMultiplier?: number;
}): ExecutionPlan {
  const { mode, snapshot, decision, conviction, risk, portfolio, experiment, decisionId } = args;
  const allocationMultiplier = Math.max(0, Math.min(1, args.allocationMultiplier ?? 1));
  if (decision !== "BUY") return { allowed: false, mode, allocationMultiplier, reason: `No entry order: CIO decision is ${decision}.` };
  if (!risk.passed) return { allowed: false, mode, allocationMultiplier, reason: "No entry order: deterministic risk gate vetoed the trade." };
  if (allocationMultiplier <= 0) return { allowed: false, mode, allocationMultiplier, reason: "No entry order: regime/alpha sizing multiplier is zero." };
  if (mode === "live" && !portfolio.liveTradingEnabled) return { allowed: false, mode, allocationMultiplier, reason: "Live trading is globally disabled." };
  if (experiment.stage !== "paper" && mode === "paper") return { allowed: false, mode, allocationMultiplier, reason: `Experiment stage ${experiment.stage} is not approved for paper execution.` };
  if (experiment.stage !== "live" && mode === "live") return { allowed: false, mode, allocationMultiplier, reason: "Strategy has not graduated to live stage." };

  const riskSized = portfolio.equityUsd * (risk.maxPositionPct / 100) * allocationMultiplier;
  // A paper order can never spend more cash than the persistent wallet actually owns.
  const notionalUsd = Number(Math.max(0, Math.min(riskSized, portfolio.cashUsd)).toFixed(2));
  if (notionalUsd <= 0) return { allowed: false, mode, allocationMultiplier, reason: "Paper wallet has no available cash for a new position." };

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
  return { allowed: true, mode, request, allocationMultiplier, reason: `${mode.toUpperCase()} execution approved by Council + deterministic risk gate using current wallet equity/cash.` };
}

export async function executePaper(request: ExecutionRequest, snapshot: MarketSnapshot): Promise<PaperFill> {
  if (request.mode !== "paper") throw new Error("Paper executor only accepts paper requests");
  getChainConfig(request.chain);

  const liquidityModelBps = Math.max(8, Math.round((request.notionalUsd / Math.max(snapshot.liquidity, 1)) * 10_000 * 0.65 + snapshot.volatility * 18));
  const route = await verifyPaperRoute(request, snapshot);
  if (request.chain === "Solana" && request.side === "BUY" && route.verified && !route.available) {
    throw new Error(`Paper BUY rejected: live Jupiter route check failed. ${route.reason}`);
  }
  const routeBps = route.estimatedSlippageBps ?? 0;
  const observedSlippageBps = Math.max(liquidityModelBps, routeBps);
  if (observedSlippageBps > request.maxSlippageBps) {
    throw new Error(`Paper ${request.side} rejected: estimated live-route/liquidity impact ${observedSlippageBps} bps exceeds ${request.maxSlippageBps} bps limit.`);
  }
  const simulatedSlippageBps = Math.min(request.maxSlippageBps, observedSlippageBps);
  const priceImpact = request.side === "BUY" ? 1 + simulatedSlippageBps / 10_000 : 1 - simulatedSlippageBps / 10_000;
  const feeRate = snapshot.chainFamily === "solana" ? 0.0015 : 0.0025;

  return {
    id: `PF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    chain: request.chain,
    symbol: request.symbol,
    side: request.side,
    requestedUsd: request.notionalUsd,
    filledUsd: Number((request.notionalUsd * (1 - feeRate)).toFixed(4)),
    fillPrice: snapshot.price * priceImpact,
    slippageBps: simulatedSlippageBps,
    feeUsd: Number((request.notionalUsd * feeRate).toFixed(4)),
    routeVerified: route.verified && route.available,
    routeProvider: route.provider,
    routeNote: route.reason,
    createdAt: new Date().toISOString(),
  };
}
