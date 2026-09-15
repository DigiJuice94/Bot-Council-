import { createClient } from "redis";
import { listManagedPositions } from "./position-store";
import { markProviderFailure, markProviderSuccess } from "./provider-health";
import type { Chain, PaperFill, PaperWalletFillRecord, PaperWalletSnapshot, PaperWalletState, PortfolioRiskContext } from "./types";

const REDIS_KEY = "bot-war-room:paper-wallet:v2-real-market";
const RESET_META_KEY = "bot-war-room:paper-wallet:v214:reset-meta";
const DEFAULT_STARTING_CASH_USD = 1_000;
const MAX_FILL_HISTORY = 250;

let redisPromise: Promise<any | null> | null = null;
let memoryState: PaperWalletState | null = null;
let memoryResetMeta: PaperWalletResetMeta | null = null;
let mutationLock: Promise<void> = Promise.resolve();

export type PaperWalletResetMeta = {
  resets: number;
  totalInjectedUsd: number;
  lastResetAt?: string;
  lastReason?: string;
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
    return { state: memoryState, storage: "memory" };
  }
  const raw = await redis.get(REDIS_KEY);
  if (!raw) {
    const state = freshState();
    await redis.set(REDIS_KEY, JSON.stringify(state));
    return { state, storage: "redis" };
  }
  try {
    return { state: JSON.parse(raw) as PaperWalletState, storage: "redis" };
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

async function calculateSnapshot(stateInput: PaperWalletState, storage: "redis" | "memory"): Promise<PaperWalletSnapshot> {
  let state = stateInput;
  const positions = await listManagedPositions();
  const open = positions.filter((position) => position.status !== "closed");
  const openExposureUsd = open.reduce((sum, position) => sum + Math.max(0, position.remainingQuantity * position.markPrice), 0);
  const unrealizedPnlUsd = open.reduce((sum, position) => {
    const remainingCost = Math.max(0, position.entryNotionalUsd - position.realizedCostUsd);
    return sum + (position.remainingQuantity * position.markPrice - remainingCost);
  }, 0);
  const realizedPnlUsd = positions.reduce((sum, position) => sum + (position.realizedPnlUsd || 0), 0);
  const equityUsd = Math.max(0, state.cashUsd + openExposureUsd);

  const today = dayKey();
  if (state.dayKey !== today) {
    state = { ...state, dayKey: today, dayStartEquityUsd: equityUsd, updatedAt: new Date().toISOString() };
    await writeState(state);
  }

  const totalPnlUsd = equityUsd - state.startingCashUsd;
  return {
    ...state,
    equityUsd: Number(equityUsd.toFixed(2)),
    openExposureUsd: Number(openExposureUsd.toFixed(2)),
    unrealizedPnlUsd: Number(unrealizedPnlUsd.toFixed(2)),
    realizedPnlUsd: Number(realizedPnlUsd.toFixed(2)),
    totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
    totalReturnPct: state.startingCashUsd > 0 ? Number((totalPnlUsd / state.startingCashUsd * 100).toFixed(3)) : 0,
    dailyPnlPct: state.dayStartEquityUsd > 0 ? Number(((equityUsd - state.dayStartEquityUsd) / state.dayStartEquityUsd * 100).toFixed(3)) : 0,
    openPositions: open.length,
    storage,
  };
}

export async function getPaperWallet(): Promise<PaperWalletSnapshot> {
  const { state, storage } = await readState();
  return calculateSnapshot(state, storage);
}

export async function getPaperWalletResetMeta(): Promise<PaperWalletResetMeta> {
  return readResetMeta();
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
  const threshold = Math.max(0, Number(process.env.PAPER_AUTO_REFILL_THRESHOLD_USD ?? 1));
  if (process.env.PAPER_AUTO_REFILL_ON_ZERO === "false" || wallet.openPositions > 0 || wallet.equityUsd > threshold) {
    return { wallet, resetPerformed: false, resetMeta };
  }

  let resetPerformed = false;
  const task = mutationLock.then(async () => {
    const { state: current, storage } = await readState();
    const snapshot = await calculateSnapshot(current, storage);
    if (snapshot.openPositions > 0 || snapshot.equityUsd > threshold) {
      wallet = snapshot;
      return;
    }
    const startingCashUsd = configuredStartingCash();
    const now = new Date().toISOString();
    const next: PaperWalletState = {
      ...current,
      startingCashUsd,
      cashUsd: startingCashUsd,
      dayKey: dayKey(),
      dayStartEquityUsd: startingCashUsd,
      updatedAt: now,
    };
    resetMeta = {
      resets: resetMeta.resets + 1,
      totalInjectedUsd: Number((resetMeta.totalInjectedUsd + startingCashUsd).toFixed(2)),
      lastResetAt: now,
      lastReason: `Research bankroll reached $${snapshot.equityUsd.toFixed(2)} with no open positions; automatically restarted at $${startingCashUsd.toFixed(2)}.`,
    };
    await writeState(next);
    await writeResetMeta(resetMeta);
    wallet = await calculateSnapshot(next, storage);
    resetPerformed = true;
  });
  mutationLock = task.catch(() => undefined);
  await task;
  return { wallet, resetPerformed, resetMeta };
}

export async function getPaperPortfolioContext(chain: Chain): Promise<PortfolioRiskContext> {
  const wallet = await getPaperWallet();
  const positions = (await listManagedPositions()).filter((position) => position.status !== "closed");
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
    maxDailyLossPct: Number(process.env.PAPER_MAX_DAILY_LOSS_PCT ?? 5),
    maxOpenPositions: Number(process.env.PAPER_MAX_OPEN_POSITIONS ?? 8),
    maxTotalExposurePct: Number(process.env.PAPER_MAX_TOTAL_EXPOSURE_PCT ?? 35),
    maxChainExposurePct: Number(process.env.PAPER_MAX_CHAIN_EXPOSURE_PCT ?? 15),
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

export async function applyPaperFillToWallet(args: { fill: PaperFill; decisionId: string; tokenAddress: string; positionId?: string }): Promise<PaperWalletSnapshot> {
  let out!: PaperWalletSnapshot;
  const task = mutationLock.then(async () => {
    const { state: current, storage } = await readState();
    const fill = args.fill;
    if (current.recentFills.some((row) => row.id === fill.id)) {
      out = await calculateSnapshot(current, storage);
      return;
    }
    const spendOrProceeds = fill.side === "BUY" ? fill.requestedUsd : fill.filledUsd;
    if (fill.side === "BUY" && spendOrProceeds > current.cashUsd + 0.005) {
      throw new Error(`Paper wallet cash check failed: $${current.cashUsd.toFixed(2)} available, $${spendOrProceeds.toFixed(2)} requested.`);
    }
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
      createdAt: fill.createdAt,
    };
    const next: PaperWalletState = {
      ...current,
      cashUsd: Number((fill.side === "BUY" ? current.cashUsd - fill.requestedUsd : current.cashUsd + fill.filledUsd).toFixed(2)),
      totalFeesUsd: Number((current.totalFeesUsd + fill.feeUsd).toFixed(4)),
      buyFills: current.buyFills + (fill.side === "BUY" ? 1 : 0),
      sellFills: current.sellFills + (fill.side === "SELL" ? 1 : 0),
      updatedAt: new Date().toISOString(),
      recentFills: [record, ...current.recentFills.filter((row) => row.id !== record.id)].slice(0, MAX_FILL_HISTORY),
    };
    await writeState(next);
    out = await calculateSnapshot(next, storage);
  });
  mutationLock = task.catch(() => undefined);
  await task;
  return out;
}

export async function paperWalletStorageMode(): Promise<"redis" | "memory"> {
  return (await getRedis()) ? "redis" : "memory";
}
