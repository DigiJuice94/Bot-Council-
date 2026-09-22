import type { ManagedPosition, MarketSnapshot, WarRoomResult, WinnerState } from "./types";

export type ScaleStep = {
  label: string;
  minGainPct: number;
  minConfirmationScore: number;
  addMultipleOfInitial: number;
  minAlphaDelta: number;
  minConvictionDelta: number;
};

export const SCALE_STEPS: ScaleStep[] = [
  { label: "ADD1", minGainPct: 5, minConfirmationScore: 72, addMultipleOfInitial: 0.5, minAlphaDelta: -2, minConvictionDelta: -2 },
  { label: "ADD2", minGainPct: 10, minConfirmationScore: 77, addMultipleOfInitial: 0.6, minAlphaDelta: 0, minConvictionDelta: 0 },
  { label: "ADD3", minGainPct: 15, minConfirmationScore: 82, addMultipleOfInitial: 0.7, minAlphaDelta: 2, minConvictionDelta: 2 },
];

const favorableRegimes = new Set(["meme_expansion", "new_chain_mania", "risk_on_trend"]);
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function confirmationScore(position: ManagedPosition, snapshot: MarketSnapshot, fresh: WarRoomResult): number {
  const entry = position.entryContext?.snapshot;
  const entryLiquidity = Math.max(1, entry?.liquidity ?? snapshot.liquidity);
  const liquidityRatio = snapshot.liquidity / entryLiquidity;
  const liquidityScore = clamp(70 + (liquidityRatio - 1) * 80);
  const flowScore = clamp(50 + (snapshot.buySellRatio - 1) * 60);
  const smartNet = snapshot.smartMoneyBuys - snapshot.smartMoneySells;
  const smartScore = clamp(50 + smartNet * 10);
  const volumeAccel = snapshot.volumeAccelerationPct ?? snapshot.socialVelocityPct * 0.35;
  const volumeScore = clamp(50 + volumeAccel * 0.22);
  const score =
    fresh.conviction * 0.30 +
    fresh.alpha.score * 0.25 +
    flowScore * 0.15 +
    volumeScore * 0.10 +
    smartScore * 0.10 +
    liquidityScore * 0.10;
  return Number(clamp(score).toFixed(1));
}

export function determineWinnerState(position: ManagedPosition, rawMovePct: number, confirmation: number): WinnerState {
  const levels = position.exitStrategy.takeProfits;
  const taken = new Set(position.takenProfitLabels ?? []);
  if (taken.has("TP2") || taken.has("TP3") || taken.has("Runner") || rawMovePct >= (levels[1]?.gainPct ?? 40)) return "runner";
  const activation = position.exitStrategy.winnerActivationPct ?? Math.max(6, (levels[0]?.gainPct ?? 18) * 0.4);
  if (taken.has("TP1") || (rawMovePct >= activation && confirmation >= 68)) return "confirmed";
  return "building";
}

export function effectiveGuardianControls(position: ManagedPosition, state: WinnerState) {
  const exit = position.exitStrategy;
  if (state === "runner" || state === "confirmed") {
    return {
      trailingStopPct: exit.winnerTrailingStopPct ?? Math.min(32, exit.trailingStopPct + 5),
      maxHoldMinutes: Math.min(exit.winnerMaxHoldMinutes ?? 20, 20),
    };
  }
  return { trailingStopPct: exit.trailingStopPct, maxHoldMinutes: Math.min(exit.maxHoldMinutes, 20) };
}

export function nextScaleStep(position: ManagedPosition, snapshot: MarketSnapshot, fresh: WarRoomResult, confirmation: number): ScaleStep | null {
  if (position.takenProfitLabels?.length) return null; // Never add risk after profit distribution has started.
  const memeReconfirmed = fresh.councilProcess?.lane === "meme" && fresh.memeRegime?.entryAllowed &&
    fresh.councilProcess.researchSupport >= fresh.councilProcess.requiredResearchSupport &&
    fresh.alpha.score >= fresh.memeRegime.minAlphaScore;
  const standardReconfirmed = favorableRegimes.has(fresh.regime.id) && fresh.alpha.action === "TRADE";
  if (!memeReconfirmed && !standardReconfirmed) return null;
  if (fresh.decision !== "BUY" || !fresh.risk.passed) return null;
  if (!position.entryContext) return null;

  const averageEntry = Math.max(position.entryPrice, 1e-12);
  const rawMovePct = (snapshot.price - averageEntry) / averageEntry * 100;
  if (rawMovePct <= 0) return null; // Explicit no-average-down rule.

  const entryLiquidity = Math.max(1, position.entryContext.snapshot.liquidity);
  if (snapshot.liquidity < Math.max(position.exitStrategy.liquidityFloorUsd, entryLiquidity * 0.85)) return null;
  if (snapshot.buySellRatio < 1.1) return null;
  if (snapshot.smartMoneyBuys < snapshot.smartMoneySells) return null;

  const scales = position.scaleIns ?? [];
  const lastScale = scales[scales.length - 1];
  if (lastScale && Date.now() - new Date(lastScale.createdAt).getTime() < 10 * 60_000) return null;
  const used = new Set(scales.map((item) => item.label));
  const step = SCALE_STEPS.find((candidate) => !used.has(candidate.label));
  if (!step || rawMovePct < step.minGainPct || confirmation < step.minConfirmationScore) return null;

  const alphaDelta = fresh.alpha.score - position.entryContext.alpha.score;
  const convictionDelta = fresh.conviction - position.entryContext.conviction;
  if (alphaDelta < step.minAlphaDelta || convictionDelta < step.minConvictionDelta) return null;
  return step;
}

export function maxGrossExposurePct(position: ManagedPosition): number {
  const initialPct = position.entryContext?.initialAllocationPct;
  const cap = Math.max(5, Math.min(20, Number(process.env.PAPER_WINNER_MAX_GROSS_PCT ?? 15)));
  if (typeof initialPct === "number" && initialPct > 0) return Number(Math.min(cap, Math.max(initialPct, initialPct * 2.8)).toFixed(3));
  return position.maxGrossExposurePct ?? cap;
}
