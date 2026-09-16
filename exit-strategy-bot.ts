import type {
  ExitStrategy,
  ManagedPosition,
  MarketSnapshot,
  PortfolioRiskContext,
  RunnerExitGenomeGuidance,
} from "./types";

export type ExitStrategistDecision = {
  action: "HOLD" | "EXIT";
  score: number;
  trailingStopPct: number;
  maxHoldMinutes: number;
  reason: string;
  capitalRecycle: boolean;
  deadTrade: boolean;
  profitLock: boolean;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export function profitFirstExitStrategy(exit: ExitStrategy): ExitStrategy {
  return {
    ...exit,
    // We are deliberately not waiting for 50/100/200/400 before banking anything.
    // Sell 90% progressively and leave a 10% moonbag for exceptional runners.
    takeProfits: [
      { gainPct: 25, sellPct: 20, label: "TP1" },
      { gainPct: 50, sellPct: 20, label: "TP2" },
      { gainPct: 100, sellPct: 25, label: "TP3" },
      { gainPct: 200, sellPct: 25, label: "Runner" },
    ],
    moonbagPct: 10,
    // There is always another runner. Do not let a good paper trade turn into
    // dead capital for hours.
    stopLossPct: Math.min(exit.stopLossPct, 18),
    trailingStopPct: Math.min(exit.trailingStopPct, 14),
    maxHoldMinutes: Math.min(exit.maxHoldMinutes, 90),
    winnerActivationPct: Math.min(exit.winnerActivationPct ?? 20, 20),
    winnerTrailingStopPct: Math.min(exit.winnerTrailingStopPct ?? 16, 16),
    winnerMaxHoldMinutes: Math.min(exit.winnerMaxHoldMinutes ?? 180, 180),
    moonbagTrailingStopPct: Math.min(exit.moonbagTrailingStopPct ?? 24, 24),
    moonbagMaxHoldMinutes: Math.min(exit.moonbagMaxHoldMinutes ?? 1_440, 1_440),
    breakEvenBufferPct: Math.max(exit.breakEvenBufferPct ?? 2, 3),
    invalidationRules: [
      ...exit.invalidationRules,
      "Exit Strategist releases stale capital when a setup stops behaving like a runner",
      "Exit Strategist protects large high-water gains instead of round-tripping them",
    ],
  };
}

export function evaluateExitStrategist(args: {
  position: ManagedPosition;
  snapshot: MarketSnapshot;
  portfolio?: PortfolioRiskContext;
  exitGenome?: RunnerExitGenomeGuidance;
}): ExitStrategistDecision {
  const { position, snapshot, portfolio, exitGenome } = args;
  const entry = Math.max(position.entryPrice, 1e-12);
  const rawMovePct = (snapshot.price / entry - 1) * 100;
  const highWater = Math.max(position.highWaterPrice, snapshot.price);
  const highWaterGainPct = (highWater / entry - 1) * 100;
  const drawdownFromHighPct = highWater > 0 ? (highWater - snapshot.price) / highWater * 100 : 0;
  const heldMinutes = Math.max(0, (Date.now() - new Date(position.openedAt).getTime()) / 60_000);

  const currentIsNewHigh = snapshot.price > position.highWaterPrice * 1.0005;
  const lastHighAt = currentIsNewHigh
    ? Date.now()
    : new Date(position.lastHighWaterAt ?? position.openedAt).getTime();
  const minutesSinceHigh = Math.max(0, (Date.now() - lastHighAt) / 60_000);

  const continuation = exitGenome?.continuationScore ?? Math.max(
    0,
    Math.min(
      100,
      50
      + (snapshot.buySellRatio - 1) * 22
      + (snapshot.volumeAccelerationPct ?? snapshot.launchMetrics?.volumeAccelerationPct ?? 0) * 0.10
      + rawMovePct * 0.18
    )
  );
  const distribution = exitGenome?.distributionRiskScore ?? Math.max(
    0,
    Math.min(
      100,
      48
      + (1 - snapshot.buySellRatio) * 28
      + Math.max(0, -(snapshot.volumeAccelerationPct ?? snapshot.launchMetrics?.volumeAccelerationPct ?? 0)) * 0.10
    )
  );

  // Tighten as profit gets larger. This is intentionally more profit-first than
  // the previous 22%+ winner trail.
  let trailingStopPct = 14;
  if (highWaterGainPct >= 200) trailingStopPct = 18;
  else if (highWaterGainPct >= 100) trailingStopPct = 16;
  else if (highWaterGainPct >= 50) trailingStopPct = 14;
  else if (highWaterGainPct >= 25) trailingStopPct = 12;

  if (continuation >= 82 && distribution < 40) trailingStopPct = Math.min(20, trailingStopPct + 2);
  if (distribution >= 68) trailingStopPct = Math.max(8, trailingStopPct - 3);
  if (exitGenome) trailingStopPct = Math.min(trailingStopPct, Math.max(8, exitGenome.trailingStopPct));

  // Maximum useful hold time depends on whether the trade is actually progressing.
  let maxHoldMinutes = 45;
  if (rawMovePct >= 10) maxHoldMinutes = 75;
  if (rawMovePct >= 25) maxHoldMinutes = 120;
  if (rawMovePct >= 50) maxHoldMinutes = 180;
  if (rawMovePct >= 100 && continuation >= 70) maxHoldMinutes = 240;
  if (position.winnerState === "moonbag") maxHoldMinutes = 1_440;

  const minimumTrainingCash = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
  const capitalRecycle = Boolean(
    portfolio
    && portfolio.cashUsd + 0.005 < minimumTrainingCash
    && heldMinutes >= 20
    && rawMovePct < 20
    && continuation < 70
    && minutesSinceHigh >= 12
  );

  // A dead trade should stop occupying capital while fresh $10K-$50K runners
  // continue appearing.
  const deadTrade = Boolean(
    (heldMinutes >= 20 && rawMovePct <= -8)
    || (heldMinutes >= 30 && rawMovePct < 5 && continuation < 60 && minutesSinceHigh >= 15)
    || (heldMinutes >= 60 && rawMovePct < 15 && continuation < 66 && minutesSinceHigh >= 20)
    || (heldMinutes >= 120 && rawMovePct < 30 && minutesSinceHigh >= 30)
  );

  // High-water locks. Once a runner gave us a large gain, we refuse to hand the
  // entire move back just to keep hoping.
  let protectedFloorPct: number | null = null;
  if (highWaterGainPct >= 300) protectedFloorPct = 180;
  else if (highWaterGainPct >= 200) protectedFloorPct = 115;
  else if (highWaterGainPct >= 125) protectedFloorPct = 65;
  else if (highWaterGainPct >= 75) protectedFloorPct = 32;
  else if (highWaterGainPct >= 40) protectedFloorPct = 12;

  const profitLock = protectedFloorPct !== null && rawMovePct <= protectedFloorPct;

  const distributionExit = Boolean(
    distribution >= 78
    && snapshot.buySellRatio < 0.9
    && minutesSinceHigh >= 8
    && rawMovePct < Math.max(35, highWaterGainPct * 0.60)
  );

  const action: "HOLD" | "EXIT" =
    profitLock || deadTrade || capitalRecycle || distributionExit ? "EXIT" : "HOLD";

  const holdScore = clamp(
    continuation * 0.48
    + (100 - distribution) * 0.27
    + Math.max(0, Math.min(100, 50 + rawMovePct * 0.35)) * 0.15
    + Math.max(0, Math.min(100, 100 - minutesSinceHigh * 2)) * 0.10
  );

  let reason = `Exit Strategist HOLD ${holdScore.toFixed(0)}/100 · continuation ${continuation.toFixed(0)} · distribution ${distribution.toFixed(0)} · ${minutesSinceHigh.toFixed(0)}m since high · active trail ${trailingStopPct.toFixed(1)}%.`;
  if (profitLock) {
    reason = `Exit Strategist PROFIT LOCK: peak +${highWaterGainPct.toFixed(1)}% has retraced to +${rawMovePct.toFixed(1)}%; protected floor +${protectedFloorPct!.toFixed(0)}% reached. Bank the remaining position.`;
  } else if (capitalRecycle) {
    reason = `Exit Strategist CAPITAL RECYCLE: paper cash is below the $${minimumTrainingCash.toFixed(0)} training floor and this ${heldMinutes.toFixed(0)}m-old setup is no longer strong enough to keep capital tied up.`;
  } else if (deadTrade) {
    reason = `Exit Strategist DEAD TRADE: ${heldMinutes.toFixed(0)}m held, ${rawMovePct.toFixed(1)}% move, ${minutesSinceHigh.toFixed(0)}m since high, continuation ${continuation.toFixed(0)}/100. Release capital for the next runner.`;
  } else if (distributionExit) {
    reason = `Exit Strategist DISTRIBUTION EXIT: distribution risk ${distribution.toFixed(0)}/100 and buy/sell ${snapshot.buySellRatio.toFixed(2)}x after the high.`;
  }

  return {
    action,
    score: Number(holdScore.toFixed(1)),
    trailingStopPct: Number(trailingStopPct.toFixed(1)),
    maxHoldMinutes,
    reason,
    capitalRecycle,
    deadTrade,
    profitLock,
  };
}
