import test from "node:test";
import assert from "node:assert/strict";
import { isCreditedPaperFill, reconcilePaperWalletState, reconstructPortfolio } from "../lib/paper-accounting";
import { markOverduePositionExitPending, parkUnverifiedExit } from "../lib/position-lifecycle";
import { isFreshVerifiedSellProof } from "../lib/sell-execution-proof";
import { executePaper } from "../lib/execution";
import { auditSellQuantity } from "../lib/sellability-auditor";
import type { ExecutionRequest, ManagedPosition, MarketSnapshot, PaperWalletFillRecord, PaperWalletState } from "../lib/types";

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

test("unverified exit frees the active slot without a fake sale or realized profit", () => {
  const now = Date.parse("2026-01-01T00:22:01.000Z");
  const pending = markOverduePositionExitPending(position({ openedAt: "2026-01-01T00:00:00.000Z" }), Date.parse("2026-01-01T00:20:00.000Z"));
  assert.equal(parkUnverifiedExit(pending, Date.parse("2026-01-01T00:20:00.000Z")).status, "exit_unverified");
  const early = { ...pending, exitPendingAt: "2026-01-01T00:06:00.000Z" };
  assert.equal(parkUnverifiedExit(early, Date.parse("2026-01-01T00:07:59.000Z")).status, "exit_pending");
  assert.equal(parkUnverifiedExit(early, Date.parse("2026-01-01T00:08:00.000Z")).status, "exit_unverified");
  const parked = parkUnverifiedExit(pending, now);
  assert.equal(parked.status, "exit_unverified");
  assert.equal(parked.remainingQuantity, 10);
  assert.equal(parked.realizedProceedsUsd, 0);
  assert.equal(parked.realizedPnlUsd, 0);
  const totals = reconstructPortfolio(state([fill("B1", "BUY", 10)], 990), [parked]);
  assert.equal(totals.cashUsd, 990);
  assert.equal(totals.equityUsd, 990);
  assert.equal(totals.openExposureUsd, 0);
  assert.equal(totals.realizedPnlUsd, 0);
  assert.equal(totals.unrealizedPnlUsd, -10);
  assert.equal(totals.lockedCapitalLossUsd, 10);
  assert.equal(totals.active.length, 0);
  assert.deepEqual(reconstructPortfolio(JSON.parse(JSON.stringify(state([fill("B1", "BUY", 10)]))), JSON.parse(JSON.stringify([parked]))), totals);
  const recovered = { ...parked, status: "closed" as const, remainingQuantity: 0, realizedProceedsUsd: 12,
    realizedCostUsd: 10, realizedPnlUsd: 2 };
  const afterRecovery = reconstructPortfolio(state([fill("B1", "BUY", 10), fill("S1", "SELL", 12)]), [recovered]);
  assert.equal(afterRecovery.equityUsd, 1002);
  assert.equal(afterRecovery.realizedPnlUsd, 2);
  assert.equal(afterRecovery.lockedCapitalLossUsd, 0);
});

test("only one fresh PASS audit can authorize paper proceeds", () => {
  const now = Date.parse("2026-01-01T00:01:00.000Z");
  const pass = { status: "pass" as const, provider: "jupiter" as const, checkedAt: "2026-01-01T00:00:30.000Z", routeVerified: true, reason: "route" };
  assert.equal(isFreshVerifiedSellProof(pass, now), true);
  assert.equal(isFreshVerifiedSellProof({ ...pass, status: "unknown", routeVerified: false }, now), false);
  assert.equal(isFreshVerifiedSellProof({ ...pass, checkedAt: "2025-12-31T23:59:00.000Z" }, now), false);
});

test("BUY remains possible with valid liquidity when no reverse-route API is configured", async () => {
  const snapshot = { chain: "Robinhood Chain", chainFamily: "evm", tokenAddress: "TOKEN", symbol: "T", liquidity: 100_000, price: 1, volatility: 0 } as MarketSnapshot;
  const request: ExecutionRequest = { mode: "paper", chain: "Robinhood Chain", tokenAddress: "TOKEN", symbol: "T", side: "BUY", notionalUsd: 50, maxSlippageBps: 90, strategyId: "S", decisionId: "D" };
  const trade = await executePaper(request, snapshot);
  assert.equal(trade.side, "BUY");
  assert.equal(trade.routeVerified, false);
  assert.ok(trade.filledUsd > 0);
});

test("zero liquidity remains an absolute BUY rejection", async () => {
  const snapshot = { chain: "Robinhood Chain", chainFamily: "evm", tokenAddress: "TOKEN", symbol: "T", liquidity: 0, price: 1, volatility: 0 } as MarketSnapshot;
  const request: ExecutionRequest = { mode: "paper", chain: "Robinhood Chain", tokenAddress: "TOKEN", symbol: "T", side: "BUY", notionalUsd: 50, maxSlippageBps: 90, strategyId: "S", decisionId: "D" };
  await assert.rejects(executePaper(request, snapshot), /zero executable liquidity/);
});

test("live liquidity settles an UNKNOWN full PAPER exit as modeled, never route verified", async () => {
  const now = new Date().toISOString();
  const snapshot = { chain: "Robinhood Chain", chainFamily: "evm", tokenAddress: "0x1111111111111111111111111111111111111111",
    symbol: "T", liquidity: 100, price: 1, volatility: 0,
    dataProvenance: { live: true, fetchedAt: now } } as MarketSnapshot;
  const request: ExecutionRequest = { mode: "paper", chain: "Robinhood Chain", tokenAddress: snapshot.tokenAddress,
    symbol: "T", side: "SELL", notionalUsd: 200, maxSlippageBps: 9000, strategyId: "S", decisionId: "D-EXIT" };
  const unknown = { status: "unknown" as const, provider: "unsupported" as const, checkedAt: now,
    routeVerified: false, reason: "No route provider" };
  const modeled = await executePaper(request, snapshot, unknown);
  assert.equal(modeled.routeVerified, false);
  assert.equal(modeled.sellExecutionKind, "liquidity_model");
  assert.ok(modeled.filledUsd > 0 && modeled.filledUsd <= 50);
  const record = { ...modeled, tokenAddress: snapshot.tokenAddress, decisionId: "D", quantity: 200 };
  assert.equal(isCreditedPaperFill(record), true);
  const ledger = reconcilePaperWalletState(state([fill("B1", "BUY", 200), record]));
  assert.equal(ledger.state.cashUsd, Number((800 + modeled.filledUsd).toFixed(6)));
  assert.equal(reconcilePaperWalletState(JSON.parse(JSON.stringify(ledger.state))).state.cashUsd, ledger.state.cashUsd);
  assert.equal(isCreditedPaperFill({ ...record, sellExecutionKind: undefined }), false);
  assert.equal(isCreditedPaperFill({ ...record, observedLiquidityUsd: 0 }), false);
  await assert.rejects(executePaper(request, { ...snapshot, liquidity: 0 }, unknown), /zero liquidity/);
  await assert.rejects(executePaper(request, { ...snapshot, honeypot: true }, unknown), /security evidence/);
  await assert.rejects(executePaper(request, snapshot, { ...unknown, status: "fail" }), /no verified executable reverse route/);
});

test("pending Solana exit resolves mint decimals before requesting a reverse quote", async () => {
  const mint = "So11111111111111111111111111111111111111112";
  const snapshot = { chain: "Solana", tokenAddress: mint, liquidity: 10_000, price: 1 } as MarketSnapshot;
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    requested.push(target);
    if (target.includes("mainnet-beta.solana.com")) {
      assert.match(String(init?.body), /getTokenSupply/);
      return new Response(JSON.stringify({ result: { value: { decimals: 9 } } }), { status: 200 });
    }
    assert.match(target, /amount=1500000000/);
    return new Response(JSON.stringify({ outAmount: "1500000", routePlan: [{}] }), { status: 200 });
  };
  try {
    const audit = await auditSellQuantity(snapshot, 1.5);
    assert.equal(audit.status, "pass");
    assert.equal(audit.expectedOutUsd, 1.5);
    assert.equal(requested.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("pending BNB exit reads on-chain decimals before requesting a 0x sell quote", async () => {
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.ZEROEX_API_KEY;
  const requested: string[] = [];
  process.env.ZEROEX_API_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    requested.push(target);
    if (target.includes("bsc-dataseed")) {
      assert.match(String(init?.body), /0x313ce567/);
      return new Response(JSON.stringify({ result: `0x${(18).toString(16).padStart(64, "0")}` }), { status: 200 });
    }
    assert.match(target, /sellAmount=2000000000000000000/);
    return new Response(JSON.stringify({ buyAmount: "1000000000000000000", liquidityAvailable: true }), { status: 200 });
  };
  try {
    const snapshot = { chain: "BNB Chain", tokenAddress: "0x1111111111111111111111111111111111111111", liquidity: 10_000, price: 1 } as MarketSnapshot;
    const audit = await auditSellQuantity(snapshot, 2);
    assert.equal(audit.status, "pass");
    assert.equal(requested.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.ZEROEX_API_KEY;
    else process.env.ZEROEX_API_KEY = oldKey;
  }
});
