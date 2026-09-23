import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePaperWalletState, reconstructPortfolio } from "../lib/paper-accounting";
import { markOverduePositionExitPending } from "../lib/position-lifecycle";
import type { ManagedPosition, PaperWalletFillRecord, PaperWalletState } from "../lib/types";

function fill(id: string, side: "BUY" | "SELL", amount: number, routeVerified = true): PaperWalletFillRecord {
  return {
    id, decisionId: "D", chain: "Solana", tokenAddress: "TOKEN", symbol: "$T", side,
    requestedUsd: amount, filledUsd: amount, fillPrice: 1, feeUsd: 0, slippageBps: 0,
    routeVerified, createdAt: new Date(1_700_000_000_000 + Number(id.replace(/\D/g, "") || 0)).toISOString(),
  };
}

function state(fills: PaperWalletFillRecord[], cashUsd = 1_000): PaperWalletState {
  return {
    version: 1, startingCashUsd: 1_000, cashUsd, totalFeesUsd: 0,
    buyFills: fills.filter((row) => row.side === "BUY").length,
    sellFills: fills.filter((row) => row.side === "SELL").length,
    startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    dayKey: "2026-01-01", dayStartEquityUsd: 1_000, recentFills: fills,
  };
}

function position(overrides: Partial<ManagedPosition>): ManagedPosition {
  return {
    id: "P", chain: "Solana", tokenAddress: "TOKEN", symbol: "$T", strategyId: "S", decisionId: "D",
    mode: "paper", status: "open", quantity: 10, remainingQuantity: 10, entryPrice: 1, markPrice: 1,
    highWaterPrice: 1, lowWaterPrice: 1, entryNotionalUsd: 10, remainingNotionalUsd: 10,
    realizedProceedsUsd: 0, realizedCostUsd: 0, realizedPnlUsd: 0, pnlPct: 0,
    maxFavorableExcursionPct: 0, maxAdverseExcursionPct: 0, profitCapturePct: 0,
    openedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    lastAction: "HOLD", lastReason: "", takenProfitLabels: [],
    exitStrategy: { stopLossPct: 20, trailingStopPct: 10, liquidityFloorUsd: 1, takeProfits: [] },
    ...overrides,
  } as ManagedPosition;
}

test("sub-cent proceeds reconcile once at ledger precision", () => {
  const fills = Array.from({ length: 151 }, (_, index) => fill(`S${index}`, "SELL", 0.0049));
  const first = reconcilePaperWalletState(state(fills));
  assert.equal(first.state.cashUsd, 1000.7399);
  assert.equal(Number(first.state.cashUsd.toFixed(2)), 1000.74);
  assert.equal(first.ledgerComplete, true);
  assert.equal(reconcilePaperWalletState(first.state).changed, false);
});

test("unverified and duplicate SELL evidence cannot credit cash", () => {
  const rows = [fill("S1", "SELL", 50, false), fill("S1", "SELL", 50, true)];
  const input = state(rows, 1_050);
  input.sellFills = 2;
  const result = reconcilePaperWalletState(input);
  assert.equal(result.state.cashUsd, 1_000);
  assert.equal(result.state.sellFills, 0);
  assert.equal(result.state.recentFills.length, 1);
});

test("open, closed and unsellable lifecycle states are counted once", () => {
  const wallet = state([]);
  const olderOpen = position({ id: "same", status: "open", remainingQuantity: 10, markPrice: 2, updatedAt: "2026-01-01T00:00:00.000Z" });
  const latestLocked = position({ id: "same", status: "unsellable", remainingQuantity: 10, markPrice: 999, lockedCapitalLossUsd: 10, updatedAt: "2026-01-01T00:01:00.000Z" });
  const active = position({ id: "active", remainingQuantity: 5, markPrice: 3, entryNotionalUsd: 10 });
  const totals = reconstructPortfolio(wallet, [olderOpen, latestLocked, active]);
  assert.equal(totals.openExposureUsd, 15);
  assert.equal(totals.equityUsd, 1_015);
  assert.equal(totals.lockedCapitalLossUsd, 10);
  assert.equal(totals.active.length, 1);
});

test("JSON restart reconstructs exactly the same totals", () => {
  const wallet = reconcilePaperWalletState(state([fill("B1", "BUY", 50), fill("S1", "SELL", 53.0049)], 1_003)).state;
  const positions = [position({ id: "closed", status: "closed", remainingQuantity: 0 })];
  const before = reconstructPortfolio(wallet, positions);
  const after = reconstructPortfolio(JSON.parse(JSON.stringify(wallet)), JSON.parse(JSON.stringify(positions)));
  assert.deepEqual(after, before);
});

test("20-minute deadline becomes pending without fabricating a fill", () => {
  const now = Date.parse("2026-01-01T00:21:00.000Z");
  const overdue = markOverduePositionExitPending(position({ openedAt: "2026-01-01T00:00:00.000Z" }), now);
  assert.equal(overdue.status, "exit_pending");
  assert.equal(overdue.lastAction, "EXIT");
  assert.equal(overdue.realizedProceedsUsd, 0);
  const fresh = markOverduePositionExitPending(position({ openedAt: "2026-01-01T00:02:00.000Z" }), now);
  assert.equal(fresh.status, "open");
});
