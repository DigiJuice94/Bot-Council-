import { runWarRoom } from "./engine";
import { executePaper } from "./execution";
import { fetchLivePositionSnapshot } from "./market-data";
import { applyPaperFillToWallet, canAffordPaperBuy, getPaperPortfolioContext } from "./paper-wallet";
import { appendFillJournal } from "./trade-journal";
import { effectiveGuardianControls, confirmationScore, determineWinnerState, maxGrossExposurePct, nextScaleStep, SCALE_STEPS } from "./position-policy";
import { acquireRuntimeLease, listManagedPositions, positionStorageMode, removeManagedPosition, saveManagedPosition } from "./position-store";
import { reflectOnClosedPosition } from "./reflection";
import { evaluateExitStrategist, profitFirstExitStrategy } from "./exit-strategy-bot";
import { getRunnerExitGuidance } from "./runner-research";
import type { ExecutionRequest, ExitLevel, ExitStrategy, ManagedPosition, MarketSnapshot, PaperFill, PortfolioRiskContext, PositionAction, PositionEntryContext, PositionGuardianReport, RunnerExitGenomeGuidance, WarRoomResult } from "./types";

const safe = (n: number | undefined, fallback = 0) => Number.isFinite(n) ? Number(n) : fallback;
const FAVORABLE_REENTRY = new Set(["meme_expansion", "new_chain_mania", "risk_on_trend"]);

function normalizedPosition(position: ManagedPosition): ManagedPosition {
  return {
    ...position,
    remainingQuantity: safe(position.remainingQuantity, position.quantity),
    initialQuantity: safe(position.initialQuantity, position.quantity),
    initialEntryPrice: safe(position.initialEntryPrice, position.entryPrice),
    initialNotionalUsd: safe(position.initialNotionalUsd, position.entryNotionalUsd),
    lowWaterPrice: safe(position.lowWaterPrice, position.entryPrice),
    realizedProceedsUsd: safe(position.realizedProceedsUsd),
    realizedCostUsd: safe(position.realizedCostUsd),
    realizedPnlUsd: safe(position.realizedPnlUsd),
    maxFavorableExcursionPct: safe(position.maxFavorableExcursionPct),
    maxAdverseExcursionPct: safe(position.maxAdverseExcursionPct),
    profitCapturePct: safe(position.profitCapturePct),
    takenProfitLabels: position.takenProfitLabels ?? [],
    winnerState: position.winnerState ?? "building",
    scaleIns: position.scaleIns ?? [],
    lastConfirmationScore: safe(position.lastConfirmationScore),
    maxGrossExposurePct: safe(position.maxGrossExposurePct, Math.max(5, Math.min(20, Number(process.env.PAPER_WINNER_MAX_GROSS_PCT ?? 15)))),
    reentryCount: Math.max(0, Math.round(safe(position.reentryCount))),
    breakEvenArmed: Boolean(position.breakEvenArmed),
    exitStrategy: profitFirstExitStrategy(position.exitStrategy),
    lastHighWaterAt: position.lastHighWaterAt ?? position.openedAt,
    peakPnlPct: safe(position.peakPnlPct, position.maxFavorableExcursionPct),
    exitStrategistScore: safe(position.exitStrategistScore),
    exitStrategistReason: position.exitStrategistReason ?? "",
  };
}

function markToMarketPnlPct(position: ManagedPosition, mark: number) {
  if (position.entryNotionalUsd <= 0) return 0;
  const unrealizedValue = position.remainingQuantity * mark;
  const totalValue = position.realizedProceedsUsd + unrealizedValue;
  return (totalValue - position.entryNotionalUsd) / position.entryNotionalUsd * 100;
}

function paperRequest(position: ManagedPosition, side: "BUY" | "SELL", notionalUsd: number, suffix: string): ExecutionRequest {
  return {
    mode: "paper",
    chain: position.chain,
    tokenAddress: position.tokenAddress,
    symbol: position.symbol,
    side,
    notionalUsd: Math.max(0, notionalUsd),
    maxSlippageBps: side === "BUY" ? Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600) : suffix === "EXIT" ? 9000 : Number(process.env.PAPER_PROFIT_TAKE_MAX_SLIPPAGE_BPS ?? 2000),
    strategyId: position.strategyId,
    decisionId: `${position.decisionId}-${suffix}`,
  };
}

export async function assessPaperEntryEligibility(args: {
  request: ExecutionRequest;
  snapshot: MarketSnapshot;
  entryContext?: PositionEntryContext;
}): Promise<{ allowed: boolean; isReentry: boolean; reentryCount: number; reason: string }> {
  const { request, snapshot, entryContext } = args;
  const affordability = await canAffordPaperBuy(request.notionalUsd);
  if (!affordability.allowed) return { allowed: false, isReentry: false, reentryCount: 0, reason: affordability.reason ?? "Paper wallet cannot fund this entry." };
  const positions = (await listManagedPositions()).map(normalizedPosition);
  const sameToken = positions.filter((position) => position.chain === request.chain && position.tokenAddress === request.tokenAddress);
  const open = sameToken.find((position) => position.status !== "closed");
  if (open) return { allowed: false, isReentry: false, reentryCount: open.reentryCount ?? 0, reason: "Position Guardian already owns an open position in this token; V2.8 scales winners internally instead of opening duplicates." };

  if (!snapshot.sellable || snapshot.honeypot || snapshot.top10Pct > 80 || snapshot.bundledPct > 25 || (snapshot.chainFamily === "solana" && (snapshot.mintAuthority || snapshot.freezeAuthority))) {
    return { allowed: false, isReentry: false, reentryCount: 0, reason: "Re-entry blocked by deterministic contract/security conditions." };
  }

  const closed = sameToken.filter((position) => position.status === "closed").sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt));
  if (!closed.length) return { allowed: true, isReentry: false, reentryCount: 0, reason: "Fresh position; no prior closed trade requires re-entry checks." };

  const latest = closed[0];
  const latestClosedMs = new Date(latest.closedAt ?? latest.updatedAt).getTime();
  const ageMs = Date.now() - latestClosedMs;
  const latestWasStop = latest.lastReason.toLowerCase().includes("stop loss") || latest.lastReason.toLowerCase().includes("breakeven protection");
  if (!latestWasStop) {
    if (ageMs < 30 * 60_000) return { allowed: false, isReentry: false, reentryCount: latest.reentryCount ?? 0, reason: "Recent completed trade is cooling down for 30 minutes before a new independent entry." };
    return { allowed: true, isReentry: false, reentryCount: 0, reason: "Prior trade was completed normally; this is treated as a new setup." };
  }

  const recentStops = closed.filter((position) => {
    const closedMs = new Date(position.closedAt ?? position.updatedAt).getTime();
    const stopped = position.lastReason.toLowerCase().includes("stop loss") || position.lastReason.toLowerCase().includes("breakeven protection");
    return stopped && Date.now() - closedMs <= 24 * 60 * 60_000;
  });
  if (recentStops.length >= 2) return { allowed: false, isReentry: true, reentryCount: recentStops.length, reason: "Re-entry blocked: two stop-outs in the last 24 hours reached the anti-churn limit." };
  if (ageMs < 15 * 60_000) return { allowed: false, isReentry: true, reentryCount: recentStops.length, reason: "Re-entry watch is active, but the 15-minute stop-out cooldown has not finished." };
  const memeReentry = Boolean(entryContext?.councilProcess?.lane === "meme" && entryContext?.memeRegime?.entryAllowed &&
    (entryContext?.councilProcess?.researchSupport ?? 0) >= (entryContext?.councilProcess?.requiredResearchSupport ?? 99) &&
    (entryContext?.alpha.score ?? 0) >= (entryContext?.memeRegime?.minAlphaScore ?? 100));
  const standardReentry = Boolean(entryContext && FAVORABLE_REENTRY.has(entryContext.regime.id) && entryContext.alpha.action === "TRADE");
  if (!entryContext || entryContext.decision !== "BUY" || (!memeReentry && !standardReentry)) {
    return { allowed: false, isReentry: true, reentryCount: recentStops.length, reason: "Re-entry requires a fresh Council-confirmed BUY in either a favorable standard regime or an active meme breakout/acceleration lane." };
  }

  const previous = latest.entryContext;
  const strengthRecovered = !previous ||
    entryContext.alpha.score >= previous.alpha.score + 2 ||
    entryContext.conviction >= previous.conviction + 3 ||
    (entryContext.alpha.score >= previous.alpha.score && entryContext.conviction >= previous.conviction);
  if (!strengthRecovered) return { allowed: false, isReentry: true, reentryCount: recentStops.length, reason: "Re-entry blocked: the fresh Alpha/Council setup has not recovered to the prior thesis strength." };
  if (snapshot.price < latest.markPrice * 1.05) return { allowed: false, isReentry: true, reentryCount: recentStops.length, reason: "Re-entry blocked until price recovers at least 5% from the prior stopped mark; no blind revenge entry." };

  return { allowed: true, isReentry: true, reentryCount: recentStops.length + 1, reason: "Fresh Council-confirmed BUY reconfirmed after cooldown and price recovery; controlled re-entry approved." };
}

export async function registerPaperPosition(args: {
  fill: PaperFill;
  request: ExecutionRequest;
  snapshot: MarketSnapshot;
  exitStrategy: ExitStrategy;
  entryContext?: PositionEntryContext;
  reentryCount?: number;
}): Promise<ManagedPosition | null> {
  const { fill, request, snapshot, exitStrategy, entryContext } = args;
  if (fill.side !== "BUY") return null;
  const now = new Date().toISOString();
  const quantity = fill.filledUsd / Math.max(fill.fillPrice, 0.0000000001);
  const initialAllocationPct = entryContext?.initialAllocationPct;
  const winnerCap = Math.max(5, Math.min(20, Number(process.env.PAPER_WINNER_MAX_GROSS_PCT ?? 15)));
  const maxExposure = typeof initialAllocationPct === "number" && initialAllocationPct > 0 ? Math.min(winnerCap, initialAllocationPct * 2.8) : winnerCap;
  const position: ManagedPosition = {
    id: `POS-${fill.id}`,
    chain: fill.chain,
    tokenAddress: request.tokenAddress,
    symbol: fill.symbol,
    imageUrl: snapshot.imageUrl,
    strategyId: request.strategyId,
    decisionId: request.decisionId,
    mode: request.mode,
    status: "open",
    quantity,
    remainingQuantity: quantity,
    initialQuantity: quantity,
    entryPrice: fill.fillPrice,
    initialEntryPrice: fill.fillPrice,
    markPrice: snapshot.price,
    highWaterPrice: Math.max(fill.fillPrice, snapshot.price),
    lowWaterPrice: Math.min(fill.fillPrice, snapshot.price),
    entryNotionalUsd: fill.filledUsd,
    initialNotionalUsd: fill.filledUsd,
    remainingNotionalUsd: fill.filledUsd,
    realizedProceedsUsd: 0,
    realizedCostUsd: 0,
    realizedPnlUsd: 0,
    pnlPct: ((snapshot.price - fill.fillPrice) / Math.max(fill.fillPrice, 1e-12)) * 100,
    maxFavorableExcursionPct: Math.max(0, ((snapshot.price - fill.fillPrice) / Math.max(fill.fillPrice, 1e-12)) * 100),
    maxAdverseExcursionPct: Math.min(0, ((snapshot.price - fill.fillPrice) / Math.max(fill.fillPrice, 1e-12)) * 100),
    profitCapturePct: 0,
    openedAt: now,
    updatedAt: now,
    lastMarketDataAt: now,
    lastAction: "HOLD",
    lastReason: args.reentryCount ? `Controlled re-entry #${args.reentryCount} registered. Guardian will require fresh confirmation before scaling.` : "Position registered. Guardian will enter small, demand confirmation before scaling, and preserve a moonbag if the trade becomes a winner.",
    takenProfitLabels: [],
    winnerState: "building",
    scaleIns: [],
    lastConfirmationScore: 0,
    maxGrossExposurePct: Number(maxExposure.toFixed(3)),
    reentryCount: args.reentryCount ?? 0,
    breakEvenArmed: false,
    lastHighWaterAt: now,
    peakPnlPct: Math.max(0, ((snapshot.price - fill.fillPrice) / Math.max(fill.fillPrice, 1e-12)) * 100),
    exitStrategistScore: 50,
    exitStrategistReason: "Exit Strategist armed on entry.",
    exitStrategy: profitFirstExitStrategy(exitStrategy),
    entryContext,
  };
  await saveManagedPosition(position);
  try {
    await applyPaperFillToWallet({
      fill,
      decisionId: request.decisionId,
      tokenAddress: request.tokenAddress,
      positionId: position.id,
      action: "ENTRY",
      quantity,
      remainingQuantityAfter: quantity,
      markPriceAfter: snapshot.price,
      entryNotionalAfterUsd: position.entryNotionalUsd,
      realizedCostAfterUsd: 0,
      positionRealizedPnlAfterUsd: 0,
      nextTargetPrice: nextTargetPrice(position),
      moonbagExitFloorPrice: moonbagExitFloorPrice(position),
    });
    await appendFillJournal(fill, request.tokenAddress, position.id);
  } catch (error) {
    await removeManagedPosition(position.id).catch(() => undefined);
    throw error;
  }
  return position;
}

function nextTakeProfit(position: ManagedPosition, pnlPct: number): ExitLevel | undefined {
  return position.exitStrategy.takeProfits.find((level) => !position.takenProfitLabels.includes(level.label) && pnlPct >= level.gainPct);
}

function nextTargetPrice(position: ManagedPosition, takenLabels = position.takenProfitLabels) {
  const next = position.exitStrategy.takeProfits.find((level) => !takenLabels.includes(level.label));
  return next ? position.entryPrice * (1 + next.gainPct / 100) : undefined;
}

function moonbagExitFloorPrice(position: ManagedPosition) {
  const trailingPct = Math.max(0, position.exitStrategy.moonbagTrailingStopPct ?? position.exitStrategy.trailingStopPct ?? 0);
  return position.highWaterPrice > 0 ? position.highWaterPrice * (1 - trailingPct / 100) : undefined;
}

function freshCouncil(position: ManagedPosition, snapshot: MarketSnapshot, portfolio?: PortfolioRiskContext): WarRoomResult {
  return runWarRoom(snapshot, {
    mode: "paper",
    agentWeights: position.entryContext?.agentWeights,
    learningSource: position.entryContext ? "learned" : "defaults",
    portfolio,
  });
}

export function evaluatePosition(positionInput: ManagedPosition, snapshot: MarketSnapshot, portfolio?: PortfolioRiskContext, exitGenome?: RunnerExitGenomeGuidance): ManagedPosition {
  const position = normalizedPosition(positionInput);
  const now = new Date().toISOString();
  const mark = snapshot.price;
  const highWater = Math.max(position.highWaterPrice, mark);
  const lowWater = Math.min(position.lowWaterPrice, mark);
  const madeNewHigh = mark > position.highWaterPrice * 1.0005;
  const lastHighWaterAt = madeNewHigh ? now : (position.lastHighWaterAt ?? position.openedAt);
  const rawMovePct = position.entryPrice > 0 ? ((mark - position.entryPrice) / position.entryPrice) * 100 : 0;
  const currentPnl = markToMarketPnlPct(position, mark);
  const drawdownFromHigh = highWater > 0 ? ((highWater - mark) / highWater) * 100 : 0;
  const heldMinutes = Math.max(0, (Date.now() - new Date(position.openedAt).getTime()) / 60_000);
  const fresh = freshCouncil(position, snapshot, portfolio);
  const confirmation = confirmationScore(position, snapshot, fresh);
  const winnerState = determineWinnerState(position, rawMovePct, confirmation);
  const controls = effectiveGuardianControls(position, winnerState);
  const exitStrategist = evaluateExitStrategist({ position, snapshot, portfolio, exitGenome });
  const genomeTrailingStopPct = exitGenome ? Math.max(6, Math.min(40, exitGenome.trailingStopPct)) : controls.trailingStopPct;
  const genomeMaxHoldMinutes = exitGenome ? Math.max(15, controls.maxHoldMinutes * exitGenome.maxHoldMultiplier) : controls.maxHoldMinutes;
  const activeTrailingStopPct = Math.min(genomeTrailingStopPct, exitStrategist.trailingStopPct);
  const activeMaxHoldMinutes = Math.min(genomeMaxHoldMinutes, exitStrategist.maxHoldMinutes);
  const highWaterGainPct = position.entryPrice > 0 ? ((highWater - position.entryPrice) / position.entryPrice) * 100 : 0;
  const firstTarget = position.exitStrategy.takeProfits[0]?.gainPct ?? 18;
  const breakEvenArmed = Boolean(position.breakEvenArmed || ((winnerState !== "building") && (position.takenProfitLabels.includes("TP1") || highWaterGainPct >= firstTarget)));
  const breakEvenFloorPct = position.exitStrategy.breakEvenBufferPct ?? 1.5;

  const stopTriggered = rawMovePct <= -position.exitStrategy.stopLossPct;
  const breakEvenTriggered = breakEvenArmed && rawMovePct <= breakEvenFloorPct;
  const trailTriggered = rawMovePct > 0 && drawdownFromHigh >= activeTrailingStopPct;
  const liquidityTriggered = snapshot.liquidity < position.exitStrategy.liquidityFloorUsd;
  const securityTriggered = !snapshot.sellable || snapshot.honeypot || snapshot.top10Pct > 80 || snapshot.bundledPct > 25;
  const authorityTriggered = snapshot.chainFamily === "solana" && (snapshot.mintAuthority || snapshot.freezeAuthority);
  const timeTriggered = heldMinutes >= activeMaxHoldMinutes;
  const tp = nextTakeProfit(position, rawMovePct);
  const scaleStep = nextScaleStep(position, snapshot, fresh, confirmation);

  let lastAction: PositionAction = "HOLD";
  let status = position.status;
  let pendingScaleLabel: string | undefined;
  let lastReason = `${winnerState.toUpperCase()} · confirmation ${confirmation.toFixed(0)}/100 · portfolio PnL ${currentPnl.toFixed(1)}% · high-water drawdown ${drawdownFromHigh.toFixed(1)}%. ${exitGenome ? exitGenome.reason : ""}`;

  const genomeExitTriggered = exitGenome?.action === "EXIT";
  const strategistExitTriggered = exitStrategist.action === "EXIT";

  if (securityTriggered || authorityTriggered || liquidityTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = securityTriggered || authorityTriggered
      ? "Emergency exit: contract/security condition changed."
      : `Emergency exit: liquidity fell below $${Math.round(position.exitStrategy.liquidityFloorUsd).toLocaleString()} floor.`;
  } else if (strategistExitTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = exitStrategist.reason || "Exit Strategist requested capital/profit protection exit.";
  } else if (genomeExitTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = exitGenome?.reason ?? "Exit Genome invalidated runner continuation.";
  } else if (stopTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = `Exit: stop loss ${position.exitStrategy.stopLossPct.toFixed(1)}% triggered.`;
  } else if (breakEvenTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = `Exit: breakeven protection armed after winner confirmation; mark fell to ${rawMovePct.toFixed(1)}% vs ${breakEvenFloorPct.toFixed(1)}% protected floor.`;
  } else if (trailTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = `Exit: ${winnerState} trailing stop ${controls.trailingStopPct.toFixed(1)}% from high-water triggered.`;
  } else if (timeTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = `Exit: ${winnerState} max hold ${controls.maxHoldMinutes} minutes reached.`;
  } else if (tp) {
    lastAction = "TRIM";
    lastReason = `${tp.label}: +${tp.gainPct}% target reached; Guardian will realize ${tp.sellPct}% of scaled position once and preserve ${position.exitStrategy.moonbagPct ?? 0}% for the moonbag.`;
  } else if (scaleStep) {
    lastAction = "SCALE_IN";
    pendingScaleLabel = scaleStep.label;
    lastReason = `${scaleStep.label}: winner reconfirmed at ${confirmation.toFixed(0)}/100 while +${rawMovePct.toFixed(1)}%; add ${scaleStep.addMultipleOfInitial.toFixed(1)}x initial size. No averaging down.`;
  }

  const mfe = Math.max(position.maxFavorableExcursionPct, rawMovePct);
  const mae = Math.min(position.maxAdverseExcursionPct, rawMovePct);
  const realizedReturnPct = position.entryNotionalUsd > 0 ? position.realizedPnlUsd / position.entryNotionalUsd * 100 : 0;
  const capture = mfe > 0 && realizedReturnPct > 0 ? Math.max(0, Math.min(100, realizedReturnPct / mfe * 100)) : position.profitCapturePct;

  return {
    ...position,
    status,
    imageUrl: snapshot.imageUrl ?? position.imageUrl,
    markPrice: mark,
    highWaterPrice: highWater,
    lowWaterPrice: lowWater,
    pnlPct: Number(currentPnl.toFixed(3)),
    maxFavorableExcursionPct: Number(mfe.toFixed(3)),
    maxAdverseExcursionPct: Number(mae.toFixed(3)),
    profitCapturePct: Number(capture.toFixed(2)),
    winnerState,
    lastConfirmationScore: confirmation,
    breakEvenArmed,
    lastHighWaterAt,
    peakPnlPct: Number(Math.max(position.peakPnlPct ?? 0, rawMovePct).toFixed(3)),
    exitStrategistScore: exitStrategist.score,
    exitStrategistReason: exitStrategist.reason,
    pendingScaleLabel,
    updatedAt: now,
    lastMarketDataAt: now,
    lastAction,
    lastReason,
  };
}

async function executeScaleIn(positionInput: ManagedPosition, snapshot: MarketSnapshot, portfolio: PortfolioRiskContext): Promise<ManagedPosition> {
  const position = normalizedPosition(positionInput);
  const fresh = freshCouncil(position, snapshot, portfolio);
  const confirmation = confirmationScore(position, snapshot, fresh);
  const step = nextScaleStep(position, snapshot, fresh, confirmation);
  if (!step || (position.pendingScaleLabel && step.label !== position.pendingScaleLabel)) return { ...position, pendingScaleLabel: undefined, lastAction: "HOLD", lastReason: "Scale-in cancelled because confirmation weakened before execution." };

  const lastScale = position.scaleIns?.[position.scaleIns.length - 1];
  if (lastScale && Date.now() - new Date(lastScale.createdAt).getTime() < 10 * 60_000) {
    return { ...position, pendingScaleLabel: undefined, lastAction: "HOLD", lastReason: "Scale-in confirmation remains valid, but the 10-minute pyramid cooldown prevents stacking additions at one price." };
  }

  const initialNotional = Math.max(0.01, position.initialNotionalUsd ?? position.entryNotionalUsd);
  const capPct = maxGrossExposurePct(position);
  const minimumAddUsd = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
  const maxAddUsd = Math.max(minimumAddUsd, Number(process.env.PAPER_WINNER_MAX_ADD_USD ?? 100));
  const entryGenomeScore = position.entryContext?.runnerGenome?.entryScore ?? 60;
  const genomeAddTarget = entryGenomeScore >= 88 ? 100 : entryGenomeScore >= 78 ? 75 : minimumAddUsd;
  const exposureRoomUsd = Math.max(0, portfolio.equityUsd * capPct / 100 - position.entryNotionalUsd);
  const requestedUsd = Math.min(maxAddUsd, Math.max(minimumAddUsd, genomeAddTarget), exposureRoomUsd, Math.max(0, portfolio.cashUsd));
  if (requestedUsd + 0.005 < minimumAddUsd) {
    return {
      ...position,
      pendingScaleLabel: undefined,
      lastAction: "HOLD",
      lastReason: `Winner add remains valid, but only $${portfolio.cashUsd.toFixed(2)} paper cash is available. Waiting for $${minimumAddUsd.toFixed(2)}+ cash.`,
    };
  }

  const fill = await executePaper(paperRequest(position, "BUY", requestedUsd, step.label), snapshot);
  const addedQty = fill.filledUsd / Math.max(fill.fillPrice, 1e-12);
  const oldQty = position.quantity;
  const newQty = oldQty + addedQty;
  const newEntryNotional = position.entryNotionalUsd + fill.filledUsd;
  const newEntryPrice = newQty > 0 ? (position.entryPrice * oldQty + fill.fillPrice * addedQty) / newQty : position.entryPrice;
  const newRemainingQty = position.remainingQuantity + addedQty;
  const scaledPosition = { ...position, entryPrice: newEntryPrice, entryNotionalUsd: newEntryNotional };
  await applyPaperFillToWallet({
    fill,
    decisionId: `${position.decisionId}-${step.label}`,
    tokenAddress: position.tokenAddress,
    positionId: position.id,
    action: "SCALE_IN",
    quantity: addedQty,
    remainingQuantityAfter: newRemainingQty,
    markPriceAfter: snapshot.price,
    entryNotionalAfterUsd: newEntryNotional,
    realizedCostAfterUsd: position.realizedCostUsd,
    positionRealizedPnlAfterUsd: position.realizedPnlUsd,
    nextTargetPrice: nextTargetPrice(scaledPosition),
    moonbagExitFloorPrice: moonbagExitFloorPrice(scaledPosition),
  });
  await appendFillJournal(fill, position.tokenAddress, position.id);

  return {
    ...position,
    quantity: newQty,
    remainingQuantity: newRemainingQty,
    entryPrice: newEntryPrice,
    entryNotionalUsd: newEntryNotional,
    remainingNotionalUsd: newRemainingQty * newEntryPrice,
    scaleIns: [...(position.scaleIns ?? []), {
      label: step.label,
      filledUsd: fill.filledUsd,
      fillPrice: fill.fillPrice,
      confirmationScore: confirmation,
      alphaScore: fresh.alpha.score,
      councilConviction: fresh.conviction,
      createdAt: fill.createdAt,
    }],
    maxGrossExposurePct: capPct,
    pendingScaleLabel: undefined,
    updatedAt: new Date().toISOString(),
    lastAction: "SCALE_IN",
    lastReason: `${step.label} filled for $${fill.filledUsd.toFixed(2)} @ ${fill.fillPrice}. Total paper cost $${newEntryNotional.toFixed(2)}; weighted entry ${newEntryPrice}.`,
  };
}

async function executeTrim(position: ManagedPosition, snapshot: MarketSnapshot, level: ExitLevel): Promise<ManagedPosition> {
  const originalQtyTarget = position.quantity * (level.sellPct / 100);
  const sellQty = Math.min(position.remainingQuantity, originalQtyTarget);
  if (sellQty <= 0) return position;
  const fill = await executePaper(paperRequest(position, "SELL", sellQty * snapshot.price, `TP-${level.label}`), snapshot);
  const cost = sellQty * position.entryPrice;
  const remainingQuantity = Math.max(0, position.remainingQuantity - sellQty);
  const realizedProceedsUsd = position.realizedProceedsUsd + fill.filledUsd;
  const realizedCostUsd = position.realizedCostUsd + cost;
  const realizedPnlUsd = realizedProceedsUsd - realizedCostUsd;
  const realizedReturnPct = position.entryNotionalUsd > 0 ? realizedPnlUsd / position.entryNotionalUsd * 100 : 0;
  const capture = position.maxFavorableExcursionPct > 0 && realizedReturnPct > 0 ? Math.min(100, realizedReturnPct / position.maxFavorableExcursionPct * 100) : 0;
  const takenProfitLabels = [...position.takenProfitLabels, level.label];
  const postTrim = { ...position, remainingQuantity, takenProfitLabels };
  const rawMovePct = position.entryPrice > 0 ? ((snapshot.price - position.entryPrice) / position.entryPrice) * 100 : 0;
  const winnerState = determineWinnerState(postTrim as ManagedPosition, rawMovePct, position.lastConfirmationScore ?? 0);
  await applyPaperFillToWallet({
    fill,
    decisionId: `${position.decisionId}-TP-${level.label}`,
    tokenAddress: position.tokenAddress,
    positionId: position.id,
    action: "TRIM",
    quantity: sellQty,
    remainingQuantityAfter: remainingQuantity,
    markPriceAfter: snapshot.price,
    entryNotionalAfterUsd: position.entryNotionalUsd,
    realizedCostAfterUsd: realizedCostUsd,
    positionRealizedPnlAfterUsd: realizedPnlUsd,
    nextTargetPrice: nextTargetPrice(position, takenProfitLabels),
    moonbagExitFloorPrice: moonbagExitFloorPrice({ ...position, highWaterPrice: Math.max(position.highWaterPrice, snapshot.price) }),
  });
  await appendFillJournal(fill, position.tokenAddress, position.id);
  return {
    ...position,
    remainingQuantity,
    remainingNotionalUsd: remainingQuantity * position.entryPrice,
    realizedProceedsUsd,
    realizedCostUsd,
    realizedPnlUsd,
    takenProfitLabels,
    winnerState,
    breakEvenArmed: true,
    pendingScaleLabel: undefined,
    updatedAt: new Date().toISOString(),
    lastAction: "TRIM",
    lastReason: `${level.label} filled: sold ${level.sellPct}% of scaled size @ ${fill.fillPrice}. ${position.exitStrategy.moonbagPct ?? 0}% target moonbag remains protected by adaptive Guardian rules.`,
    profitCapturePct: Number(capture.toFixed(2)),
    status: remainingQuantity <= position.quantity * 0.001 ? "closed" : "open",
  };
}

async function executeFullExit(position: ManagedPosition, snapshot: MarketSnapshot): Promise<ManagedPosition> {
  if (position.remainingQuantity <= 0) return { ...position, status: "closed" };
  const sellQty = position.remainingQuantity;
  const fill = await executePaper(paperRequest(position, "SELL", sellQty * snapshot.price, "EXIT"), snapshot);
  const cost = sellQty * position.entryPrice;
  const realizedProceedsUsd = position.realizedProceedsUsd + fill.filledUsd;
  const realizedCostUsd = position.realizedCostUsd + cost;
  const realizedPnlUsd = realizedProceedsUsd - realizedCostUsd;
  const realizedReturnPct = position.entryNotionalUsd > 0 ? realizedPnlUsd / position.entryNotionalUsd * 100 : 0;
  const capture = position.maxFavorableExcursionPct > 0 && realizedReturnPct > 0 ? Math.max(0, Math.min(100, realizedReturnPct / position.maxFavorableExcursionPct * 100)) : 0;
  await applyPaperFillToWallet({
    fill,
    decisionId: `${position.decisionId}-EXIT`,
    tokenAddress: position.tokenAddress,
    positionId: position.id,
    action: "EXIT",
    quantity: sellQty,
    remainingQuantityAfter: 0,
    markPriceAfter: snapshot.price,
    entryNotionalAfterUsd: position.entryNotionalUsd,
    realizedCostAfterUsd: realizedCostUsd,
    positionRealizedPnlAfterUsd: realizedPnlUsd,
  });
  await appendFillJournal(fill, position.tokenAddress, position.id);
  return {
    ...position,
    status: "closed",
    remainingQuantity: 0,
    remainingNotionalUsd: 0,
    realizedProceedsUsd,
    realizedCostUsd,
    realizedPnlUsd,
    pnlPct: Number(realizedReturnPct.toFixed(3)),
    profitCapturePct: Number(capture.toFixed(2)),
    closedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAction: "EXIT",
    pendingScaleLabel: undefined,
    lastReason: `${position.lastReason} Paper exit filled ${fill.filledUsd.toFixed(2)} USD @ ${fill.fillPrice}. Final return ${realizedReturnPct.toFixed(2)}%.`,
  };
}

const guardianGlobal = globalThis as typeof globalThis & {
  __botWarRoomGuardianTimer?: ReturnType<typeof setInterval>;
  __botWarRoomGuardianBusy?: boolean;
};

export function ensurePositionGuardianLoop() {
  if (guardianGlobal.__botWarRoomGuardianTimer) return;
  guardianGlobal.__botWarRoomGuardianTimer = setInterval(() => {
    void refreshPositionGuardian().catch((error) => console.error("[position-guardian] refresh failed", error));
  }, 5000);
}

export async function refreshPositionGuardian(): Promise<PositionGuardianReport> {
  if (guardianGlobal.__botWarRoomGuardianBusy) {
    const storage = await positionStorageMode();
    return { storage, openCount: 0, urgentCount: 0, positions: [], generatedAt: new Date().toISOString() };
  }
  guardianGlobal.__botWarRoomGuardianBusy = true;
  const positions = (await listManagedPositions()).filter((position) => position.status !== "closed").map(normalizedPosition);
  const refreshed: ManagedPosition[] = [];
  let staleCount = 0;
  try {
    for (const position of positions) {
      let next = position;
      const releaseLease = await acquireRuntimeLease(`guardian:${position.id}`, 120_000);
      if (!releaseLease) continue;
      try {
        const latest = (await listManagedPositions()).find((row) => row.id === position.id);
        if (!latest || latest.status === "closed") continue;
        next = normalizedPosition(latest);
        const snapshot = await fetchLivePositionSnapshot(next);
        if (snapshot) {
          const portfolio = await getPaperPortfolioContext(next.chain);
          const exitGenome = await getRunnerExitGuidance(next, snapshot);
          // A previously flagged exit must never become permanently pending. In
          // particular, emergency exits can be triggered by a sellability or
          // honeypot failure, so those conditions cannot block the follow-up
          // paper sell.
          if (next.status === "exit_pending" && next.mode === "paper") {
            next = await executeFullExit(next, snapshot);
          } else {
            next = evaluatePosition(next, snapshot, portfolio, exitGenome);
          }
          if (next.mode === "paper" && snapshot.sellable && !snapshot.honeypot) {
            if (next.lastAction === "SCALE_IN") {
              next = await executeScaleIn(next, snapshot, portfolio);
            } else if (next.lastAction === "TRIM") {
              const level = nextTakeProfit(next, ((snapshot.price - next.entryPrice) / Math.max(next.entryPrice, 1e-12)) * 100);
              if (level) next = await executeTrim(next, snapshot, level);
            } else if (next.lastAction === "EXIT" && next.remainingQuantity > 0) {
              next = await executeFullExit(next, snapshot);
            }
          }
          if (next.status === "closed" && !next.learningRecorded) {
            await reflectOnClosedPosition(next, snapshot);
            next = { ...next, learningRecorded: true };
          }
          await saveManagedPosition(next);
        } else {
          staleCount += 1;
        }
      } catch (error) {
        staleCount += 1;
        console.error(`[position-guardian] ${position.symbol}`, error);
      } finally {
        await releaseLease().catch(() => undefined);
      }
      refreshed.push(next);
    }

    const storage = await positionStorageMode();
    const activePositions = refreshed.filter((position) => position.status !== "closed");
    return {
      storage,
      openCount: activePositions.length,
      urgentCount: activePositions.filter((position) => position.lastAction === "EXIT").length,
      positions: activePositions.sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
      generatedAt: new Date().toISOString(),
      warning: storage === "memory"
        ? "REDIS_URL is not connected; position and learning memory will not survive a process restart."
        : staleCount
          ? `${staleCount} position(s) remain persisted but are waiting for a fresh market-data snapshot.`
          : undefined,
    };
  } finally {
    guardianGlobal.__botWarRoomGuardianBusy = false;
  }
}
