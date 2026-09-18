import { appendPrivateEntityMemory } from "./agent-entity-store";
import type { CouncilEntityId, MarketSnapshot } from "./types";

export type TrajectoryPhase =
  | "INSUFFICIENT"
  | "IGNITION"
  | "ACCELERATION"
  | "PULLBACK"
  | "RECOVERY"
  | "DISTRIBUTION"
  | "STALLED";

export type TrajectoryObservationLike = {
  at: string;
  marketCap: number;
  liquidity: number;
  buySellRatio: number;
  volume5m: number;
  volume24h: number;
  volumeAccelerationPct: number;
  transactionAccelerationPct: number;
  holderVelocity: number;
  uniqueBuyerVelocity: number;
  top10Pct: number;
  bundledPct: number;
  socialVelocityPct: number;
};

export type TrajectoryCaseLike = {
  id: string;
  chain: string;
  tokenAddress: string;
  symbol: string;
  firstSeenAt: string;
  outcome: "open" | "runner" | "dumper" | "neutral";
  observations: TrajectoryObservationLike[];
  paperTradeOpened?: boolean;
};

export type TrajectoryGuidance = {
  score: number;
  dumperRiskScore: number;
  confidence: number;
  phase: TrajectoryPhase;
  observationsUsed: number;
  sampleSize: number;
  chainSampleSize: number;
  learned: boolean;
  evidence: string[];
  featureSummary: {
    elapsedMinutes: number;
    marketCapGrowthPct: number;
    marketCapVelocityPctPerMin: number;
    marketCapAcceleration: number;
    buySellDelta: number;
    volumeAccelerationDelta: number;
    holderVelocityDelta: number;
    uniqueBuyerVelocityDelta: number;
    liquidityToMcDeltaPct: number;
    maxPullbackPct: number;
    recoveryPct: number;
  };
};

export type TrajectoryObserverSnapshot = {
  sequencesTracked: number;
  labeledSequences: number;
  runnerSequences: number;
  dumperSequences: number;
  chainModels: number;
  latestLessons: Array<{ symbol: string; chain: string; outcome: string; message: string }>;
};

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const finite = (n: number | undefined, fallback = 0) => Number.isFinite(n) ? Number(n) : fallback;
const safeRatio = (a: number, b: number) => b > 0 ? a / b : 0;

function sortedObservations(input: TrajectoryObservationLike[]) {
  return [...input]
    .filter((row) => Number.isFinite(row.marketCap) && row.marketCap > 0)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function velocityPctPerMin(a: TrajectoryObservationLike, b: TrajectoryObservationLike) {
  const minutes = Math.max(0.25, (new Date(b.at).getTime() - new Date(a.at).getTime()) / 60_000);
  if (a.marketCap <= 0) return 0;
  return ((b.marketCap / a.marketCap) - 1) * 100 / minutes;
}

function summarizeTrajectory(observationsInput: TrajectoryObservationLike[]) {
  const observations = sortedObservations(observationsInput).slice(-16);
  const first = observations[0];
  const last = observations[observations.length - 1];
  if (!first || !last) {
    return {
      observations,
      elapsedMinutes: 0,
      marketCapGrowthPct: 0,
      marketCapVelocityPctPerMin: 0,
      marketCapAcceleration: 0,
      buySellDelta: 0,
      volumeAccelerationDelta: 0,
      holderVelocityDelta: 0,
      uniqueBuyerVelocityDelta: 0,
      liquidityToMcDeltaPct: 0,
      maxPullbackPct: 0,
      recoveryPct: 0,
      currentDrawdownPct: 0,
      latestVelocity: 0,
      earlyVelocity: 0,
    };
  }

  const elapsedMinutes = Math.max(0.25, (new Date(last.at).getTime() - new Date(first.at).getTime()) / 60_000);
  const marketCapGrowthPct = first.marketCap > 0 ? ((last.marketCap / first.marketCap) - 1) * 100 : 0;
  const marketCapVelocityPctPerMin = marketCapGrowthPct / elapsedMinutes;

  const midpoint = observations[Math.max(0, Math.floor((observations.length - 1) / 2))] ?? first;
  const earlyVelocity = velocityPctPerMin(first, midpoint);
  const latestVelocity = velocityPctPerMin(midpoint, last);
  const marketCapAcceleration = latestVelocity - earlyVelocity;

  const buySellDelta = finite(last.buySellRatio) - finite(first.buySellRatio);
  const volumeAccelerationDelta = finite(last.volumeAccelerationPct) - finite(first.volumeAccelerationPct);
  const holderVelocityDelta = finite(last.holderVelocity) - finite(first.holderVelocity);
  const uniqueBuyerVelocityDelta = finite(last.uniqueBuyerVelocity) - finite(first.uniqueBuyerVelocity);

  const firstLiquidityToMc = safeRatio(first.liquidity, first.marketCap);
  const lastLiquidityToMc = safeRatio(last.liquidity, last.marketCap);
  const liquidityToMcDeltaPct = firstLiquidityToMc > 0
    ? ((lastLiquidityToMc / firstLiquidityToMc) - 1) * 100
    : lastLiquidityToMc * 100;

  let peak = first.marketCap;
  let troughAfterPeak = first.marketCap;
  let maxPullbackPct = 0;
  let troughIndex = 0;
  observations.forEach((row, index) => {
    if (row.marketCap >= peak) {
      peak = row.marketCap;
      troughAfterPeak = row.marketCap;
    } else {
      troughAfterPeak = Math.min(troughAfterPeak, row.marketCap);
      const pullback = peak > 0 ? (peak - row.marketCap) / peak * 100 : 0;
      if (pullback > maxPullbackPct) {
        maxPullbackPct = pullback;
        troughIndex = index;
      }
    }
  });

  const priorPeak = Math.max(...observations.slice(0, Math.max(1, troughIndex + 1)).map((row) => row.marketCap));
  const trough = observations[troughIndex]?.marketCap ?? last.marketCap;
  const recoveryPct = priorPeak > trough
    ? clamp((last.marketCap - trough) / Math.max(1e-9, priorPeak - trough) * 100, 0, 140)
    : 0;
  const currentPeak = Math.max(...observations.map((row) => row.marketCap));
  const currentDrawdownPct = currentPeak > 0 ? (currentPeak - last.marketCap) / currentPeak * 100 : 0;

  return {
    observations,
    elapsedMinutes,
    marketCapGrowthPct,
    marketCapVelocityPctPerMin,
    marketCapAcceleration,
    buySellDelta,
    volumeAccelerationDelta,
    holderVelocityDelta,
    uniqueBuyerVelocityDelta,
    liquidityToMcDeltaPct,
    maxPullbackPct,
    recoveryPct,
    currentDrawdownPct,
    latestVelocity,
    earlyVelocity,
  };
}

function phaseFromSummary(summary: ReturnType<typeof summarizeTrajectory>): TrajectoryPhase {
  const last = summary.observations[summary.observations.length - 1];
  if (summary.observations.length < 2 || !last) return "INSUFFICIENT";
  if (
    summary.currentDrawdownPct >= 15
    && last.buySellRatio < 0.90
    && last.volumeAccelerationPct < 0
  ) return "DISTRIBUTION";
  if (summary.maxPullbackPct >= 8 && summary.recoveryPct >= 68 && last.buySellRatio >= 1.05) return "RECOVERY";
  if (summary.currentDrawdownPct >= 8) return "PULLBACK";
  if (summary.latestVelocity >= 2.5 && summary.marketCapAcceleration > 0.5 && last.buySellRatio >= 1.12) return "ACCELERATION";
  if (summary.marketCapGrowthPct >= 8 && last.buySellRatio >= 1.08) return "IGNITION";
  if (summary.elapsedMinutes >= 12 && summary.marketCapGrowthPct < 8 && summary.latestVelocity <= 0.4) return "STALLED";
  return "IGNITION";
}

function normalizedVector(summary: ReturnType<typeof summarizeTrajectory>) {
  return [
    clamp(50 + summary.marketCapVelocityPctPerMin * 5) / 100,
    clamp(50 + summary.marketCapAcceleration * 5) / 100,
    clamp(50 + summary.buySellDelta * 32) / 100,
    clamp(50 + summary.volumeAccelerationDelta * 0.35) / 100,
    clamp(50 + summary.holderVelocityDelta * 9) / 100,
    clamp(50 + summary.uniqueBuyerVelocityDelta * 11) / 100,
    clamp(50 + summary.liquidityToMcDeltaPct * 0.35) / 100,
    clamp(summary.recoveryPct) / 100,
    clamp(summary.maxPullbackPct * 2) / 100,
  ];
}

function distance(a: number[], b: number[]) {
  const count = Math.min(a.length, b.length);
  if (!count) return 999;
  return Math.sqrt(a.slice(0, count).reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / count);
}

function heuristicScore(summary: ReturnType<typeof summarizeTrajectory>) {
  const last = summary.observations[summary.observations.length - 1];
  if (!last || summary.observations.length < 2) return 50;
  let score = 50;
  score += Math.max(-18, Math.min(24, summary.marketCapVelocityPctPerMin * 3.2));
  score += Math.max(-14, Math.min(18, summary.marketCapAcceleration * 2.3));
  score += Math.max(-12, Math.min(16, summary.buySellDelta * 18));
  score += Math.max(-10, Math.min(14, summary.volumeAccelerationDelta * 0.12));
  score += Math.max(-8, Math.min(12, summary.uniqueBuyerVelocityDelta * 1.8));
  score += summary.recoveryPct >= 75 && summary.maxPullbackPct >= 8 ? 10 : 0;
  score -= summary.currentDrawdownPct >= 20 && last.buySellRatio < 0.9 ? 18 : 0;
  score -= summary.elapsedMinutes >= 15 && summary.latestVelocity <= 0 ? 9 : 0;
  return clamp(score);
}

function trainingRows(cases: TrajectoryCaseLike[], chain: string) {
  const labeled = cases.filter((row) =>
    (row.outcome === "runner" || row.outcome === "dumper")
    && row.observations.length >= 3
  );
  const chainRows = labeled.filter((row) => row.chain === chain);
  return chainRows.length >= 12 ? { rows: chainRows, chainRows: chainRows.length } : { rows: labeled, chainRows: chainRows.length };
}

export function getTrajectoryGuidance(args: {
  chain: string;
  currentObservations: TrajectoryObservationLike[];
  trainingCases: TrajectoryCaseLike[];
}): TrajectoryGuidance {
  const summary = summarizeTrajectory(args.currentObservations);
  const phase = phaseFromSummary(summary);
  const model = trainingRows(args.trainingCases, args.chain);
  const currentVector = normalizedVector(summary);
  const neighbors = model.rows
    .map((row) => {
      const rowSummary = summarizeTrajectory(row.observations.slice(0, 12));
      return { row, distance: distance(currentVector, normalizedVector(rowSummary)) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 28);

  let runnerWeight = 0;
  let dumperWeight = 0;
  for (const item of neighbors) {
    const weight = 1 / Math.max(0.05, item.distance);
    if (item.row.outcome === "runner") runnerWeight += weight;
    else dumperWeight += weight;
  }
  const totalWeight = runnerWeight + dumperWeight;
  const learnedRunnerPct = totalWeight > 0 ? runnerWeight / totalWeight * 100 : 50;
  const heuristic = heuristicScore(summary);
  const observationConfidence = clamp((summary.observations.length - 1) * 12, 0, 48);
  const modelConfidence = clamp(model.rows.length * 0.45, 0, 38);
  const confidence = summary.observations.length < 2 ? 0 : clamp(18 + observationConfidence + modelConfidence, 0, 94);
  const learnedWeight = summary.observations.length >= 2 ? Math.min(0.68, model.rows.length / 100 * 0.68) : 0;
  const score = summary.observations.length < 2
    ? 50
    : clamp(heuristic * (1 - learnedWeight) + learnedRunnerPct * learnedWeight);

  const last = summary.observations[summary.observations.length - 1];
  const distributionPenalty = last
    ? (last.buySellRatio < 0.9 ? (0.9 - last.buySellRatio) * 45 : 0)
      + (summary.currentDrawdownPct > 12 ? (summary.currentDrawdownPct - 12) * 0.7 : 0)
      + (last.volumeAccelerationPct < 0 ? Math.min(18, -last.volumeAccelerationPct * 0.08) : 0)
    : 0;
  const dumperRiskScore = clamp((100 - score) * 0.78 + distributionPenalty);

  const evidence = summary.observations.length < 2
    ? ["Trajectory Observer needs at least two time-separated observations before it influences a trade."]
    : [
        `Trajectory ${phase}: MC ${summary.marketCapGrowthPct >= 0 ? "+" : ""}${summary.marketCapGrowthPct.toFixed(1)}% over ${summary.elapsedMinutes.toFixed(1)}m (${summary.marketCapVelocityPctPerMin.toFixed(2)}%/min).`,
        `Acceleration ${summary.marketCapAcceleration >= 0 ? "+" : ""}${summary.marketCapAcceleration.toFixed(2)} · buy/sell delta ${summary.buySellDelta >= 0 ? "+" : ""}${summary.buySellDelta.toFixed(2)}x · unique-buyer velocity delta ${summary.uniqueBuyerVelocityDelta >= 0 ? "+" : ""}${summary.uniqueBuyerVelocityDelta.toFixed(2)}.`,
        `Pullback ${summary.maxPullbackPct.toFixed(1)}% · recovery ${summary.recoveryPct.toFixed(0)}% · liquidity/MC trend ${summary.liquidityToMcDeltaPct >= 0 ? "+" : ""}${summary.liquidityToMcDeltaPct.toFixed(1)}%.`,
        model.rows.length
          ? `${neighbors.filter((row) => row.row.outcome === "runner").length}/${neighbors.length} nearest trajectory sequences are runners; ${model.chainRows} labeled ${args.chain} sequences available.`
          : "No labeled trajectory model yet; observer is collecting sequence data without pretending certainty.",
      ];

  return {
    score: Number(score.toFixed(1)),
    dumperRiskScore: Number(dumperRiskScore.toFixed(1)),
    confidence: Number(confidence.toFixed(1)),
    phase,
    observationsUsed: summary.observations.length,
    sampleSize: model.rows.length,
    chainSampleSize: model.chainRows,
    learned: model.rows.length >= 20 && summary.observations.length >= 2,
    evidence,
    featureSummary: {
      elapsedMinutes: Number(summary.elapsedMinutes.toFixed(2)),
      marketCapGrowthPct: Number(summary.marketCapGrowthPct.toFixed(2)),
      marketCapVelocityPctPerMin: Number(summary.marketCapVelocityPctPerMin.toFixed(3)),
      marketCapAcceleration: Number(summary.marketCapAcceleration.toFixed(3)),
      buySellDelta: Number(summary.buySellDelta.toFixed(3)),
      volumeAccelerationDelta: Number(summary.volumeAccelerationDelta.toFixed(2)),
      holderVelocityDelta: Number(summary.holderVelocityDelta.toFixed(3)),
      uniqueBuyerVelocityDelta: Number(summary.uniqueBuyerVelocityDelta.toFixed(3)),
      liquidityToMcDeltaPct: Number(summary.liquidityToMcDeltaPct.toFixed(2)),
      maxPullbackPct: Number(summary.maxPullbackPct.toFixed(2)),
      recoveryPct: Number(summary.recoveryPct.toFixed(1)),
    },
  };
}

function lessonForOutcome(row: TrajectoryCaseLike) {
  const summary = summarizeTrajectory(row.observations.slice(0, 16));
  const label = row.outcome === "runner" ? "RUNNER" : row.outcome === "dumper" ? "DUMPER" : row.outcome.toUpperCase();
  return {
    summary,
    headline: `${label} trajectory on $${row.symbol}: ${summary.marketCapGrowthPct >= 0 ? "+" : ""}${summary.marketCapGrowthPct.toFixed(1)}% MC over ${summary.elapsedMinutes.toFixed(1)}m; velocity ${summary.marketCapVelocityPctPerMin.toFixed(2)}%/min; acceleration ${summary.marketCapAcceleration >= 0 ? "+" : ""}${summary.marketCapAcceleration.toFixed(2)}; buy/sell delta ${summary.buySellDelta >= 0 ? "+" : ""}${summary.buySellDelta.toFixed(2)}x; pullback ${summary.maxPullbackPct.toFixed(1)}%; recovery ${summary.recoveryPct.toFixed(0)}%.`,
  };
}

export async function distributeTrajectoryOutcomeLesson(row: TrajectoryCaseLike): Promise<string[]> {
  if (row.outcome !== "runner" && row.outcome !== "dumper") return [];
  if (row.observations.length < 2) return [];

  const { summary, headline } = lessonForOutcome(row);
  const phase = phaseFromSummary(summary);
  const trajectoryScore = heuristicScore(summary);
  const trajectoryDumperRiskScore = clamp(100 - trajectoryScore + (phase === "DISTRIBUTION" ? 18 : 0) + (phase === "STALLED" ? 8 : 0));
  const createdAt = row.observations[row.observations.length - 1]?.at ?? new Date().toISOString();
  const isRunner = row.outcome === "runner";
  const lessons: Array<{ agentId: CouncilEntityId; lesson: string }> = [
    {
      agentId: "launch",
      lesson: isRunner
        ? `Trajectory Observer: runner development mattered more than the frozen first snapshot. ${headline} Increase attention to accelerating MC velocity and recovery sequences like this.`
        : `Trajectory Observer: failed-launch path. ${headline} Treat slowing/negative acceleration after ignition as a stronger warning next time.`,
    },
    {
      agentId: "wallet",
      lesson: `Trajectory Observer: ${row.outcome} flow lesson. Buy/sell delta ${summary.buySellDelta >= 0 ? "+" : ""}${summary.buySellDelta.toFixed(2)}x; holder velocity delta ${summary.holderVelocityDelta >= 0 ? "+" : ""}${summary.holderVelocityDelta.toFixed(2)}; unique-buyer velocity delta ${summary.uniqueBuyerVelocityDelta >= 0 ? "+" : ""}${summary.uniqueBuyerVelocityDelta.toFixed(2)}. Use the direction of participation, not only the current level.`,
    },
    {
      agentId: "quant",
      lesson: `Trajectory Observer sequence signature: ${headline} Compare future launches against this multi-snapshot path rather than a single-point score.`,
    },
    {
      agentId: "bear",
      lesson: isRunner
        ? `Trajectory Observer: this runner survived a ${summary.maxPullbackPct.toFixed(1)}% pullback and recovered ${summary.recoveryPct.toFixed(0)}%. Do not treat this recovery shape as a dumper automatically.`
        : `Trajectory Observer: dumper sequence showed velocity ${summary.marketCapVelocityPctPerMin.toFixed(2)}%/min, acceleration ${summary.marketCapAcceleration.toFixed(2)}, and recovery ${summary.recoveryPct.toFixed(0)}%. Raise dumper pressure when future paths resemble it.`,
    },
    {
      agentId: "portfolio",
      lesson: isRunner
        ? `Trajectory Observer: confirmed runner sequence. When a future setup matches this path with strong confidence, the $50 floor can size upward according to Runner Genome evidence.`
        : `Trajectory Observer: failed sequence. Keep sizing near the training floor when acceleration/recovery resembles this path even if the static snapshot looks attractive.`,
    },
    {
      agentId: "social",
      lesson: `Trajectory Observer: ${row.outcome} sequence had social-velocity change ${finite(row.observations[row.observations.length - 1]?.socialVelocityPct) - finite(row.observations[0]?.socialVelocityPct) >= 0 ? "+" : ""}${(finite(row.observations[row.observations.length - 1]?.socialVelocityPct) - finite(row.observations[0]?.socialVelocityPct)).toFixed(1)}%. Only use it when the provider verifies social data.`,
    },
    {
      agentId: "contract",
      lesson: `Trajectory Observer: ${row.outcome} sequence liquidity/MC trend ${summary.liquidityToMcDeltaPct >= 0 ? "+" : ""}${summary.liquidityToMcDeltaPct.toFixed(1)}%. Keep hard safety independent, but use liquidity behavior as context rather than punishing a token merely for starting small.`,
    },
    {
      agentId: "cio",
      lesson: `Trajectory Observer outcome feedback: ${headline} Future synthesis should distinguish static appearance from how the setup is developing over time.`,
    },
  ];

  await Promise.all(lessons.map(({ agentId, lesson }) => appendPrivateEntityMemory({
    id: `trajectory:${row.id}:${row.outcome}:${agentId}`,
    agentId,
    kind: "trajectory",
    createdAt,
    symbol: row.symbol,
    chain: row.chain,
    decisionId: `trajectory:${row.id}`,
    trajectoryPhase: phase,
    trajectoryScore: Number(trajectoryScore.toFixed(1)),
    trajectoryDumperRiskScore: Number(trajectoryDumperRiskScore.toFixed(1)),
    trajectoryOutcome: row.outcome === "runner" || row.outcome === "dumper" ? row.outcome : undefined,
    lesson: lesson.slice(0, 1_300),
  })));

  return [
    `Trajectory Observer filed ${row.outcome.toUpperCase()} sequence: ${headline}`,
    `Feedback distributed privately to the runner specialists and CIO; the dedicated Sellability Investigator learns only from unsellable outcomes. Observer has no vote and cannot place or block a trade.`,
  ];
}

export function getTrajectoryObserverSnapshot(cases: TrajectoryCaseLike[]): TrajectoryObserverSnapshot {
  const tracked = cases.filter((row) => row.observations.length >= 2);
  const labeled = tracked.filter((row) => row.outcome === "runner" || row.outcome === "dumper");
  const runner = labeled.filter((row) => row.outcome === "runner");
  const dumper = labeled.filter((row) => row.outcome === "dumper");
  const chainCounts = new Map<string, number>();
  for (const row of labeled) chainCounts.set(row.chain, (chainCounts.get(row.chain) ?? 0) + 1);
  const chainModels = [...chainCounts.values()].filter((count) => count >= 12).length;

  const latestLessons = [...labeled]
    .sort((a, b) => {
      const aa = a.observations[a.observations.length - 1]?.at ?? a.firstSeenAt;
      const bb = b.observations[b.observations.length - 1]?.at ?? b.firstSeenAt;
      return bb.localeCompare(aa);
    })
    .slice(0, 6)
    .map((row) => ({
      symbol: row.symbol,
      chain: row.chain,
      outcome: row.outcome,
      message: lessonForOutcome(row).headline,
    }));

  return {
    sequencesTracked: tracked.length,
    labeledSequences: labeled.length,
    runnerSequences: runner.length,
    dumperSequences: dumper.length,
    chainModels,
    latestLessons,
  };
}

export function snapshotToTrajectoryObservation(snapshot: MarketSnapshot): TrajectoryObservationLike {
  const mc = Math.max(0, snapshot.marketCap);
  return {
    at: new Date().toISOString(),
    marketCap: mc,
    liquidity: Math.max(0, snapshot.liquidity),
    buySellRatio: finite(snapshot.buySellRatio, 1),
    volume5m: finite(snapshot.volume5m),
    volume24h: finite(snapshot.volume24h),
    volumeAccelerationPct: finite(snapshot.volumeAccelerationPct ?? snapshot.launchMetrics?.volumeAccelerationPct),
    transactionAccelerationPct: finite(snapshot.launchMetrics?.transactionAccelerationPct),
    holderVelocity: finite(snapshot.launchMetrics?.holdersPerMinute),
    uniqueBuyerVelocity: finite(snapshot.launchMetrics?.uniqueBuyersPerMinute),
    top10Pct: finite(snapshot.top10Pct),
    bundledPct: finite(snapshot.bundledPct),
    socialVelocityPct: finite(snapshot.socialVelocityPct),
  };
}
