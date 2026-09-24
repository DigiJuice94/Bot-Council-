import { getChainConfig } from "./chains";
import { verifyPaperRoute } from "./route-feasibility";
import { auditSellQuantity, type SellabilityAudit } from "./sellability-auditor";
import { isFreshVerifiedSellProof } from "./sell-execution-proof";
import { confirmedSellabilityFailure } from "./security-evidence";
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
  if (request.side === "SELL" && (!Number.isFinite(snapshot.liquidity) || snapshot.liquidity <= 0
    || snapshot.honeypot || confirmedSellabilityFailure(snapshot)
    || (snapshot.chainFamily === "solana" && snapshot.freezeAuthority))) {
    throw new Error("Paper SELL rejected: live security evidence or zero liquidity prevents a credible exit.");
  }

  // Linear impact could exceed 100% on thin pools and permanently trap paper exits.
  // Use a bounded constant-product-style impact curve instead: small trades behave
  // similarly to the old model, while very large trades asymptotically approach 65%.
  const tradeToLiquidity = request.notionalUsd / Math.max(snapshot.liquidity, 1);
  const liquidityModelBps = Math.max(8, Math.round((tradeToLiquidity / (1 + tradeToLiquidity)) * 6_500 + snapshot.volatility * 18));
  const buyRoute = request.side === "BUY" ? await verifyPaperRoute(request, snapshot) : null;
  const sellAudit = request.side === "SELL"
    ? (isFreshVerifiedSellProof(verifiedSellProof)
      ? verifiedSellProof
      : (verifiedSellProof?.status === "unknown" || verifiedSellProof?.status === "fail")
        && Date.now() - Date.parse(verifiedSellProof.checkedAt) < 30_000
        ? verifiedSellProof
      : await auditSellQuantity(snapshot, request.notionalUsd / Math.max(snapshot.price, 1e-12)))
    : null;
  const forcedPaperExit = request.side === "SELL" && request.decisionId.endsWith("-EXIT");
  const observedAt = Date.parse(snapshot.dataProvenance?.fetchedAt ?? "");
  const liquidityModeledSell = forcedPaperExit && sellAudit?.status === "unknown"
    && snapshot.dataProvenance?.live === true
    && Number.isFinite(observedAt) && Math.abs(Date.now() - observedAt) <= 120_000
    && Number.isFinite(snapshot.liquidity) && snapshot.liquidity > 0
    && Number.isFinite(snapshot.price) && snapshot.price > 0
    && !snapshot.honeypot && !confirmedSellabilityFailure(snapshot)
    && !(snapshot.chainFamily === "solana" && snapshot.freezeAuthority);
  if (request.side === "SELL" && !liquidityModeledSell && (!sellAudit || sellAudit.status !== "pass" || !sellAudit.routeVerified)) {
    throw new Error(`Paper SELL unresolved: no verified executable reverse route. ${sellAudit?.reason ?? "Sell-route audit unavailable."}`);
  }
  if (request.chain === "Solana" && request.side === "BUY" && buyRoute?.verified && !buyRoute.available) {
    throw new Error(`Paper BUY rejected: live Jupiter route check failed. ${buyRoute.reason}`);
  }
  const routeBps = request.side === "SELL"
    ? Math.max(0, Math.round((sellAudit?.priceImpactPct ?? 0) * 100))
    : (buyRoute?.estimatedSlippageBps ?? 0);
  const observedSlippageBps = Math.max(liquidityModelBps, routeBps);

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
  const feeRate = snapshot.chainFamily === "solana" ? 0.0015 : 0.0025;
  const grossFilledUsd = request.side === "SELL"
    ? Math.min(request.notionalUsd * Math.max(0.01, 1 - simulatedSlippageBps / 10_000),
        liquidityModeledSell ? snapshot.liquidity * 0.5 : Infinity)
    : request.notionalUsd;
  const priceImpact = request.side === "BUY" ? 1 + simulatedSlippageBps / 10_000
    : grossFilledUsd / Math.max(request.notionalUsd, 1e-12);
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
    slippageBps: request.side === "SELL" ? Math.round((1 - priceImpact) * 10_000) : simulatedSlippageBps,
    feeUsd: Number(feeUsd.toFixed(4)),
    routeVerified: request.side === "SELL" ? !liquidityModeledSell : Boolean(buyRoute?.verified && buyRoute.available),
    sellExecutionKind: request.side === "SELL" ? liquidityModeledSell ? "liquidity_model" : "verified_route" : undefined,
    observedLiquidityUsd: liquidityModeledSell ? snapshot.liquidity : undefined,
    liquidityObservedAt: liquidityModeledSell ? snapshot.dataProvenance!.fetchedAt : undefined,
    routeProvider: request.side === "SELL" ? liquidityModeledSell ? "liquidity-model" : sellAudit!.provider : (buyRoute?.provider ?? "liquidity-model"),
    routeNote: liquidityModeledSell
      ? `PAPER LIQUIDITY MODEL: simulated full exit using live pool liquidity $${snapshot.liquidity.toFixed(2)}; no executable reverse route was verified. ${sellAudit?.reason ?? "Unknown route."}`
      : distressed
      ? `DISTRESSED PAPER EXIT: normal limit ${request.maxSlippageBps} bps was exceeded; the verified reverse route was modeled at ${simulatedSlippageBps} bps impact. Source estimate: ${observedSlippageBps} bps. ${sellAudit!.reason}`
      : (request.side === "SELL" ? sellAudit!.reason : buyRoute!.reason),
    createdAt: new Date().toISOString(),
  };
}
