import { createClient } from "redis";
import { acquireRuntimeLease, listManagedPositions, removeManagedPosition } from "./position-store";
import { markProviderFailure, markProviderSuccess } from "./provider-health";
import { isCreditedPaperFill, ledgerAmount, reconcilePaperWalletState, reconstructPortfolio, uniqueManagedPositions } from "./paper-accounting";
import type { Chain, PaperFill, PaperWalletFillRecord, PaperWalletSnapshot, PaperWalletState, PortfolioRiskContext } from "./types";

const REDIS_KEY = "bot-war-room:paper-wallet:v2-real-market";
const RESET_META_KEY = "bot-war-room:paper-wallet:v214:reset-meta";
const DEFAULT_STARTING_CASH_USD = 1_000;
const MAX_FILL_HISTORY = 5_000;
const MAX_EQUITY_HISTORY = 100_000;
const EQUITY_HISTORY_INTERVAL_MS = 10 * 60_000;
const EQUITY_HISTORY_SIGNIFICANT_MOVE_PCT = 0.5;

let redisPromise: Promise<any | null> | null = null;
let memoryState: PaperWalletState | null = null;
let memoryResetMeta: PaperWalletResetMeta | null = null;
let mutationLock: Promise<void> = Promise.resolve();

async function acquireWalletLedgerLease() {
  const deadline = Date.now() + 10_000;
  do {
    const release = await acquireRuntimeLease("paper-wallet-ledger", 120_000);
    if (release) return release;
    await new Promise((resolve) => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  throw new Error("Verified PAPER ledger is busy; refusing an unverified wallet mutation.");
}

export type PaperWalletResetMeta = {
  resets: number;
  totalInjectedUsd: number;
  lastResetAt?: string;
  lastReason?: string;
  completedFreshStartReleases?: string[];
};

function configuredStartingCash() {
  const raw = Number(process.env.PAPER_STARTING_CASH_USD ?? DEFAULT_STARTING_CASH_USD);
  return Number.isFinite(raw) && raw > 0 ? Number(raw.toFixed(2)) : DEFAULT_STARTING_CASH_USD;
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function freshState(): PaperWalletState {
  const now = new Date().toISOString();
  const startingCashUsd = configuredStartingCash();
  return {
    version: 1,
    startingCashUsd,
    cashUsd: startingCashUsd,
    totalFeesUsd: 0,
    buyFills: 0,
    sellFills: 0,
    startedAt: now,
    updatedAt: now,
    dayKey: dayKey(),
    dayStartEquityUsd: startingCashUsd,
    capitalContributionsUsd: 0,
    equityHistory: [{ at: Date.parse(now), equity: startingCashUsd, cash: startingCashUsd, openValue: 0, event: "mark" }],
    allTimeHighEquityUsd: startingCashUsd,
    allTimeHighAt: now,
    allTimeLowEquityUsd: startingCashUsd,
    allTimeLowAt: now,
    recentFills: [],
  };
}

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[paper-wallet] redis", error));
        await client.connect();
        markProviderSuccess("redis");
        return client;
      } catch (error) {
        markProviderFailure("redis", error);
        console.error("[paper-wallet] redis unavailable; using memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

async function readState(): Promise<{ state: PaperWalletState; storage: "redis" | "memory" }> {
  const redis = await getRedis();
  if (!redis) {
    if (!memoryState) memoryState = freshState();
    const reconciled = reconcilePaperWalletState(memoryState);
    if (reconciled.changed) memoryState = reconciled.state;
    return { state: memoryState, storage: "memory" };
  }
  const raw = await redis.get(REDIS_KEY);
  if (!raw) {
    const state = freshState();
    await redis.set(REDIS_KEY, JSON.stringify(state));
    return { state, storage: "redis" };
  }
  try {
    const parsed = JSON.parse(raw) as PaperWalletState;
    const reconciled = reconcilePaperWalletState(parsed);
    if (reconciled.changed) await redis.set(REDIS_KEY, JSON.stringify(reconciled.state));
    memoryState = reconciled.state;
    return { state: reconciled.state, storage: "redis" };
  } catch {
    const state = freshState();
    await redis.set(REDIS_KEY, JSON.stringify(state));
    return { state, storage: "redis" };
  }
}

async function writeState(state: PaperWalletState): Promise<void> {
  memoryState = state;
  const redis = await getRedis();
  if (redis) await redis.set(REDIS_KEY, JSON.stringify(state));
}

async function readResetMeta(): Promise<PaperWalletResetMeta> {
  const redis = await getRedis();
  if (!redis) return memoryResetMeta ??= { resets: 0, totalInjectedUsd: 0 };
  const raw = await redis.get(RESET_META_KEY);
  if (!raw) return { resets: 0, totalInjectedUsd: 0 };
  try { return JSON.parse(raw) as PaperWalletResetMeta; } catch { return { resets: 0, totalInjectedUsd: 0 }; }
}

async function writeResetMeta(meta: PaperWalletResetMeta) {
  memoryResetMeta = meta;
  const redis = await getRedis();
  if (redis) await redis.set(RESET_META_KEY, JSON.stringify(meta));
}

function updatePersistentEquityHistory(state: PaperWalletState, equityUsd: number, openExposureUsd: number) {
  const nowMs = Date.now();
  const history = state.equityHistory ?? [];
  const last = history[history.length - 1];
  const previousHigh = state.allTimeHighEquityUsd ?? state.startingCashUsd;
  const previousLow = state.allTimeLowEquityUsd ?? state.startingCashUsd;
  const newHigh = equityUsd > previousHigh + 0.005;
  const newLow = equityUsd < previousLow - 0.005;
  const elapsed = last ? nowMs - last.at : Number.POSITIVE_INFINITY;
  const movePct = last && last.equity > 0 ? Math.abs(equityUsd - last.equity) / last.equity * 100 : 100;
  const shouldRecord = !last || elapsed >= EQUITY_HISTORY_INTERVAL_MS || movePct >= EQUITY_HISTORY_SIGNIFICANT_MOVE_PCT || newHigh || newLow;
  if (!shouldRecord) return { state, changed: false };

  const event = newHigh ? "peak" as const : newLow ? "low" as const : "mark" as const;
  const point = {
    at: nowMs,
    equity: Number(equityUsd.toFixed(2)),
    cash: Number(state.cashUsd.toFixed(2)),
    openValue: Number(openExposureUsd.toFixed(2)),
    event,
  };
  return {
    changed: true,
    state: {
      ...state,
      equityHistory: [...history, point].slice(-MAX_EQUITY_HISTORY),
      allTimeHighEquityUsd: Number(Math.max(previousHigh, equityUsd).toFixed(2)),
      allTimeHighAt: newHigh ? new Date(nowMs).toISOString() : state.allTimeHighAt,
      allTimeLowEquityUsd: Number(Math.min(previousLow, equityUsd).toFixed(2)),
      allTimeLowAt: newLow ? new Date(nowMs).toISOString() : state.allTimeLowAt,
    },
  };
}

async function calculateSnapshot(
  stateInput: PaperWalletState,
  storage: "redis" | "memory",
  positionOverride?: {
    id: string;
    remainingQuantity: number;
    markPrice: number;
    status: "open" | "closed";
    entryNotionalUsd?: number;
    realizedCostUsd?: number;
  },
): Promise<PaperWalletSnapshot> {
  let state = stateInput;
  const storedPositions = await listManagedPositions();
  const positions = uniqueManagedPositions(positionOverride
    ? storedPositions.map((position) => position.id === positionOverride.id ? { ...position, ...positionOverride } : position)
    : storedPositions);
  const accounting = reconstructPortfolio(state, positions);
  const open = accounting.active;
  const unsellable = accounting.unsellable;
  const cents = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));
  const cashUsd = accounting.cashUsd;
  const openExposureUsd = accounting.openExposureUsd;
  const openCostUsd = accounting.openCostUsd;
  const unrealizedPnlUsd = accounting.unrealizedPnlUsd;
  const equityUsd = accounting.equityUsd;
  const capitalContributionsUsd = cents(Math.max(0, state.capitalContributionsUsd ?? 0));
  const totalPnlUsd = accounting.totalPnlUsd;

  // Portfolio Auditor: realized profit is the balancing figure from the actual
  // wallet cash and all open cost/value. This keeps the four accounting
  // identities exact even when the UI only receives a limited trade list.
  // Per-position realized values remain useful trade analytics, but can never
  // again be used as the top-level wallet total.
  const realizedPnlUsd = accounting.realizedPnlUsd;
  const modeledSells = state.recentFills.filter((fill) => fill.side === "SELL" && fill.sellExecutionKind === "liquidity_model" && isCreditedPaperFill(fill));
  const historyUpdate = updatePersistentEquityHistory(state, equityUsd, openExposureUsd);
  state = historyUpdate.state;

  const today = dayKey();
  if (state.dayKey !== today) {
    state = { ...state, dayKey: today, dayStartEquityUsd: equityUsd, updatedAt: new Date().toISOString() };
    await writeState(state);
  } else if (historyUpdate.changed) {
    await writeState(state);
  }

  return {
    ...state,
    cashUsd,
    capitalContributionsUsd,
    equityUsd,
    openExposureUsd,
    openCostUsd,
    unrealizedPnlUsd,
    realizedPnlUsd,
    recentModeledSellCount: modeledSells.length,
    recentModeledSellProceedsUsd: cents(modeledSells.reduce((sum, fill) => sum + fill.filledUsd, 0)),
    totalPnlUsd,
    totalReturnPct: state.startingCashUsd + capitalContributionsUsd > 0
      ? Number((totalPnlUsd / (state.startingCashUsd + capitalContributionsUsd) * 100).toFixed(3))
      : 0,
    dailyPnlPct: state.dayStartEquityUsd > 0 ? Number(((equityUsd - state.dayStartEquityUsd) / state.dayStartEquityUsd * 100).toFixed(3)) : 0,
    openPositions: open.length,
    unsellablePositions: unsellable.length,
    lockedCapitalLossUsd: accounting.lockedCapitalLossUsd,
    unverifiedReservedCostUsd: accounting.unverifiedReservedCostUsd,
    storage,
    accountingVerified: true,
    accountingVerifiedAt: new Date().toISOString(),
  };
}

export async function getPaperWallet(): Promise<PaperWalletSnapshot> {
  // Snapshot calculation can persist equity history. Queue it with mutations
  // so a read begun before reset cannot write the old bankroll back afterward.
  const task = mutationLock.then(async () => {
    const releaseLease = await acquireWalletLedgerLease();
    try {
      const { state, storage } = await readState();
      return calculateSnapshot(state, storage);
    } finally {
      await releaseLease().catch(() => undefined);
    }
  });
  mutationLock = task.then(() => undefined, () => undefined);
  return task;
}

export async function getPaperWalletResetMeta(): Promise<PaperWalletResetMeta> {
  return readResetMeta();
}

export async function resetPaperWalletPreserveLearning(reason = "Manual dashboard reset", onceRelease?: string): Promise<{
  wallet: PaperWalletSnapshot;
  resetMeta: PaperWalletResetMeta;
  clearedOpenPositions: number;
}> {
  let wallet!: PaperWalletSnapshot;
  let resetMeta!: PaperWalletResetMeta;
  let clearedOpenPositions = 0;

  const task = mutationLock.then(async () => {
    const releaseLease = await acquireWalletLedgerLease();
    try {
    if (onceRelease && process.env.REDIS_URL && !(await getRedis())) {
      throw new Error("Cannot perform release wallet reset without the configured Redis connection.");
    }
    const existingMeta = await readResetMeta();
    if (onceRelease && existingMeta.completedFreshStartReleases?.includes(onceRelease)) {
      const { state, storage } = await readState();
      wallet = await calculateSnapshot(state, storage);
      resetMeta = existingMeta;
      return;
    }
    const { state: current, storage } = await readState();
    const positions = await listManagedPositions();
    const paperPositions = positions.filter((position) => position.mode === "paper");
    const open = paperPositions.filter((position) => position.status === "open" || position.status === "exit_pending");
    const openValue = open.reduce(
      (sum, position) => sum + Math.max(0, position.remainingQuantity * position.markPrice),
      0,
    );
    const preResetEquity = Math.max(0, current.cashUsd + openValue);

    // A fresh run clears the PAPER trade log and all PAPER positions. Nothing
    // is converted into a synthetic win/loss. Research stores are separate
    // and remain untouched.
    for (const position of paperPositions) {
      await removeManagedPosition(position.id);
      clearedOpenPositions += 1;
    }

    const startingCashUsd = configuredStartingCash();
    const now = new Date().toISOString();
    const nowMs = Date.parse(now);
    const resetPoint = {
      at: nowMs,
      equity: Number(startingCashUsd.toFixed(2)),
      cash: Number(startingCashUsd.toFixed(2)),
      openValue: 0,
      event: "reset" as const,
    };

    const next: PaperWalletState = {
      ...current,
      startingCashUsd,
      cashUsd: startingCashUsd,
      dayKey: dayKey(),
      dayStartEquityUsd: startingCashUsd,
      capitalContributionsUsd: 0,
      updatedAt: now,
      startedAt: now,
      equityHistory: [resetPoint],
      allTimeHighEquityUsd: startingCashUsd,
      allTimeHighAt: now,
      allTimeLowEquityUsd: startingCashUsd,
      allTimeLowAt: now,
      totalFeesUsd: 0,
      buyFills: 0,
      sellFills: 0,
      recentFills: [],
    };

    await writeState(next);

    resetMeta = await readResetMeta();
    resetMeta = {
      ...resetMeta,
      resets: resetMeta.resets + 1,
      totalInjectedUsd: Number((resetMeta.totalInjectedUsd + startingCashUsd).toFixed(2)),
      lastResetAt: now,
      lastReason: `${reason}. Started a fresh PAPER run at ${startingCashUsd.toFixed(2)} and cleared ${clearedOpenPositions} PAPER position(s), fills and portfolio history; learned research preserved.`,
      completedFreshStartReleases: onceRelease
        ? [...(resetMeta.completedFreshStartReleases ?? []), onceRelease]
        : resetMeta.completedFreshStartReleases,
    };
    await writeResetMeta(resetMeta);

    wallet = await calculateSnapshot(next, storage);
    } finally {
      await releaseLease().catch(() => undefined);
    }
  });

  mutationLock = task.catch(() => undefined);
  await task;
  return { wallet, resetMeta, clearedOpenPositions };
}

/**
 * Research must not stop just because an experimental paper bankroll went bust.
 * Refill only when no position is still open, so an empty cash balance caused by
 * deployed capital is never mistaken for bankruptcy. Fill history is preserved.
 */
export async function ensurePaperWalletResearchFunds(): Promise<{
  wallet: PaperWalletSnapshot;
  resetPerformed: boolean;
  resetMeta: PaperWalletResetMeta;
}> {
  let wallet = await getPaperWallet();
  let resetMeta = await readResetMeta();
  const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
  const threshold = Math.max(trainingTradeUsd, Number(process.env.PAPER_AUTO_REFILL_THRESHOLD_USD ?? trainingTradeUsd));
  // Hidden bankroll injections make performance impossible to measure. They are
  // now opt-in only; normal capital recycling belongs to the Exit Strategist.
  if (process.env.PAPER_AUTO_REFILL_ON_ZERO !== "true" || wallet.openPositions > 0 || wallet.equityUsd > threshold) {
    return { wallet, resetPerformed: false, resetMeta };
  }

  let resetPerformed = false;
  const task = mutationLock.then(async () => {
    const releaseLease = await acquireWalletLedgerLease();
    try {
    const { state: current, storage } = await readState();
    const snapshot = await calculateSnapshot(current, storage);
    if (snapshot.openPositions > 0 || snapshot.equityUsd > threshold) {
      wallet = snapshot;
      return;
    }
    const startingCashUsd = configuredStartingCash();
    const injectedUsd = Math.max(0, startingCashUsd - current.cashUsd);
    const now = new Date().toISOString();
    const next: PaperWalletState = {
      ...current,
      startingCashUsd,
      cashUsd: startingCashUsd,
      capitalContributionsUsd: Number(((current.capitalContributionsUsd ?? 0) + injectedUsd).toFixed(2)),
      dayKey: dayKey(),
      dayStartEquityUsd: startingCashUsd,
      updatedAt: now,
    };
    resetMeta = {
      ...resetMeta,
      resets: resetMeta.resets + 1,
      totalInjectedUsd: Number((resetMeta.totalInjectedUsd + startingCashUsd).toFixed(2)),
      lastResetAt: now,
      lastReason: `Research bankroll reached $${snapshot.equityUsd.toFixed(2)} with no open positions; automatically restarted at $${startingCashUsd.toFixed(2)}.`,
    };
    await writeState(next);
    await writeResetMeta(resetMeta);
    wallet = await calculateSnapshot(next, storage);
    resetPerformed = true;
    } finally {
      await releaseLease().catch(() => undefined);
    }
  });
  mutationLock = task.catch(() => undefined);
  await task;
  return { wallet, resetPerformed, resetMeta };
}

export async function getPaperPortfolioContext(chain: Chain): Promise<PortfolioRiskContext> {
  const wallet = await getPaperWallet();
  const positions = (await listManagedPositions()).filter((position) => position.status === "open" || position.status === "exit_pending");
  const chainExposureUsd = positions
    .filter((position) => position.chain === chain)
    .reduce((sum, position) => sum + Math.max(0, position.remainingQuantity * position.markPrice), 0);
  const equity = Math.max(wallet.equityUsd, 0.01);
  return {
    equityUsd: wallet.equityUsd,
    cashUsd: wallet.cashUsd,
    dailyPnlPct: wallet.dailyPnlPct,
    openPositions: wallet.openPositions,
    totalExposurePct: wallet.openExposureUsd / equity * 100,
    chainExposurePct: chainExposureUsd / equity * 100,
    strategyExposurePct: wallet.openExposureUsd / equity * 100,
    maxDailyLossPct: Number(process.env.PAPER_MAX_DAILY_LOSS_PCT ?? 10000),
    maxOpenPositions: Number(process.env.PAPER_MAX_OPEN_POSITIONS ?? 10000),
    maxTotalExposurePct: Number(process.env.PAPER_MAX_TOTAL_EXPOSURE_PCT ?? 10000),
    maxChainExposurePct: Number(process.env.PAPER_MAX_CHAIN_EXPOSURE_PCT ?? 10000),
    liveTradingEnabled: false,
  };
}

export async function canAffordPaperBuy(requestedUsd: number): Promise<{ allowed: boolean; availableUsd: number; reason?: string }> {
  const wallet = await getPaperWallet();
  const availableUsd = Math.max(0, wallet.cashUsd);
  if (requestedUsd <= 0) return { allowed: false, availableUsd, reason: "Paper order has zero requested notional." };
  if (requestedUsd > availableUsd + 0.005) return { allowed: false, availableUsd, reason: `Paper wallet has $${availableUsd.toFixed(2)} cash, below the $${requestedUsd.toFixed(2)} requested buy.` };
  return { allowed: true, availableUsd };
}

export async function applyPaperFillToWallet(args: {
  fill: PaperFill;
  decisionId: string;
  tokenAddress: string;
  positionId?: string;
  action?: "ENTRY" | "SCALE_IN" | "TRIM" | "EXIT";
  quantity?: number;
  remainingQuantityAfter?: number;
  markPriceAfter?: number;
  entryNotionalAfterUsd?: number;
  realizedCostAfterUsd?: number;
  positionRealizedPnlAfterUsd?: number;
  nextTargetPrice?: number;
}): Promise<PaperWalletSnapshot> {
  let out!: PaperWalletSnapshot;
  const task = mutationLock.then(async () => {
    const releaseLease = await acquireWalletLedgerLease();
    try {
    const { state: current, storage } = await readState();
    const fill = args.fill;
    if (current.recentFills.some((row) => row.id === fill.id)) {
      out = await calculateSnapshot(current, storage);
      return;
    }
    if (fill.side === "SELL" && !isCreditedPaperFill({ ...fill, decisionId: args.decisionId, tokenAddress: args.tokenAddress })) {
      throw new Error("Paper wallet refused SELL proceeds without verified route or explicit PAPER liquidity-model evidence.");
    }
    const spendOrProceeds = fill.side === "BUY" ? fill.requestedUsd : fill.filledUsd;
    if (fill.side === "BUY" && spendOrProceeds > current.cashUsd + 0.005) {
      throw new Error(`Paper wallet cash check failed: $${current.cashUsd.toFixed(2)} available, $${spendOrProceeds.toFixed(2)} requested.`);
    }
    const nextCashUsd = ledgerAmount(fill.side === "BUY" ? current.cashUsd - fill.requestedUsd : current.cashUsd + fill.filledUsd);
    const positions = await listManagedPositions();
    const currentPosition = args.positionId ? positions.find((position) => position.id === args.positionId) : undefined;
    const openExposureBefore = positions
      .filter((position) => position.status === "open" || position.status === "exit_pending")
      .reduce((sum, position) => sum + Math.max(0, position.remainingQuantity * position.markPrice), 0);
    const currentPositionExposure = currentPosition && (currentPosition.status === "open" || currentPosition.status === "exit_pending")
      ? Math.max(0, currentPosition.remainingQuantity * currentPosition.markPrice)
      : 0;
    const adjustedPositionExposure = typeof args.remainingQuantityAfter === "number"
      ? Math.max(0, args.remainingQuantityAfter * Math.max(0, args.markPriceAfter ?? currentPosition?.markPrice ?? fill.fillPrice))
      : currentPositionExposure;
    const portfolioEquityAfterUsd = Number((nextCashUsd + Math.max(0, openExposureBefore - currentPositionExposure + adjustedPositionExposure)).toFixed(2));
    const record: PaperWalletFillRecord = {
      id: fill.id,
      positionId: args.positionId,
      decisionId: args.decisionId,
      chain: fill.chain,
      tokenAddress: args.tokenAddress,
      symbol: fill.symbol,
      side: fill.side,
      requestedUsd: fill.requestedUsd,
      filledUsd: fill.filledUsd,
      fillPrice: fill.fillPrice,
      feeUsd: fill.feeUsd,
      slippageBps: fill.slippageBps,
      routeVerified: fill.routeVerified,
      sellExecutionKind: fill.sellExecutionKind,
      observedLiquidityUsd: fill.observedLiquidityUsd,
      liquidityObservedAt: fill.liquidityObservedAt,
      routeProvider: fill.routeProvider,
      routeNote: fill.routeNote,
      createdAt: fill.createdAt,
      action: args.action,
      quantity: args.quantity,
      remainingQuantityAfter: args.remainingQuantityAfter,
      cashAfterUsd: nextCashUsd,
      portfolioEquityAfterUsd,
      positionRealizedPnlAfterUsd: args.positionRealizedPnlAfterUsd,
      nextTargetPrice: args.nextTargetPrice,
    };
    const next: PaperWalletState = {
      ...current,
      cashUsd: nextCashUsd,
      totalFeesUsd: Number((current.totalFeesUsd + fill.feeUsd).toFixed(4)),
      buyFills: current.buyFills + (fill.side === "BUY" ? 1 : 0),
      sellFills: current.sellFills + (fill.side === "SELL" ? 1 : 0),
      updatedAt: new Date().toISOString(),
      recentFills: [record, ...current.recentFills.filter((row) => row.id !== record.id)].slice(0, MAX_FILL_HISTORY),
    };
    await writeState(next);
    out = await calculateSnapshot(next, storage, args.positionId && typeof args.remainingQuantityAfter === "number" ? {
      id: args.positionId,
      remainingQuantity: args.remainingQuantityAfter,
      markPrice: Math.max(0, args.markPriceAfter ?? currentPosition?.markPrice ?? fill.fillPrice),
      status: args.remainingQuantityAfter > 0 ? "open" : "closed",
      entryNotionalUsd: args.entryNotionalAfterUsd ?? currentPosition?.entryNotionalUsd ?? 0,
      realizedCostUsd: args.realizedCostAfterUsd ?? currentPosition?.realizedCostUsd ?? 0,
    } : undefined);
    } finally {
      await releaseLease().catch(() => undefined);
    }
  });
  mutationLock = task.catch(() => undefined);
  await task;
  return out;
}

export async function paperWalletStorageMode(): Promise<"redis" | "memory"> {
  return (await getRedis()) ? "redis" : "memory";
}
