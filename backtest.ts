import { runWarRoom } from "./engine";
import { DEFAULT_AGENT_WEIGHTS, normalizeResearchWeights } from "./learning";
import { applyRegimeWeightBias, classifyMarketRegime } from "./regime";
import type { HistoricalFrame, HistoricalMark, MarketSnapshot, ProfitabilityBenchmarkReport, ProfitabilityMetrics, ResearchAgentWeights, WarRoomResult } from "./types";

export type BenchmarkConfig = {
  startingEquityUsd?: number;
  entryFeeBps?: number;
  exitFeeBps?: number;
  slippageBps?: number;
  folds?: number;
  monteCarloRuns?: number;
  ruinThresholdPct?: number;
  agentWeights?: Partial<ResearchAgentWeights>;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function maxDrawdown(returns: number[]) {
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const value of returns) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak * 100);
  }
  return maxDd;
}

function sharpe(returns: number[]) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? mean / sd * Math.sqrt(Math.min(252, returns.length)) : 0;
}

function simulatePath(result: WarRoomResult, snapshot: MarketSnapshot, path: HistoricalMark[], costsPct: number, entryTimestamp: string): number {
  if (result.decision !== "BUY" || !path.length) return 0;
  const exit = result.exitStrategy;
  const entry = snapshot.price;
  let high = entry;
  let remaining = 1;
  let realized = 0;
  const taken = new Set<string>();
  const opened = new Date(entryTimestamp).getTime();

  for (const mark of path) {
    const price = mark.price;
    high = Math.max(high, price);
    const pnl = (price - entry) / entry * 100;
    const drawdownFromHigh = high > 0 ? (high - price) / high * 100 : 0;
    const heldMinutes = Math.max(0, (new Date(mark.timestamp).getTime() - opened) / 60_000);
    const state = taken.has("TP2") || taken.has("TP3") || taken.has("Runner") || pnl >= (exit.takeProfits[1]?.gainPct ?? 40)
        ? "runner"
        : taken.has("TP1") || pnl >= (exit.winnerActivationPct ?? Math.max(6, (exit.takeProfits[0]?.gainPct ?? 18) * 0.4))
          ? "confirmed"
          : "building";
    const effectiveTrail = state === "runner" || state === "confirmed"
        ? (exit.winnerTrailingStopPct ?? exit.trailingStopPct)
        : exit.trailingStopPct;
    const effectiveHold = state === "runner" || state === "confirmed"
        ? (exit.winnerMaxHoldMinutes ?? exit.maxHoldMinutes)
        : exit.maxHoldMinutes;
    const highGainPct = (high - entry) / entry * 100;
    const breakEvenArmed = state !== "building" && (taken.has("TP1") || highGainPct >= (exit.takeProfits[0]?.gainPct ?? 18));
    const breakEvenTriggered = breakEvenArmed && pnl <= (exit.breakEvenBufferPct ?? 1.5);
    const emergency = mark.sellable === false || mark.honeypot === true || Number(mark.top10Pct ?? 0) > 80 || Number(mark.bundledPct ?? 0) > 25 || (snapshot.chainFamily === "solana" && (mark.mintAuthority === true || mark.freezeAuthority === true)) || Number(mark.liquidity ?? snapshot.liquidity) < exit.liquidityFloorUsd;
    const hardExit = emergency || pnl <= -exit.stopLossPct || breakEvenTriggered || (pnl > 0 && drawdownFromHigh >= effectiveTrail) || heldMinutes >= effectiveHold;

    if (hardExit) {
      realized += remaining * pnl;
      remaining = 0;
      break;
    }

    for (const level of exit.takeProfits) {
      if (remaining <= 0 || taken.has(level.label) || pnl < level.gainPct) continue;
      const fraction = Math.min(remaining, level.sellPct / 100);
      realized += fraction * pnl;
      remaining -= fraction;
      taken.add(level.label);
    }
  }

  if (remaining > 0) {
    const final = path[path.length - 1].price;
    realized += remaining * ((final - entry) / entry * 100);
  }
  return realized - costsPct;
}

function tradeReturn(frame: HistoricalFrame, result: WarRoomResult, costsPct: number) {
  if (result.decision !== "BUY" || !result.execution.allowed) return null;
  let assetReturnPct: number | null = null;
  if (frame.futurePath?.length) assetReturnPct = simulatePath(result, frame.snapshot, frame.futurePath, costsPct, frame.timestamp);
  else if (typeof frame.futureReturnPct === "number") assetReturnPct = frame.futureReturnPct - costsPct;
  if (assetReturnPct === null) return null;
  const allocationPct = result.risk.maxPositionPct * (result.execution.allocationMultiplier ?? 1);
  return assetReturnPct * allocationPct / 100;
}

function foldReturns(tradeReturns: number[], folds: number) {
  if (!tradeReturns.length) return [];
  const count = Math.max(1, Math.min(folds, tradeReturns.length));
  const size = Math.ceil(tradeReturns.length / count);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = tradeReturns.slice(i * size, (i + 1) * size);
    if (!chunk.length) continue;
    let eq = 1;
    for (const value of chunk) eq *= 1 + value / 100;
    out.push((eq - 1) * 100);
  }
  return out;
}

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function monteCarlo(tradeReturns: number[], runs: number, ruinThresholdPct: number) {
  if (!tradeReturns.length) return { medianReturnPct: 0, ruinProbabilityPct: 0 };
  const random = lcg(0xB07C0A11);
  const outcomes: number[] = [];
  let ruin = 0;
  for (let run = 0; run < runs; run++) {
    let equity = 1;
    let ruined = false;
    for (let i = 0; i < tradeReturns.length; i++) {
      const picked = tradeReturns[Math.floor(random() * tradeReturns.length)];
      equity *= 1 + picked / 100;
      if ((1 - equity) * 100 >= ruinThresholdPct) ruined = true;
    }
    outcomes.push((equity - 1) * 100);
    if (ruined) ruin += 1;
  }
  outcomes.sort((a, b) => a - b);
  return {
    medianReturnPct: outcomes[Math.floor(outcomes.length / 2)] ?? 0,
    ruinProbabilityPct: ruin / runs * 100,
  };
}

export function runProfitabilityBenchmark(frames: HistoricalFrame[], config: BenchmarkConfig = {}): ProfitabilityBenchmarkReport {
  const sorted = [...frames].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const startingEquityUsd = config.startingEquityUsd ?? 10_000;
  const entryFeeBps = config.entryFeeBps ?? 25;
  const exitFeeBps = config.exitFeeBps ?? 25;
  const slippageBps = config.slippageBps ?? 35;
  const costsPct = (entryFeeBps + exitFeeBps + slippageBps * 2) / 100;
  const warnings: string[] = [];
  const returns: number[] = [];
  const baseline: number[] = [];

  for (const frame of sorted) {
    const regime = classifyMarketRegime(frame.snapshot);
    const baseWeights = normalizeResearchWeights(config.agentWeights ?? DEFAULT_AGENT_WEIGHTS);
    const result = runWarRoom(frame.snapshot, { mode: "paper", regime, agentWeights: applyRegimeWeightBias(baseWeights, regime), learningSource: "regime" });
    const ret = tradeReturn(frame, result, costsPct);
    if (ret !== null) returns.push(clamp(ret, -95, 10000));
    if (typeof frame.baselineReturnPct === "number") baseline.push(frame.baselineReturnPct);
  }

  let equity = startingEquityUsd;
  for (const value of returns) equity *= 1 + value / 100;
  const totalReturnPct = startingEquityUsd > 0 ? (equity / startingEquityUsd - 1) * 100 : 0;
  const wins = returns.filter((value) => value > 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((a, b) => a + b, 0));
  let baselineEq = 1;
  for (const value of baseline) baselineEq *= 1 + value / 100;
  const baselineReturnPct = baseline.length ? (baselineEq - 1) * 100 : 0;
  const folds = foldReturns(returns, config.folds ?? 5);
  const mc = monteCarlo(returns, Math.max(100, config.monteCarloRuns ?? 500), config.ruinThresholdPct ?? 50);

  if (sorted.length < 200) warnings.push("Fewer than 200 historical decision points; treat profitability estimates as preliminary.");
  if (!baseline.length) warnings.push("No baselineReturnPct series supplied; excess-return comparison is incomplete.");
  if (!sorted.some((frame) => frame.futurePath?.length)) warnings.push("No intratrade price paths supplied; Guardian exits are approximated by fixed-horizon returns.");
  warnings.push("Guardian runner exits are replayed when futurePath is present; dynamic pyramiding is intentionally not simulated unless a future event-driven benchmark supplies full contemporaneous snapshots for each add decision.");
  warnings.push("Benchmark compounds risk-sized portfolio returns sequentially; overlapping live positions and portfolio correlation require a full event-driven portfolio simulator before live promotion.");

  const metrics: ProfitabilityMetrics = {
    trades: returns.length,
    winRatePct: returns.length ? Number((wins.length / returns.length * 100).toFixed(2)) : 0,
    expectancyPct: returns.length ? Number((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(3)) : 0,
    maxDrawdownPct: Number(maxDrawdown(returns).toFixed(2)),
    profitFactor: Number((grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0).toFixed(2)),
    slippageBps,
    startingEquityUsd,
    finalEquityUsd: Number(equity.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    sharpe: Number(sharpe(returns).toFixed(3)),
    positiveFoldPct: folds.length ? Number((folds.filter((value) => value > 0).length / folds.length * 100).toFixed(1)) : 0,
    baselineReturnPct: Number(baselineReturnPct.toFixed(2)),
    excessReturnPct: Number((totalReturnPct - baselineReturnPct).toFixed(2)),
    monteCarloMedianReturnPct: Number(mc.medianReturnPct.toFixed(2)),
    ruinProbabilityPct: Number(mc.ruinProbabilityPct.toFixed(2)),
    source: "historical",
    generatedAt: new Date().toISOString(),
  };

  return { metrics, foldReturnsPct: folds.map((value) => Number(value.toFixed(2))), tradeReturnsPct: returns.map((value) => Number(value.toFixed(3))), warnings };
}
