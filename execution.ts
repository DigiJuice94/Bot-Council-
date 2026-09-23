import { getChainConfig } from "./chains";
import { verifyPaperRoute } from "./route-feasibility";
import { auditEntrySellability, auditSellQuantity, type SellabilityAudit } from "./sellability-auditor";
import { isFreshVerifiedSellProof } from "./sell-execution-proof";
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

export async function executePaper(request: ExecutionRequest, snapshot: MarketSnapshot, verifiedSellProof?: SellabilityAudit): Promise<PaperFill> {
  if (request.mode !== "paper") throw new Error("Paper executor only accepts paper requests");
  getChainConfig(request.chain);
  // Final execution backstop: no caller can create a PAPER position from a
  // market snapshot reporting zero liquidity, even if an upstream provider or
  // Council field is inconsistent.
  if (request.side === "BUY" && (!Number.isFinite(snapshot.liquidity) || snapshot.liquidity <= 0)) {
    throw new Error("Paper BUY rejected: token reports zero executable liquidity.");
  }

  // Linear impact could exceed 100% on thin pools and permanently trap paper exits.
  // Use a bounded constant-product-style impact curve instead: small trades behave
  // similarly to the old model, while very large trades asymptotically approach 65%.
  const tradeToLiquidity = request.notionalUsd / Math.max(snapshot.liquidity, 1);
  const liquidityModelBps = Math.max(8, Math.round((tradeToLiquidity / (1 + tradeToLiquidity)) * 6_500 + snapshot.volatility * 18));
  const entrySellAudit = request.side === "BUY" ? await auditEntrySellability(snapshot, request.notionalUsd) : null;
  if (request.side === "BUY" && (!entrySellAudit || entrySellAudit.status !== "pass" || !entrySellAudit.routeVerified)) {
    throw new Error(`Paper BUY rejected: no verified executable reverse route. ${entrySellAudit?.reason ?? "Sell-route audit unavailable."}`);
  }
  const buyRoute = request.side === "BUY" ? await verifyPaperRoute(request, snapshot) : null;
  const sellAudit = request.side === "SELL"
    ? (isFreshVerifiedSellProof(verifiedSellProof)
      ? verifiedSellProof
      : await auditSellQuantity(snapshot, request.notionalUsd / Math.max(snapshot.price, 1e-12)))
    : null;
  if (request.side === "SELL" && (!sellAudit || sellAudit.status !== "pass" || !sellAudit.routeVerified)) {
    throw new Error(`Paper SELL unresolved: no verified executable reverse route. ${sellAudit?.reason ?? "Sell-route audit unavailable."}`);
  }
  if (request.chain === "Solana" && request.side === "BUY" && buyRoute?.verified && !buyRoute.available) {
    throw new Error(`Paper BUY rejected: live Jupiter route check failed. ${buyRoute.reason}`);
  }
  const routeBps = request.side === "SELL"
    ? Math.max(0, Math.round((sellAudit?.priceImpactPct ?? 0) * 100))
    : (buyRoute?.estimatedSlippageBps ?? 0);
  const observedSlippageBps = Math.max(liquidityModelBps, routeBps);
  const forcedPaperExit = request.mode === "paper" && request.side === "SELL" && request.decisionId.endsWith("-EXIT");

  // Entries and ordinary trims still respect their slippage ceiling.
  // A Guardian emergency/full exit must never become permanently stuck because the
  // market is already illiquid. In paper mode we instead record a distressed fill
  // with the modeled loss, capped below 100% so proceeds can never become negative.
  if (observedSlippageBps > request.maxSlippageBps && !forcedPaperExit) {
    throw new Error(`Paper ${request.side} rejected: estimated live-route/liquidity impact ${observedSlippageBps} bps exceeds ${request.maxSlippageBps} bps limit.`);
  }

  const simulatedSlippageBps = forcedPaperExit
    ? Math.min(9_000, observedSlippageBps)
    : Math.min(request.maxSlippageBps, observedSlippageBps);
  const priceImpact = request.side === "BUY" ? 1 + simulatedSlippageBps / 10_000 : 1 - simulatedSlippageBps / 10_000;
  const feeRate = snapshot.chainFamily === "solana" ? 0.0015 : 0.0025;
  const grossFilledUsd = request.side === "SELL"
    ? request.notionalUsd * Math.max(0.01, 1 - simulatedSlippageBps / 10_000)
    : request.notionalUsd;
  const feeUsd = grossFilledUsd * feeRate;
  const distressed = forcedPaperExit && observedSlippageBps > request.maxSlippageBps;

  return {
    id: `PF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    chain: request.chain,
    symbol: request.symbol,
    side: request.side,
    requestedUsd: request.notionalUsd,
    filledUsd: Number((grossFilledUsd - feeUsd).toFixed(4)),
    fillPrice: snapshot.price * priceImpact,
    slippageBps: simulatedSlippageBps,
    feeUsd: Number(feeUsd.toFixed(4)),
    routeVerified: request.side === "SELL" ? true : Boolean(entrySellAudit?.routeVerified && (request.chain !== "Solana" || (buyRoute?.verified && buyRoute.available))),
    routeProvider: request.side === "SELL" ? sellAudit!.provider : (entrySellAudit?.provider ?? buyRoute?.provider ?? "liquidity-model"),
    routeNote: distressed
      ? `DISTRESSED PAPER EXIT: normal limit ${request.maxSlippageBps} bps was exceeded; the verified reverse route was modeled at ${simulatedSlippageBps} bps impact. Source estimate: ${observedSlippageBps} bps. ${sellAudit!.reason}`
      : (request.side === "SELL" ? sellAudit!.reason : `${buyRoute!.reason} Reverse-route check: ${entrySellAudit!.reason}`),
    createdAt: new Date().toISOString(),
  };
}
